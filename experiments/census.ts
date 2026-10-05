/**
 * Census and labeling for the standardized-experiment framework: the
 * flip/spawn/work/metrics logs joined to DB turns, both metrics-log
 * generations, and the frozen exclusion classes (calibration,
 * incomplete-run, spanning). The opencode DB is opened read-only via
 * `node:sqlite` as an assistant-turn source; the census module is the
 * framework's single DB-access surface.
 *
 * Exclusion classes (frozen):
 * - `calibration`: the CAL-ON-FULL block prices the series; it never counts
 *   as data.
 * - `incomplete-run`: a failed or timed-out spawn, an unknown session id, a
 *   red or missing verify, or missing turn data. The analysis proceeds at
 *   achieved n over the remaining blocks.
 * - `spanning`: the solve session's activity (DB turns or metrics events)
 *   reaches past the next block's spawn start, or the session id appears in
 *   more than one block: the run cannot be attributed to a single arm.
 */

import { DatabaseSync } from "node:sqlite"

import { readDeepEra, CALIBRATION_ARM, DEEP_PROFILE, type DeepEra, type ExperimentProfile, type FlipArm } from "./arms.ts"
import { parseSpawnLog, type SpawnLogEntry } from "./spawn.ts"

export const METRICS_LOG_BASENAME = "context-metrics.jsonl"

export type MetricsGeneration = 1 | 2

/**
 * Classifies a parsed metrics-log line into its schema generation:
 * generation 2 carries `wouldEvictThisRun` (the dry-run projection counters
 * the ON-DRY arm reads); generation 1 predates it. Any other shape is not a
 * metrics line.
 *
 * @param line the parsed JSON line
 * @returns 1 or 2 for recognized generations, null otherwise
 */
export const classifyMetricsGeneration = (line: unknown): MetricsGeneration | null => {
  if (line === null || typeof line !== "object" || Array.isArray(line)) return null
  const record = line as Record<string, unknown>
  if (typeof record.ts !== "string" || typeof record.session !== "string") return null
  return "wouldEvictThisRun" in record ? 2 : 1
}

export type MetricsEvent = {
  timestamp: string
  timestampMs: number | null
  sessionId: string
  generation: MetricsGeneration
  evictedThisRun: boolean
}

/**
 * Parses a metrics JSONL log's text into events, dropping lines that do not
 * parse or do not carry a recognized generation (a truncated trailing write
 * must not poison the census). Each event records whether its line's
 * `evictedThisRun` array is nonempty (real evictions happened this run),
 * the lever profile's full-mode corroboration signal.
 *
 * @param metricsLogText the raw metrics-log content
 * @returns the recognized events in log order
 */
export const parseMetricsLog = (metricsLogText: string): MetricsEvent[] => {
  const events: MetricsEvent[] = []
  for (const line of metricsLogText.split("\n")) {
    if (line.trim().length === 0) continue
    try {
      const parsed: unknown = JSON.parse(line)
      const generation = classifyMetricsGeneration(parsed)
      if (generation === null) continue
      const record = parsed as { ts: string; session: string; evictedThisRun?: unknown }
      const timestampMs = Date.parse(record.ts)
      events.push({
        timestamp: record.ts,
        timestampMs: Number.isNaN(timestampMs) ? null : timestampMs,
        sessionId: record.session,
        generation,
        evictedThisRun: Array.isArray(record.evictedThisRun) && record.evictedThisRun.length > 0,
      })
    } catch {
      // Unparseable lines (including a truncated trailing write) are dropped.
    }
  }
  return events
}

export type WorkLogEntry =
  | { kind: "reset"; timestamp: string }
  | { kind: "verify"; timestamp: string; passed: number; failed: number; exit: number | null }
  | { kind: "tamper"; timestamp: string }
  | { kind: "unreadable"; timestamp: string }

const VERIFY_LINE_PATTERN = /^(\S+) verify: pass=(\d+) fail=(\d+)(?: \(exit (-?\d+)\))?$/
const RESET_LINE_PATTERN = /^(\S+) reset$/
const TAMPER_LINE_PATTERN = /^(\S+) verify: spec tampered:/
const UNREADABLE_LINE_PATTERN = /^(\S+) verify: unreadable runner summary/

/**
 * Parses an exercise work log's text (ab-work.log / ab-work-deep.log) into
 * typed entries; unrecognized lines are skipped.
 *
 * @param workLogText the raw work-log content
 * @returns the parsed entries in log order
 */
export const parseWorkLog = (workLogText: string): WorkLogEntry[] => {
  const entries: WorkLogEntry[] = []
  for (const line of workLogText.split("\n")) {
    const verify = VERIFY_LINE_PATTERN.exec(line)
    if (verify) {
      entries.push({
        kind: "verify",
        timestamp: verify[1] ?? "",
        passed: Number(verify[2]),
        failed: Number(verify[3]),
        exit: verify[4] === undefined ? null : Number(verify[4]),
      })
      continue
    }
    const reset = RESET_LINE_PATTERN.exec(line)
    if (reset) {
      entries.push({ kind: "reset", timestamp: reset[1] ?? "" })
      continue
    }
    const tamper = TAMPER_LINE_PATTERN.exec(line)
    if (tamper) {
      entries.push({ kind: "tamper", timestamp: tamper[1] ?? "" })
      continue
    }
    const unreadable = UNREADABLE_LINE_PATTERN.exec(line)
    if (unreadable) entries.push({ kind: "unreadable", timestamp: unreadable[1] ?? "" })
  }
  return entries
}

