import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { PLUGIN_VERSION } from "./schema.ts"
import { CONTEXT_TOKENS_SOURCE_DEFAULT, CONTEXT_TOKENS_SOURCE_MODEL, CONTEXT_TOKENS_SOURCE_OVERRIDE, CONTEXT_TOKENS_SOURCE_UNKNOWN } from "./context-limits.ts"
import type { ContextLimit, ContextTokensSource } from "./context-limits.ts"
import { defaultIngestionHygienePath, defaultLiveStateDir, defaultMetricsPath, isNonEmptyString, PATH_SEGMENT_SEPARATOR } from "./options.ts"
import type { ContextManagerOptions, ResolvedOptions } from "./options.ts"
import { touchMapEntry } from "./session-maps.ts"
import { JSON_INDENT_SPACES, orderedRenderedSubjectsOf } from "./vocabulary.ts"
import type { HotSubject } from "./vocabulary.ts"
import { RAW_COUNTER_KEYS, totalsOf, withSessionMetricsEntry } from "./state.ts"
import type { AdvisoryResult, CumulativeCounters, LastRunMetrics, MetricsStore, PersistedContextLimitSeed, PersistedCounters, PersistedTotals, RawCounterKey, RetentionBreakdown, RunOutcome, SessionMetrics } from "./state.ts"

const HYGIENE_COPY_DISABLED_MAX_BYTES = 0

const LIVE_STATE_FILE_SUFFIX = ".json"
const LIVE_STATE_TEMP_FILE_SUFFIX = ".tmp"
export const PRUNE_SCAN_NEVER = -1
const PRUNE_SCAN_THROTTLE_DISABLED = 0
export const METRICS_ROTATION_DISABLED_MAX_BYTES = 0
const METRICS_ROTATION_SUFFIX = ".1"
const METRICS_COALESCING_DISABLED_MS = 0

export type PruneThrottle = { lastScanMs: number }

export type PageEntry = {
  output: string
  tool: string
  subject: string
  msgIndex: number
  partIndex: number
  attachments?: unknown[]
  stashSlot?: number
}

export type SessionPageStore = Map<string, PageEntry>