export type TurnRow = {
  createdAtMs: number
  updatedAtMs: number
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
}

/**
 * The census's single DB-access surface: assistant turns for one session,
 * ordered by creation time. Implementations read the opencode DB only.
 */
export interface TurnSource {
  assistantTurns(sessionId: string): TurnRow[]
}

export type TurnQuery = { input: unknown; output: unknown; cacheWrite: unknown; cacheRead: unknown; modelId: unknown; createdAt: unknown; updatedAt: unknown }

const numberOrZero = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)
const stringOrEmpty = (value: unknown): string => (typeof value === "string" ? value : "")

/**
 * Opens an opencode SQLite database read-only and returns its assistant
 * turns as the census's turn source. Requires the `node:sqlite` builtin
 * (Node 24+, experimental warning on stderr is expected).
 *
 * @param dbPath the opencode DB file path
 * @returns a turn source querying assistant messages by session id
 */
export const openTurnDatabase = (dbPath: string): TurnSource => {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const query = db.prepare(
    `SELECT json_extract(data, '$.tokens.input') AS input,
            json_extract(data, '$.tokens.output') AS output,
            json_extract(data, '$.tokens.cache.write') AS cacheWrite,
            json_extract(data, '$.tokens.cache.read') AS cacheRead,
            coalesce(json_extract(data, '$.modelID'), '') AS modelId,
            json_extract(data, '$.time.created') AS createdAt,
            time_updated AS updatedAt
       FROM message
      WHERE session_id = ?
        AND json_extract(data, '$.role') = 'assistant'
      ORDER BY time_created`,
  )
  return {
    assistantTurns(sessionId: string): TurnRow[] {
      const rows = query.all(sessionId) as TurnQuery[]
      return rows.map((row) => ({
        createdAtMs: numberOrZero(row.createdAt),
        updatedAtMs: numberOrZero(row.updatedAt),
        modelId: stringOrEmpty(row.modelId),
        inputTokens: numberOrZero(row.input),
        outputTokens: numberOrZero(row.output),
        cacheWriteTokens: numberOrZero(row.cacheWrite),
        cacheReadTokens: numberOrZero(row.cacheRead),
      }))
    },
  }
}

export type CensusExclusion = "calibration" | "incomplete-run" | "spanning"

export type CensusRow = {
  blockLabel: string
  blockNumber: number | null
  arm: FlipArm
  started: string
  sessionId: string
  spawnExit: number | null
  verifyPassed: number | null
  verifyFailed: number | null
  verifyExit: number | null
  turns: TurnRow[]
  turnsError: string | null
  metricsEvents: MetricsEvent[]
  metricsGenerations: { 1: number; 2: number }
  windowStartMs: number | null
  windowEndMs: number | null
  exclusion: CensusExclusion | null
}

export type CensusInputs = {
  flipLogText: string
  spawnLogText: string
  workLogText: string
  metricsLogText: string
  turns: TurnSource
  profile?: ExperimentProfile
}

export const CALIBRATION_BLOCK_LABEL = "cal"

// Formats an ISO timestamp as epoch ms; null when unparseable or empty.
const timestampMs = (value: string): number | null => {
  if (value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

// Picks the first work-log verify entry at or after the given epoch ms (the
// run's own verify), or null when none exists.
const verifyForBlock = (entries: WorkLogEntry[], startedMs: number | null): WorkLogEntry & { kind: "verify" } | null => {
  for (const entry of entries) {
    if (entry.kind !== "verify") continue
    const at = timestampMs(entry.timestamp)
    if (startedMs === null || at === null || at >= startedMs) return entry
  }
  return null
}

/**
 * Builds the census: spawn-log blocks joined to their work-log verify lines,
 * DB turns, and metrics events, each labeled with the frozen exclusion
 * classes. The metrics events attributed to a block are its session's events
 * inside the block's window (the block's spawn start through the next
 * block's spawn start); everything else belongs to the neighboring blocks.
 * Arm labels come from the era-position join under the inputs' profile: the
 * n-th data flip of the era names block n's arm.
 *
 * @param inputs the joined log texts, the turn source, and the experiment
 *   profile (the frozen deep profile when omitted)
 * @returns one census row per spawn-log block, in spawn-log order
 */
export const buildCensus = (inputs: CensusInputs): CensusRow[] => {
  const era: DeepEra = readDeepEra(inputs.flipLogText, inputs.profile ?? DEEP_PROFILE)
  const spawns: SpawnLogEntry[] = parseSpawnLog(inputs.spawnLogText)
  const work = parseWorkLog(inputs.workLogText)
  const metrics = parseMetricsLog(inputs.metricsLogText)

  const armByBlock = new Map<string, FlipArm>()
  let dataIndex = 0
  for (const flip of era.flips) {
    if (flip.arm === CALIBRATION_ARM) {
      armByBlock.set(CALIBRATION_BLOCK_LABEL, flip.arm)
      continue
    }
    dataIndex += 1
    armByBlock.set(String(dataIndex), flip.arm)
  }

  const sessionBlockCounts = new Map<string, number>()
  for (const spawn of spawns) {
    if (spawn.sessionId === "unknown") continue
    sessionBlockCounts.set(spawn.sessionId, (sessionBlockCounts.get(spawn.sessionId) ?? 0) + 1)
  }

  return spawns.map((spawn, index) => {
    const blockNumber = spawn.blockLabel === CALIBRATION_BLOCK_LABEL ? null : Number(spawn.blockLabel)
    const arm = armByBlock.get(spawn.blockLabel) ?? spawn.arm
    const startedMs = timestampMs(spawn.started)
    const nextSpawn = spawns[index + 1]
    const windowEndMs = nextSpawn === undefined ? null : timestampMs(nextSpawn.started)
    const verify = verifyForBlock(work, startedMs)

    let turns: TurnRow[] = []
    let turnsError: string | null = null
    if (spawn.sessionId !== "unknown") {
      try {
        turns = inputs.turns.assistantTurns(spawn.sessionId)
      } catch (error) {
        turnsError = error instanceof Error ? error.message : String(error)
      }
    }

    const windowStartMs = startedMs
    const sessionMetrics = metrics.filter((event) => event.sessionId === spawn.sessionId)
    const metricsEvents = sessionMetrics.filter(
      (event) =>
        (windowStartMs === null || event.timestampMs === null || event.timestampMs >= windowStartMs) &&
        (windowEndMs === null || event.timestampMs === null || event.timestampMs < windowEndMs),
    )
    const metricsGenerations: { 1: number; 2: number } = { 1: 0, 2: 0 }
    for (const event of metricsEvents) metricsGenerations[event.generation] += 1

    let exclusion: CensusExclusion | null = null
    if (spawn.blockLabel === CALIBRATION_BLOCK_LABEL) {
      exclusion = "calibration"
    } else if (
      spawn.exit !== 0 ||
      spawn.sessionId === "unknown" ||
      verify === null ||
      verify.failed > 0 ||
      (verify.exit !== null && verify.exit !== 0) ||
      turnsError !== null ||
      turns.length === 0
    ) {
      exclusion = "incomplete-run"
    } else {
      const lastTurnMs = turns.reduce((latest, turn) => Math.max(latest, turn.updatedAtMs), 0)
      // The reach test reads the session's UNFILTERED events: an event past
      // the window end was excluded from the block's attribution but still
      // proves the session ran on past the next spawn start.
      const lastMetricsMs = sessionMetrics.reduce((latest, event) => Math.max(latest, event.timestampMs ?? 0), 0)
      const lastActivityMs = Math.max(lastTurnMs, lastMetricsMs)
      if (
        (sessionBlockCounts.get(spawn.sessionId) ?? 0) > 1 ||
        (windowEndMs !== null && lastActivityMs > windowEndMs)
      ) {
        exclusion = "spanning"
      }
    }

    return {
      blockLabel: spawn.blockLabel,
      blockNumber,
      arm,
      started: spawn.started,
      sessionId: spawn.sessionId,
      spawnExit: spawn.exit,
      verifyPassed: verify?.passed ?? null,
      verifyFailed: verify?.failed ?? null,
      verifyExit: verify?.exit ?? null,
      turns,
      turnsError,
      metricsEvents,
      metricsGenerations,
      windowStartMs,
      windowEndMs,
      exclusion,
    }
  })
}

/**
 * The full-mode profiles' metrics corroboration: every ON-arm data block
 * must carry at least one metrics event whose `evictedThisRun` array is
 * nonempty (the plugin ran in full mode and really evicted), and every OFF
 * block must carry no metrics events at all (the plugin is absent; ANY
 * metrics line on an OFF block is a leak, be it a dry-mode projection or a
 * quiet full-mode line). Returns the failing blocks' labels in census order;
 * an empty list corroborates the series. The calibration block is exempt
 * (it prices the series and never counts as data); every other exclusion
 * class still gets judged, because the corroboration is an
 * apparatus-integrity check, not an endpoint gate.
 *
 * @param rows the census rows of a full-mode-corroborated series
 * @returns the labels of blocks failing the corroboration
 */
export const uncorroboratedFullModeBlocks = (rows: readonly CensusRow[]): string[] => {
  const failures: string[] = []
  for (const row of rows) {
    if (row.exclusion === "calibration") continue
    if (row.arm === "OFF") {
      if (row.metricsEvents.length > 0) failures.push(row.blockLabel)
      continue
    }
    if (!row.metricsEvents.some((event) => event.evictedThisRun)) failures.push(row.blockLabel)
  }
  return failures
}