type SessionCheckpoint = {
  ts: string
  session: string
  manualMode: boolean
  contextLimit: number | null
  contextLimitSource: ContextTokensSource
  contextLimitModelKey: number | null | string
  lastRun: LastRunMetrics
  advisory?: AdvisoryResult
  retention?: RetentionBreakdown
  totals: CumulativeCounters
  pageStore: { entries: number; capacity: number }
  hotSubjects: string[]
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const persistedMsOf = (value: unknown): number | undefined => {
  if (typeof value !== "string") return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

// Absent keys default to 0 (records written before a counter existed),
// while a present-but-non-finite value rejects the whole record: a corrupt
// raw counter means the record cannot be trusted, so the seeder refuses it
// and falls through to the next-newest record. Absence marks the upgrade
// boundaries instead: a totals block missing the first-crossing
// reasoning-bytes key predates the 2026-09 reasoning reset, and a block
// missing any of the 2026-10-02 renamed keys (recallHits, recallMisses,
// pagesDropped, faults, dedupedBytesUnique) predates that reset, so its
// totals were accumulated under spellings and semantics the current schema
// cannot mean; the seeder rejects such records wholesale and the session
// restarts at zero rather than rehydrating figures the new schema cannot
// mean.
const UPGRADE_REQUIRED_COUNTER_KEYS: readonly RawCounterKey[] = [
  "reasoningBytesExpiredUnique",
  "recallHits",
  "recallMisses",
  "pagesDropped",
  "faults",
  "dedupedBytesUnique",
]

const persistedCounterOf = (totals: Record<string, unknown>, key: RawCounterKey): number | undefined => {
  const value = totals[key]
  if (value === undefined) return UPGRADE_REQUIRED_COUNTER_KEYS.includes(key) ? undefined : 0
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const CONTEXT_TOKENS_SOURCES: readonly ContextTokensSource[] = [
  CONTEXT_TOKENS_SOURCE_OVERRIDE,
  CONTEXT_TOKENS_SOURCE_MODEL,
  CONTEXT_TOKENS_SOURCE_DEFAULT,
  CONTEXT_TOKENS_SOURCE_UNKNOWN,
]

const isContextTokensSource = (value: unknown): value is ContextTokensSource =>
  (CONTEXT_TOKENS_SOURCES as readonly unknown[]).includes(value)

// Absent or null budget fields mean the record predates budget
// persistence or the session genuinely had no budget (both rehydrate to
// unknown, exactly the pre-persistence behavior), while a
// present-but-invalid pair rejects the whole record under the same
// discipline as a corrupt raw counter: the record cannot be trusted.
// The persisted model key is optional metadata: absent or null
// rehydrates to no model identity (an untracked or option-sourced
// budget), while a blank or non-string value rejects the record. Undefined return
// rejects the seed; a defined one carries the budget or unknown.
const persistedContextLimitSeedOf = (parsed: Record<string, unknown>): PersistedContextLimitSeed | undefined => {
  const tokens = parsed["contextLimit"]
  if (tokens === undefined || tokens === null) return { budget: undefined }
  if (typeof tokens !== "number" || Number.isFinite(tokens) === false || tokens <= 0) return undefined
  const source = parsed["contextLimitSource"]
  if (isContextTokensSource(source) === false) return undefined
  const rawModelKey = parsed["contextLimitModelKey"]
  if (rawModelKey !== undefined && rawModelKey !== null && (typeof rawModelKey !== "string" || rawModelKey.length === 0)) return undefined
  return { budget: { tokens, source, modelKey: typeof rawModelKey === "string" ? rawModelKey : undefined } }
}

const persistedCountersOf = (value: unknown): PersistedCounters | undefined => {
  if (!isRecord(value)) return undefined
  const counters = {} as PersistedCounters
  for (const key of RAW_COUNTER_KEYS) {
    const seeded = persistedCounterOf(value, key)
    if (seeded === undefined) return undefined
    counters[key] = seeded
  }
  return counters
}

const checkpointTotalsSeedOf = async (options: ResolvedOptions, sessionKey: string): Promise<PersistedTotals | undefined> => {
  if (options.liveStateLog === false) return undefined
  if (!isSafeSessionFileStem(sessionKey)) return undefined
  let content: string
  try {
    content = await readFile(join(options.liveStatePath, `${sessionKey}${LIVE_STATE_FILE_SUFFIX}`), "utf8")
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed["session"] !== sessionKey) return undefined
  const tsMs = persistedMsOf(parsed["ts"])
  const counters = persistedCountersOf(parsed["totals"])
  const budgetSeed = persistedContextLimitSeedOf(parsed)
  if (tsMs === undefined || counters === undefined || budgetSeed === undefined) return undefined
  return { tsMs, counters, budget: budgetSeed.budget }
}

const logTotalsSeedOf = async (options: ResolvedOptions, sessionKey: string): Promise<PersistedTotals | undefined> => {
  if (options.metricsLog === false) return undefined
  let content: string
  try {
    content = await readFile(options.metricsPath, "utf8")
  } catch {
    return undefined
  }
  // Newest line first: the last match for the session wins, matching the
  // panel's newest-line preference including equal timestamps.
  const lines = content.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim()
    if (trimmed.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(parsed) || parsed["session"] !== sessionKey) continue
    const tsMs = persistedMsOf(parsed["ts"])
    const counters = persistedCountersOf(parsed["totals"])
    const budgetSeed = persistedContextLimitSeedOf(parsed)
    if (tsMs === undefined || counters === undefined || budgetSeed === undefined) continue
    return { tsMs, counters, budget: budgetSeed.budget }
  }
  return undefined
}

// The newest record wins, mirroring the panel's snapshot-versus-log
// preference: the snapshot covers quiet runs, while a strictly newer log
// line means another writer landed after the last snapshot.
export const newestPersistedTotalsOf = async (options: ResolvedOptions, sessionKey: string): Promise<PersistedTotals | undefined> => {
  const [snapshotSeed, logSeed] = await Promise.all([checkpointTotalsSeedOf(options, sessionKey), logTotalsSeedOf(options, sessionKey)])
  if (snapshotSeed === undefined) return logSeed
  if (logSeed === undefined) return snapshotSeed
  return logSeed.tsMs > snapshotSeed.tsMs ? logSeed : snapshotSeed
}

// Whether appending incomingBytes would push the file past its rotation
// cap: the rename predicate of rotateMetricsLogPastCap, extracted so a
// caller can act in the exact window a rename would fire without
// duplicating the size arithmetic.
export const logRotationIsDue = async (path: string, incomingBytes: number, capBytes: number): Promise<boolean> => {
  if (capBytes === METRICS_ROTATION_DISABLED_MAX_BYTES) return false
  let currentBytes: number
  try {
    currentBytes = (await stat(path)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return false
    throw error
  }
  return currentBytes + incomingBytes > capBytes
}

export const rotateMetricsLogPastCap = async (path: string, incomingBytes: number, capBytes: number): Promise<void> => {
  if (await logRotationIsDue(path, incomingBytes, capBytes)) await rename(path, `${path}${METRICS_ROTATION_SUFFIX}`)
}

// The disk-copy escape hatch for ingestion hygiene: before a rewritten
// output lands, one JSONL line carries the tool name, the title when
// available, both lengths, and the full original, mirroring the host's
// own full-text-to-disk discipline. A cap of 0 disables the copy entirely
// (the strip still applies); a failed write degrades to hygieneWriteError
// on the session's diagnostics and never blocks the tool result.
export const appendHygieneCopy = async (
  options: ResolvedOptions,
  metrics: MetricsStore,
  sessionKey: string,
  rewrite: { tool: string; title: string | undefined; original: string; stripped: string },
): Promise<void> => {
  if (options.ingestionHygieneRotationMaxBytes === HYGIENE_COPY_DISABLED_MAX_BYTES) return
  const line = {
    ts: new Date(options.now()).toISOString(),
    session: sessionKey,
    tool: rewrite.tool,
    ...(rewrite.title === undefined ? {} : { title: rewrite.title }),
    originalChars: rewrite.original.length,
    strippedChars: rewrite.stripped.length,
    output: rewrite.original,
  }
  try {
    const hygieneJsonLine = `${JSON.stringify(line)}\n`
    await rotateMetricsLogPastCap(options.ingestionHygienePath, Buffer.byteLength(hygieneJsonLine), options.ingestionHygieneRotationMaxBytes)
    await appendFile(options.ingestionHygienePath, hygieneJsonLine)
    const entry = touchMapEntry(metrics, sessionKey)
    if (entry !== undefined) delete entry.hygieneWriteError
  } catch (error) {
    withSessionMetricsEntry(metrics, sessionKey, options.metricsSessions, (target) => {
      target.hygieneWriteError = error instanceof Error ? error.message : String(error)
    })
  }
}

export const recordMetricsLine = async (
  options: ResolvedOptions,
  metrics: SessionMetrics,
  sessionKey: string,
  pluginSession: string,
  contextLimit: ContextLimit,
  run: RunOutcome,
): Promise<void> => {
  const { eviction, deduped: dedupedThisRun, purged: purgedThisRun, faults: faultsThisRun, reasoningExpired: reasoningExpiredThisRun, fenceEvicted: fenceEvictedThisRun } = run
  const recallsSinceLastLine = metrics.recallHits + metrics.recallMisses - metrics.recallsLoggedThrough
  const nowMs = options.now()
  // The six recorded-event disjuncts feed both gates so the lists cannot
  // drift. Eventful runs are the candidates for a line: an eviction, dedup
  // tombstone, input purge, touch, fence event, or stash read, plus
  // reasoning expiry; a budget-source change alone stays quiet. Among
  // eventful runs, the significant ones always flush: any recorded event,
  // plus a budget-source change against the last flushed line (a change
  // the panel renders per line, and the first line of a session counts as
  // one). Reasoning expiry re-reports the session's standing aged set on
  // every run, so a reasoning-only run inside the coalesce window writes
  // nothing; the window is measured from the session's previous flushed
  // line and a suppressed run does not move it, so sustained
  // reasoning-only traffic settles at one line per interval.
  const hasRecordedEvent =
    eviction.evicted.length > 0 ||
    dedupedThisRun > 0 ||
    purgedThisRun > 0 ||
    faultsThisRun > 0 ||
    fenceEvictedThisRun.blocks > 0 ||
    recallsSinceLastLine > 0
  const isEventful = hasRecordedEvent || reasoningExpiredThisRun.parts > 0
  if (options.metricsLog === false || isEventful === false) return
  const hasSignificantEvent = hasRecordedEvent || contextLimit.source !== metrics.lastLineContextLimitSource
  const withinCoalesceWindow = metrics.lastLineAtMs !== undefined && nowMs - metrics.lastLineAtMs < options.metricsMinLineIntervalMs
  if (options.metricsMinLineIntervalMs > METRICS_COALESCING_DISABLED_MS && hasSignificantEvent === false && withinCoalesceWindow) return
  const line = {
    ts: new Date(nowMs).toISOString(),
    session: sessionKey,
    pluginVersion: PLUGIN_VERSION,
    pluginSession,
    contextLimit: contextLimit.tokens,
    contextLimitSource: contextLimit.source,
    contextLimitModelKey: contextLimit.modelKey ?? null,
    estimatedTokens: eviction.estimatedTokens,
    toolPoolBytes: run.composition.toolPoolBytes,
    textChars: run.composition.textChars,
    reasoningInWindowBytes: run.composition.reasoningInWindowBytes,
    escapeBytes: run.composition.escapeBytes,
    attachmentBytes: run.composition.attachmentBytes,
    watermarkTokens: eviction.watermarkTokens,
    deficitTokens: eviction.deficitTokens,
    evictedThisRun: eviction.evicted.map((entry) => ({
      tool: entry.tool,
      subject: entry.subject,
      bytes: entry.bytes,
      attachmentBytes: entry.attachmentBytes,
      messagesAgo: entry.messagesAgo,
    })),
    dedupedThisRun,
    purgedThisRun,
    reasoningExpiredThisRun: reasoningExpiredThisRun.parts,
    reasoningBytesExpiredThisRun: reasoningExpiredThisRun.bytes,
    ...(run.dryRun === undefined
      ? {}
      : {
          wouldEvictThisRun: run.dryRun.wouldEvictCount,
          wouldEvictBytesThisRun: run.dryRun.wouldEvictBytes,
        }),
    fenceEvictedThisRun: fenceEvictedThisRun.blocks,
    faultsThisRun,
    recallsSinceLastLine,
    totals: totalsOf(metrics, options.charsPerToken),
  }
  try {
    const metricsJsonLine = `${JSON.stringify(line)}\n`
    await rotateMetricsLogPastCap(options.metricsPath, Buffer.byteLength(metricsJsonLine), options.metricsRotationMaxBytes)
    await appendFile(options.metricsPath, metricsJsonLine)
    metrics.recallsLoggedThrough = metrics.recallHits + metrics.recallMisses
    metrics.lastLineAtMs = nowMs
    metrics.lastLineContextLimitSource = contextLimit.source
    delete metrics.logWriteError
  } catch (error) {
    metrics.logWriteError = error instanceof Error ? error.message : String(error)
  }
}

const sessionCheckpointOf = (
  sessionKey: string,
  contextLimit: ContextLimit,
  options: ResolvedOptions,
  metrics: SessionMetrics,
  lastRun: LastRunMetrics,
  pageStore: SessionPageStore,
  hotSubjects: HotSubject[],
): SessionCheckpoint => ({
  ts: new Date(options.now()).toISOString(),
  session: sessionKey,
  manualMode: options.manualMode,
  contextLimit: contextLimit.tokens,
  contextLimitSource: contextLimit.source,
  contextLimitModelKey: contextLimit.modelKey ?? null,
  lastRun,
  // Spread, not a present-undefined key: a below-band run must leave the
  // field absent from the JSON so pre-band readers and round-trip
  // deep-equals see the pre-change shape.
  ...(metrics.lastAdvisory === undefined ? {} : { advisory: metrics.lastAdvisory }),
  // Same tolerance for the retention audit: a snapshot carrying it renders
  // the panel's retention row, one without it renders none.
  // Same absent-when-empty rule as the describe block: a run that scanned
  // no live outputs leaves the field out of the JSON, so the panel renders
  // no retention row and round-trip deep-equals see the pre-change shape.
  ...(metrics.lastRetention === undefined || metrics.lastRetention.pool === 0 ? {} : { retention: metrics.lastRetention }),
  totals: totalsOf(metrics, options.charsPerToken),
  pageStore: { entries: pageStore.size, capacity: options.stashLimit },
  hotSubjects: orderedRenderedSubjectsOf(hotSubjects, options.hintSubjects),
})

// Prune runs after the snapshot write has landed, so every failure here
// is a skipped file, never a surfaced error. The directory scan itself is
// throttled to at most one per plugin instance per
// liveStatePruneMinIntervalMs (default MIN_MS_BETWEEN_PRUNE_SCANS, 0
// disables the throttle): opencode instantiates the plugin once per
// process, so an instance-level budget is a per-process budget in
// production. Per-session snapshots fire far more often than state files
// expire, so the scan that usually finds nothing is the expensive part. A
// scan landing inside the window is skipped entirely, which only
// postpones pruning; once the window elapses the next snapshot write
// scans again. Tests inject a 0 interval to assert scan effects
// time-independently; the throttled path is pinned time-independently by
// asserting that a stale file planted right after a completed scan
// survives the next snapshot write, and the window expiry is pinned by
// the injected now() clock, whose advanceMs crosses the throttle interval
// in zero real time.
const isPrunableStateFileName = (name: string): boolean =>
  name.endsWith(LIVE_STATE_FILE_SUFFIX) || name.endsWith(`${LIVE_STATE_FILE_SUFFIX}${LIVE_STATE_TEMP_FILE_SUFFIX}`)

const pruneCheckpointFiles = async (
  dir: string,
  maxAgeMs: number,
  throttle: PruneThrottle,
  minIntervalMs: number,
  nowMs: number,
): Promise<void> => {
  if (maxAgeMs <= 0) return
  if (minIntervalMs > PRUNE_SCAN_THROTTLE_DISABLED) {
    if (throttle.lastScanMs !== PRUNE_SCAN_NEVER && nowMs - throttle.lastScanMs < minIntervalMs) return
    throttle.lastScanMs = nowMs
  }
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (!isPrunableStateFileName(name)) continue
    const path = join(dir, name)
    try {
      const info = await stat(path)
      if (nowMs - info.mtimeMs > maxAgeMs) await unlink(path)
    } catch {
      continue
    }
  }
}

const isSafeSessionFileStem = (sessionKey: string): boolean =>
  sessionKey.length > 0 && sessionKey !== "." && sessionKey !== ".." && !sessionKey.includes(PATH_SEGMENT_SEPARATOR)

export const recordSessionCheckpoint = async (
  options: ResolvedOptions,
  sessionKey: string,
  contextLimit: ContextLimit,
  metrics: SessionMetrics,
  pageStore: SessionPageStore,
  hotSubjects: HotSubject[],
  pruneThrottle: PruneThrottle,
): Promise<void> => {
  if (options.liveStateLog === false) return
  const lastRun = metrics.lastRun
  if (lastRun === undefined) return
  if (!isSafeSessionFileStem(sessionKey)) return
  const snapshot = sessionCheckpointOf(sessionKey, contextLimit, options, metrics, lastRun, pageStore, hotSubjects)
  const stateFile = join(options.liveStatePath, `${sessionKey}${LIVE_STATE_FILE_SUFFIX}`)
  const tempFile = `${stateFile}${LIVE_STATE_TEMP_FILE_SUFFIX}`
  try {
    await mkdir(options.liveStatePath, { recursive: true })
    // Write to a sibling temp file and rename so a concurrent reader sees
    // either the previous snapshot or the new one, never a torn write.
    await writeFile(tempFile, `${JSON.stringify(snapshot, null, JSON_INDENT_SPACES)}\n`)
    await rename(tempFile, stateFile)
    delete metrics.stateWriteError
  } catch (error) {
    metrics.stateWriteError = error instanceof Error ? error.message : String(error)
    await unlink(tempFile).catch(() => {})
    return
  }
  await pruneCheckpointFiles(options.liveStatePath, options.liveStatePruneMaxAgeMs, pruneThrottle, options.liveStatePruneMinIntervalMs, options.now())
}

// One-time data migration for the plugin family rename: stored metrics,
// live state, and hygiene copies under the previous lru-* basenames move to
// the current names on the first default-path load, before any hook is
// returned, so the producer and the panel readers observe the same
// locations and accumulated history stays reachable. Each kind migrates
// only while the plugin actually uses it (the metricsLog, liveStateLog,
// and hygiene-copy switches respectively). Every rename targets its new
// name only while that name does not exist yet, and an existing current
// name wins with the legacy file left readable beside it; the rotated
// sibling carries the same check of its own, so a load that moved the
// primary but failed on the sibling moves the stranded sibling on the
// next default-path load. A configured path option bypasses migration
// entirely: the user chose their own locations. A failed rename degrades
// the way the write paths do, never blocking plugin load: the legacy file
// stays in place and the next default-path load retries, since the
// condition simply re-runs each time.
const LEGACY_METRICS_FILE_BASENAME = "lru-metrics.jsonl"
const LEGACY_LIVE_STATE_DIR_BASENAME = "lru-state"
const LEGACY_INGESTION_HYGIENE_FILE_BASENAME = "lru-hygiene.jsonl"

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const migrateLegacyFileWithRotatedSibling = async (oldPath: string, newPath: string): Promise<void> => {
  if ((await pathExists(newPath)) === false && (await pathExists(oldPath))) await rename(oldPath, newPath)
  const oldRotatedPath = `${oldPath}${METRICS_ROTATION_SUFFIX}`
  if ((await pathExists(oldRotatedPath)) === false) return
  const newRotatedPath = `${newPath}${METRICS_ROTATION_SUFFIX}`
  if (await pathExists(newRotatedPath)) return
  await rename(oldRotatedPath, newRotatedPath)
}

const migrateLegacyDirectory = async (oldDir: string, newDir: string): Promise<void> => {
  if ((await pathExists(newDir)) || (await pathExists(oldDir)) === false) return
  await rename(oldDir, newDir)
}

const usesDefaultPath = (path: string | undefined): boolean => !isNonEmptyString(path)

// One default-location migration: the legacy basename beside the derived
// default path, moved to the default path itself. Undefined when the user
// configured their own path or the kind's logging is off.
const legacyPathMigration = (
  rawPath: string | undefined,
  migrationEnabled: boolean,
  defaultPath: () => string,
  legacyBasename: string,
  migrate: (oldPath: string, newPath: string) => Promise<void>,
): (() => Promise<void>) | undefined => {
  if (usesDefaultPath(rawPath) === false || migrationEnabled === false) return undefined
  return () => {
    const newPath = defaultPath()
    return migrate(join(dirname(newPath), legacyBasename), newPath)
  }
}

export const migrateLegacyDefaultPaths = async (raw: ContextManagerOptions): Promise<void> => {
  for (const migration of [
    legacyPathMigration(raw.metricsPath, raw.metricsLog !== false, defaultMetricsPath, LEGACY_METRICS_FILE_BASENAME, migrateLegacyFileWithRotatedSibling),
    legacyPathMigration(raw.liveStatePath, raw.liveStateLog !== false, defaultLiveStateDir, LEGACY_LIVE_STATE_DIR_BASENAME, migrateLegacyDirectory),
    legacyPathMigration(raw.ingestionHygienePath, raw.ingestionHygieneCopy !== false, defaultIngestionHygienePath, LEGACY_INGESTION_HYGIENE_FILE_BASENAME, migrateLegacyFileWithRotatedSibling),
  ]) {
    if (migration === undefined) continue
    try {
      await migration()
    } catch {
      // Degrade like the write paths: the old location stays in place, the
      // plugin loads, and the next default-path load retries the move.
    }
  }
}
