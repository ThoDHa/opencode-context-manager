import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  DEFAULT_LIVE_STATE_DIR,
  DEFAULT_METRICS_PATH,
  budgetSourceLabel,
  formatBytes,
  formatTokenCount,
  globalTotals,
  linesForSession,
  loadPanelData,
  panelRows,
  parseMetricsLine,
  parseMetricsLog,
  parseStateSnapshot,
  readMetricsLog,
  readStateSnapshot,
  sessionPanelData,
  type PanelMetricsLine,
} from "../plugin/lru-panel-data.ts"
import lruContextFactory from "../plugin/lru-context.ts"

const SESSION_A = "sess-panel-a"
const SESSION_B = "sess-panel-b"
const BUDGET_TOKENS_MODEL = 200000
const BUDGET_TOKENS_SMALL = 600
const ESTIMATED_TOKENS = 123456
const WATERMARK_TOKENS = 100000
const DEFICIT_TOKENS = 23456
const EVICTED_BYTES = 3072
const EVICTED_MESSAGES_AGO = 7
const TOTALS_EVICTIONS = 5
const TOTALS_BYTES = 12288
const TOTALS_STASH_HITS = 4
const TOTALS_STASH_MISSES = 6
const TOTALS_STASH_DROPPED = 1
const TOTALS_DEDUPED = 9
const TOTALS_REASONING_EXPIRED = 7
const TOTALS_REASONING_BYTES = 2560
const TOTALS_FENCE_EVICTED = 2
const TOTALS_TOUCHES = 3
const RECENT_LIMIT = 2
const EVICTION_COUNT_PER_LINE = 3
const LINE_COUNT_THREE = 3
const PARSED_LINE_COUNT = 2
const KILO_BOUNDARY_TOKENS = 1000
const KILO_TOKENS = 1500
const KILO_TOKENS_FRACTIONAL = 1234
const MEGA_TOKENS = 2500000
const MEGA_TOKENS_FRACTIONAL = 1234567
const PLAIN_TOKENS = 999
const PLAIN_BYTES = 512
const KILOBYTE_BYTES = 2048
const KILOBYTE_FRACTIONAL_BYTES = 1536
const SUBJECT_TAIL = "-tail"
const SECOND_LINE_ESTIMATED = 200000
const UNKNOWN_BUDGET_SOURCE = "unknown"
const OVERRIDE_BUDGET_SOURCE = "override"
const MODEL_BUDGET_SOURCE = "model"
const DEFAULT_BUDGET_SOURCE = "default"

const makeTotals = (): PanelMetricsLine["totals"] => ({
  evictions: TOTALS_EVICTIONS,
  bytesReclaimed: TOTALS_BYTES,
  stashHits: TOTALS_STASH_HITS,
  stashMisses: TOTALS_STASH_MISSES,
  stashDropped: TOTALS_STASH_DROPPED,
  deduped: TOTALS_DEDUPED,
  reasoningExpired: TOTALS_REASONING_EXPIRED,
  reasoningBytesExpired: TOTALS_REASONING_BYTES,
  fenceEvicted: TOTALS_FENCE_EVICTED,
  postEvictionTouches: TOTALS_TOUCHES,
})

const makeLine = (overrides: Partial<PanelMetricsLine> = {}): PanelMetricsLine => ({
  session: SESSION_A,
  ts: LOG_LINE_TS_STALE,
  modelContextTokens: BUDGET_TOKENS_MODEL,
  modelContextTokensSource: MODEL_BUDGET_SOURCE,
  estimatedTokens: ESTIMATED_TOKENS,
  watermarkTokens: WATERMARK_TOKENS,
  deficitTokens: DEFICIT_TOKENS,
  evictedThisRun: [{ tool: "read", subject: "/data/a.txt", bytes: EVICTED_BYTES, messagesAgo: EVICTED_MESSAGES_AGO }],
  totals: makeTotals(),
  ...overrides,
})

const serialize = (lines: PanelMetricsLine[]): string => lines.map((line) => JSON.stringify(line)).join("\n") + "\n"

const withTempDir = async (run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "lru-panel-data-"))
  try {
    await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("parseMetricsLine parses a line carrying exactly the fields the panel consumes", () => {
  const raw = JSON.stringify(makeLine())

  const line = parseMetricsLine(raw)

  assert.ok(line !== undefined)
  assert.equal(line.session, SESSION_A)
  assert.equal(line.ts, LOG_LINE_TS_STALE)
  assert.equal(line.modelContextTokens, BUDGET_TOKENS_MODEL)
  assert.equal(line.modelContextTokensSource, MODEL_BUDGET_SOURCE)
  assert.equal(line.estimatedTokens, ESTIMATED_TOKENS)
  assert.equal(line.totals.evictions, TOTALS_EVICTIONS)
  assert.equal(line.evictedThisRun.length, 1)
  assert.equal(line.evictedThisRun[0].subject, "/data/a.txt")
})

test("parseMetricsLine accepts the nullable budget and watermark fields of unknown-budget runs", () => {
  const raw = JSON.stringify(makeLine({ modelContextTokens: null, watermarkTokens: null, deficitTokens: null }))

  const line = parseMetricsLine(raw)

  assert.ok(line !== undefined)
  assert.equal(line.modelContextTokens, null)
  assert.equal(line.watermarkTokens, null)
  assert.equal(line.deficitTokens, null)
})

test("parseMetricsLine rejects a line that is not valid JSON", () => {
  assert.equal(parseMetricsLine("{not json"), undefined)
})

test("parseMetricsLine rejects a line missing a required field", () => {
  const raw = JSON.stringify({ session: SESSION_A })

  assert.equal(parseMetricsLine(raw), undefined)
})

test("parseMetricsLine rejects a line whose totals carry a non-numeric counter", () => {
  const rawNonNumericEvictions = JSON.stringify(makeLine({ totals: { ...makeTotals(), evictions: "many" } }))
  const rawNonNumericFenceEvictions = JSON.stringify(makeLine({ totals: { ...makeTotals(), fenceEvicted: "some" } }))

  assert.equal(parseMetricsLine(rawNonNumericEvictions), undefined)
  assert.equal(parseMetricsLine(rawNonNumericFenceEvictions), undefined)
})

test("parseMetricsLine rejects a line whose evicted entries are malformed", () => {
  const raw = JSON.stringify(makeLine({ evictedThisRun: [{ tool: "read", bytes: EVICTED_BYTES }] }))

  assert.equal(parseMetricsLine(raw), undefined)
})

test("parseMetricsLine rejects a line whose ts is not a string", () => {
  assert.equal(parseMetricsLine(JSON.stringify(makeLine({ ts: 42 }))), undefined)
})

test("parseMetricsLine consumes the line's ts and accepts the plugin's remaining run-scoped fields the panel ignores", () => {
  const raw = JSON.stringify({
    ...makeLine(),
    ts: "2026-09-16T12:00:00.000Z",
    dedupedThisRun: 2,
    reasoningExpiredThisRun: 1,
    reasoningBytesExpiredThisRun: 512,
    fenceEvictedThisRun: 1,
    postEvictionTouchesThisRun: 1,
    stashReadsSinceLastLine: 3,
  })

  const line = parseMetricsLine(raw)

  assert.ok(line !== undefined)
  assert.equal(line.session, SESSION_A)
  assert.equal(line.ts, "2026-09-16T12:00:00.000Z")
  assert.equal(line.estimatedTokens, ESTIMATED_TOKENS)
  assert.equal(line.totals.reasoningExpired, TOTALS_REASONING_EXPIRED)
  assert.equal(line.totals.reasoningBytesExpired, TOTALS_REASONING_BYTES)
  assert.equal(line.totals.fenceEvicted, TOTALS_FENCE_EVICTED)
})

test("parseMetricsLog keeps every well-formed line and skips blanks and malformed lines", () => {
  const content = [JSON.stringify(makeLine()), "not json", "", JSON.stringify(makeLine({ session: SESSION_B }))].join("\n")

  const lines = parseMetricsLog(content)

  assert.equal(lines.length, PARSED_LINE_COUNT)
  assert.equal(lines[0].session, SESSION_A)
  assert.equal(lines[1].session, SESSION_B)
})

test("readMetricsLog returns an empty list when the log file does not exist", async () => {
  await withTempDir(async (dir) => {
    const missing = join(dir, "absent-metrics.jsonl")

    const lines = await readMetricsLog(missing)

    assert.deepEqual(lines, [])
  })
})

test("readMetricsLog parses the file contents when the log exists", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine(), makeLine({ session: SESSION_B })]))

    const lines = await readMetricsLog(path)

    assert.equal(lines.length, PARSED_LINE_COUNT)
    assert.equal(lines[1].session, SESSION_B)
  })
})

test("loadPanelData surfaces the read error when the log path cannot be read", async () => {
  await withTempDir(async (dir) => {
    const directoryPath = join(dir, "metrics-dir")
    mkdirSync(directoryPath)

    const data = await loadPanelData({ path: directoryPath })

    assert.ok(data.error !== undefined)
    assert.equal(data.current, undefined)
    assert.deepEqual(data.global.stashReads, 0)
  })
})

test("loadPanelData reports no error and no current session when the log is missing", async () => {
  await withTempDir(async (dir) => {
    const data = await loadPanelData({ path: join(dir, "absent-metrics.jsonl"), sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.equal(data.activeSession, SESSION_A)
    assert.equal(data.current, undefined)
  })
})

test("loadPanelData reports no active session when none was requested", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine()]))

    const data = await loadPanelData({ path })

    assert.equal(data.error, undefined)
    assert.equal(data.activeSession, undefined)
    assert.equal(data.current, undefined)
  })
})

test("linesForSession keeps only the requested session's lines in log order", () => {
  const lines = [
    makeLine({ session: SESSION_A }),
    makeLine({ session: SESSION_B }),
    makeLine({ session: SESSION_A, estimatedTokens: SECOND_LINE_ESTIMATED }),
  ]

  const filtered = linesForSession(lines, SESSION_A)

  assert.equal(filtered.length, PARSED_LINE_COUNT)
  assert.equal(filtered[0].estimatedTokens, ESTIMATED_TOKENS)
  assert.equal(filtered[1].estimatedTokens, SECOND_LINE_ESTIMATED)
})

test("sessionPanelData returns undefined when the session has no lines", () => {
  assert.equal(sessionPanelData([makeLine()], SESSION_B), undefined)
})

test("sessionPanelData reports the budget, source, and last run from the session's most recent line", () => {
  const lines = [
    makeLine({ modelContextTokens: BUDGET_TOKENS_SMALL, estimatedTokens: SECOND_LINE_ESTIMATED }),
    makeLine({ modelContextTokensSource: DEFAULT_BUDGET_SOURCE }),
  ]

  const panel = sessionPanelData(lines, SESSION_A)

  assert.ok(panel !== undefined)
  assert.equal(panel.budgetTokens, BUDGET_TOKENS_MODEL)
  assert.equal(panel.budgetSource, DEFAULT_BUDGET_SOURCE)
  assert.equal(panel.runs, PARSED_LINE_COUNT)
  assert.equal(panel.lastRun.estimatedTokens, ESTIMATED_TOKENS)
  assert.equal(panel.lastRun.deficitTokens, DEFICIT_TOKENS)
})

test("sessionPanelData reports cumulative counters and stash reads from the most recent line", () => {
  const panel = sessionPanelData([makeLine()], SESSION_A)

  assert.ok(panel !== undefined)
  assert.equal(panel.totals.evictions, TOTALS_EVICTIONS)
  assert.equal(panel.totals.bytesReclaimed, TOTALS_BYTES)
  assert.equal(panel.stashReads, TOTALS_STASH_HITS + TOTALS_STASH_MISSES)
})

test("sessionPanelData lists recent evictions newest first bounded by the limit", () => {
  const lines = [
    makeLine({
      evictedThisRun: Array.from({ length: EVICTION_COUNT_PER_LINE }, (_, index) => ({
        tool: "read",
        subject: `/data/old-${index}.txt`,
        bytes: EVICTED_BYTES,
        messagesAgo: EVICTED_MESSAGES_AGO,
      })),
    }),
    makeLine({
      evictedThisRun: [{ tool: "bash", subject: "tail-cmd", bytes: EVICTED_BYTES, messagesAgo: EVICTED_MESSAGES_AGO }],
    }),
  ]

  const panel = sessionPanelData(lines, SESSION_A, RECENT_LIMIT)

  assert.ok(panel !== undefined)
  assert.equal(panel.recentEvictions.length, RECENT_LIMIT)
  assert.equal(panel.recentEvictions[0].subject, "tail-cmd")
  assert.equal(panel.recentEvictions[1].subject, `/data/old-${EVICTION_COUNT_PER_LINE - 1}.txt`)
})

test("sessionPanelData returns an empty recent list when the limit is zero", () => {
  const panel = sessionPanelData([makeLine()], SESSION_A, 0)

  assert.ok(panel !== undefined)
  assert.deepEqual(panel.recentEvictions, [])
})

test("globalTotals sums each session's latest cumulative totals once per session", () => {
  const lines = [
    makeLine(),
    makeLine({ session: SESSION_B, totals: { ...makeTotals(), evictions: TOTALS_EVICTIONS + 1 } }),
    makeLine({ totals: { ...makeTotals(), bytesReclaimed: TOTALS_BYTES + SUBJECT_TAIL.length } }),
  ]

  const totals = globalTotals(lines)

  assert.equal(totals.sessions, PARSED_LINE_COUNT)
  assert.equal(totals.runs, LINE_COUNT_THREE)
  assert.equal(totals.evictions, TOTALS_EVICTIONS * 2 + 1)
  assert.equal(totals.bytesReclaimed, TOTALS_BYTES * 2 + SUBJECT_TAIL.length)
  assert.equal(totals.stashReads, (TOTALS_STASH_HITS + TOTALS_STASH_MISSES) * 2)
})

test("loadPanelData selects the requested session's panel data", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine(), makeLine({ session: SESSION_B })]))

    const data = await loadPanelData({ path, sessionID: SESSION_B })

    assert.equal(data.error, undefined)
    assert.equal(data.activeSession, SESSION_B)
    assert.ok(data.current !== undefined)
    assert.equal(data.current.session, SESSION_B)
  })
})

test("formatTokenCount renders sub-kilotoken counts as-is and larger counts compacted", () => {
  assert.equal(formatTokenCount(PLAIN_TOKENS), String(PLAIN_TOKENS))
  assert.equal(formatTokenCount(KILO_BOUNDARY_TOKENS), "1k")
  assert.equal(formatTokenCount(KILO_TOKENS), "1.5k")
  assert.equal(formatTokenCount(KILO_TOKENS_FRACTIONAL), "1.2k")
  assert.equal(formatTokenCount(MEGA_TOKENS), "2.5M")
  assert.equal(formatTokenCount(MEGA_TOKENS_FRACTIONAL), "1.23M")
})

test("formatBytes renders bytes under one kilobyte as-is and larger sizes in kilobytes", () => {
  assert.equal(formatBytes(PLAIN_BYTES), `${PLAIN_BYTES} B`)
  assert.equal(formatBytes(KILOBYTE_BYTES), "2 kB")
  assert.equal(formatBytes(KILOBYTE_FRACTIONAL_BYTES), "1.5 kB")
})

test("budgetSourceLabel maps the plugin's source ids to panel labels", () => {
  assert.equal(budgetSourceLabel(OVERRIDE_BUDGET_SOURCE), "per-model override")
  assert.equal(budgetSourceLabel(MODEL_BUDGET_SOURCE), "per-model limit")
  assert.equal(budgetSourceLabel(DEFAULT_BUDGET_SOURCE), "plugin default")
  assert.equal(budgetSourceLabel(UNKNOWN_BUDGET_SOURCE), "inactive (no budget)")
  assert.equal(budgetSourceLabel("anything-else"), "inactive (no budget)")
})

test("the default metrics path matches the plugin's log location", () => {
  assert.equal(DEFAULT_METRICS_PATH, join(homedir(), ".local", "share", "opencode", "lru-metrics.jsonl"))
})

type StatsTool = { execute: (args: unknown, context: unknown) => Promise<unknown> }

test("the panel's default metrics path matches the plugin core's resolved metrics path", async () => {
  const hooks = (await lruContextFactory({}, { metricsLog: false, liveStateLog: false })) as Record<string, Record<string, StatsTool>>
  const stats = JSON.parse((await hooks["tool"]["lru_stats"].execute({}, { sessionID: SESSION_A })) as string) as {
    options: { metricsPath: string }
  }

  assert.equal(stats.options.metricsPath, DEFAULT_METRICS_PATH)
})

const SNAPSHOT_SUFFIX = ".json"
const SNAPSHOT_STASH_ENTRIES = 2
const SNAPSHOT_STASH_CAPACITY = 50
const SNAPSHOT_HOT_SUBJECTS = ["/data/hot-a.txt", "/data/hot-b.txt"]
const SNAPSHOT_TS = "2026-09-18T09:00:00.000Z"
const LOG_LINE_TS_STALE = "2026-09-18T08:00:00.000Z"
const LOG_LINE_TS_NEWER = "2026-09-18T10:00:00.000Z"
const LOG_LINE_ONLY_EVICTIONS = TOTALS_EVICTIONS + 1
const SESSION_A_LOG_LINE_COUNT = 1

const makeSnapshot = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  ts: SNAPSHOT_TS,
  session: SESSION_A,
  manualMode: true,
  modelContextTokens: BUDGET_TOKENS_MODEL,
  modelContextTokensSource: MODEL_BUDGET_SOURCE,
  lastRun: { estimatedTokens: ESTIMATED_TOKENS, watermarkTokens: WATERMARK_TOKENS, deficitTokens: DEFICIT_TOKENS },
  totals: makeTotals(),
  stash: { entries: SNAPSHOT_STASH_ENTRIES, capacity: SNAPSHOT_STASH_CAPACITY },
  hotSubjects: SNAPSHOT_HOT_SUBJECTS,
  ...overrides,
})

const writeSnapshot = (stateDir: string, sessionID: string, snapshot: unknown): void => {
  writeFileSync(join(stateDir, `${sessionID}${SNAPSHOT_SUFFIX}`), `${JSON.stringify(snapshot)}\n`)
}

const logLineAgainstSnapshot = (ts: string): PanelMetricsLine =>
  makeLine({
    ts,
    modelContextTokens: BUDGET_TOKENS_SMALL,
    estimatedTokens: SECOND_LINE_ESTIMATED,
    totals: { ...makeTotals(), evictions: LOG_LINE_ONLY_EVICTIONS },
  })

const logLineStaleAgainstSnapshot = (): PanelMetricsLine => logLineAgainstSnapshot(LOG_LINE_TS_STALE)

const logLineNewerThanSnapshot = (): PanelMetricsLine => logLineAgainstSnapshot(LOG_LINE_TS_NEWER)

test("parseStateSnapshot parses a snapshot carrying exactly the fields the panel consumes", () => {
  const snapshot = parseStateSnapshot(JSON.stringify(makeSnapshot()))

  assert.ok(snapshot !== undefined)
  assert.equal(snapshot.ts, SNAPSHOT_TS)
  assert.equal(snapshot.session, SESSION_A)
  assert.equal(snapshot.manualMode, true)
  assert.equal(snapshot.modelContextTokens, BUDGET_TOKENS_MODEL)
  assert.equal(snapshot.modelContextTokensSource, MODEL_BUDGET_SOURCE)
  assert.deepEqual(snapshot.lastRun, {
    estimatedTokens: ESTIMATED_TOKENS,
    watermarkTokens: WATERMARK_TOKENS,
    deficitTokens: DEFICIT_TOKENS,
  })
  assert.equal(snapshot.totals.evictions, TOTALS_EVICTIONS)
  assert.deepEqual(snapshot.stash, { entries: SNAPSHOT_STASH_ENTRIES, capacity: SNAPSHOT_STASH_CAPACITY })
  assert.deepEqual(snapshot.hotSubjects, SNAPSHOT_HOT_SUBJECTS)
})

test("parseStateSnapshot accepts a null unknown-budget watermark trio like the metrics line", () => {
  const snapshot = parseStateSnapshot(
    JSON.stringify(makeSnapshot({ modelContextTokens: null, lastRun: { estimatedTokens: ESTIMATED_TOKENS, watermarkTokens: null, deficitTokens: null } })),
  )

  assert.ok(snapshot !== undefined)
  assert.equal(snapshot.modelContextTokens, null)
  assert.deepEqual(snapshot.lastRun, { estimatedTokens: ESTIMATED_TOKENS, watermarkTokens: null, deficitTokens: null })
})

test("parseStateSnapshot rejects snapshots that are not valid JSON or miss required fields", () => {
  assert.equal(parseStateSnapshot("{not json"), undefined)
  assert.equal(parseStateSnapshot(JSON.stringify({ session: SESSION_A })), undefined)
  assert.equal(parseStateSnapshot(JSON.stringify(makeSnapshot({ ts: 42 }))), undefined)
  assert.equal(parseStateSnapshot(JSON.stringify(makeSnapshot({ manualMode: "yes" }))), undefined)
  assert.equal(parseStateSnapshot(JSON.stringify(makeSnapshot({ modelContextTokensSource: 42 }))), undefined)
  assert.equal(parseStateSnapshot(JSON.stringify(makeSnapshot({ totals: { ...makeTotals(), evictions: "many" } }))), undefined)
  assert.equal(parseStateSnapshot(JSON.stringify(makeSnapshot({ stash: { entries: SNAPSHOT_STASH_ENTRIES } }))), undefined)
  assert.equal(parseStateSnapshot(JSON.stringify(makeSnapshot({ lastRun: { estimatedTokens: ESTIMATED_TOKENS } }))), undefined)
  assert.equal(parseStateSnapshot(JSON.stringify(makeSnapshot({ hotSubjects: ["ok", 42] }))), undefined)
})

test("readStateSnapshot returns undefined when the snapshot file is missing", async () => {
  await withTempDir(async (dir) => {
    assert.equal(await readStateSnapshot(join(dir, "absent.json"), SESSION_A), undefined)
  })
})

test("readStateSnapshot rejects a genuine read fault instead of swallowing it", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(readStateSnapshot(dir, SESSION_A))
  })
})

test("loadPanelData prefers the live snapshot for the session block and keeps log history for runs and recent evictions", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "lru-state")
    mkdirSync(stateDir)
    writeFileSync(path, serialize([logLineStaleAgainstSnapshot(), makeLine({ session: SESSION_B })]))
    writeSnapshot(stateDir, SESSION_A, makeSnapshot())

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.equal(data.activeSession, SESSION_A)
    assert.ok(data.current !== undefined)
    assert.equal(data.current.session, SESSION_A)
    assert.equal(data.current.budgetTokens, BUDGET_TOKENS_MODEL)
    assert.equal(data.current.budgetSource, MODEL_BUDGET_SOURCE)
    assert.equal(data.current.manualMode, true)
    assert.deepEqual(data.current.lastRun, {
      estimatedTokens: ESTIMATED_TOKENS,
      watermarkTokens: WATERMARK_TOKENS,
      deficitTokens: DEFICIT_TOKENS,
    })
    assert.deepEqual(data.current.totals, makeTotals())
    assert.equal(data.current.stashReads, TOTALS_STASH_HITS + TOTALS_STASH_MISSES)
    assert.deepEqual(data.current.stash, { entries: SNAPSHOT_STASH_ENTRIES, capacity: SNAPSHOT_STASH_CAPACITY })
    assert.deepEqual(data.current.hotSubjects, SNAPSHOT_HOT_SUBJECTS)
    assert.equal(data.current.runs, SESSION_A_LOG_LINE_COUNT)
    assert.equal(data.current.recentEvictions.length, 1)
    assert.equal(data.current.recentEvictions[0].subject, "/data/a.txt")

    const rows = panelRows(data)
    assert.ok(rows.some((row) => row.text === "mode: manual"))
    assert.ok(
      rows.some(
        (row) =>
          row.text ===
          `stash reads: ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES} (${TOTALS_STASH_HITS} hits / ${TOTALS_STASH_MISSES} misses), dropped: ${TOTALS_STASH_DROPPED}, occupancy: ${SNAPSHOT_STASH_ENTRIES}/${SNAPSHOT_STASH_CAPACITY}`,
      ),
    )
    assert.ok(rows.some((row) => row.text === `hot subjects: ${SNAPSHOT_HOT_SUBJECTS.join(", ")}`))
  })
})

test("loadPanelData lets the session's newer log line win the fields it carries while snapshot-only fields stay", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "lru-state")
    mkdirSync(stateDir)
    writeFileSync(path, serialize([logLineNewerThanSnapshot()]))
    writeSnapshot(stateDir, SESSION_A, makeSnapshot())

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.ok(data.current !== undefined)
    assert.equal(data.current.budgetTokens, BUDGET_TOKENS_SMALL)
    assert.equal(data.current.lastRun.estimatedTokens, SECOND_LINE_ESTIMATED)
    assert.deepEqual(data.current.totals, logLineNewerThanSnapshot().totals)
    assert.equal(data.current.manualMode, true)
    assert.deepEqual(data.current.stash, { entries: SNAPSHOT_STASH_ENTRIES, capacity: SNAPSHOT_STASH_CAPACITY })
    assert.deepEqual(data.current.hotSubjects, SNAPSHOT_HOT_SUBJECTS)
    assert.equal(data.current.runs, SESSION_A_LOG_LINE_COUNT)
    assert.equal(data.current.recentEvictions.length, 1)
    assert.ok(panelRows(data).some((row) => row.text === "mode: manual"))
  })
})

test("loadPanelData keeps the snapshot's fields when the newest log line shares the snapshot's timestamp", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "lru-state")
    mkdirSync(stateDir)
    writeFileSync(path, serialize([logLineAgainstSnapshot(SNAPSHOT_TS)]))
    writeSnapshot(stateDir, SESSION_A, makeSnapshot())

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.ok(data.current !== undefined)
    assert.equal(data.current.budgetTokens, BUDGET_TOKENS_MODEL)
    assert.equal(data.current.lastRun.estimatedTokens, ESTIMATED_TOKENS)
    assert.deepEqual(data.current.totals, makeTotals())
    assert.equal(data.current.manualMode, true)
    assert.deepEqual(data.current.stash, { entries: SNAPSHOT_STASH_ENTRIES, capacity: SNAPSHOT_STASH_CAPACITY })
  })
})

test("loadPanelData renders automatic mode for a snapshot recorded with manualMode false", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "lru-state")
    mkdirSync(stateDir)
    writeSnapshot(stateDir, SESSION_A, makeSnapshot({ manualMode: false }))

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.current?.manualMode, false)
    assert.ok(panelRows(data).some((row) => row.text === "mode: auto"))
  })
})

test("loadPanelData renders the snapshot block with empty history when no metrics log exists yet", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "absent-metrics.jsonl")
    const stateDir = join(dir, "lru-state")
    mkdirSync(stateDir)
    writeSnapshot(stateDir, SESSION_A, makeSnapshot({ manualMode: false }))

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.ok(data.current !== undefined)
    assert.equal(data.current.session, SESSION_A)
    assert.equal(data.current.budgetTokens, BUDGET_TOKENS_MODEL)
    assert.equal(data.current.manualMode, false)
    assert.deepEqual(data.current.totals, makeTotals())
    assert.deepEqual(data.current.stash, { entries: SNAPSHOT_STASH_ENTRIES, capacity: SNAPSHOT_STASH_CAPACITY })
    assert.equal(data.current.runs, 0)
    assert.deepEqual(data.current.recentEvictions, [])
    assert.ok(panelRows(data).some((row) => row.text === "mode: auto"))
  })
})

test("loadPanelData falls back to the metrics log when no snapshot exists for the session", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "lru-state")
    mkdirSync(stateDir)
    writeFileSync(path, serialize([logLineStaleAgainstSnapshot()]))

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.ok(data.current !== undefined)
    assert.equal(data.current.budgetTokens, BUDGET_TOKENS_SMALL)
    assert.equal(data.current.manualMode, undefined)
    assert.equal(data.current.stash, undefined)
    assert.equal(data.current.hotSubjects, undefined)
    assert.deepEqual(data.current.totals, logLineStaleAgainstSnapshot().totals)
    assert.equal(data.current.runs, SESSION_A_LOG_LINE_COUNT)

    const rows = panelRows(data)
    assert.ok(!rows.some((row) => row.text.startsWith("mode:")))
    assert.ok(!rows.some((row) => row.text.includes("occupancy:")))
    assert.ok(!rows.some((row) => row.text.startsWith("hot subjects:")))
    assert.ok(
      rows.some(
        (row) =>
          row.text ===
          `stash reads: ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES} (${TOTALS_STASH_HITS} hits / ${TOTALS_STASH_MISSES} misses), dropped: ${TOTALS_STASH_DROPPED}`,
      ),
    )
  })
})

test("loadPanelData degrades to the metrics log when the snapshot is malformed", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "lru-state")
    mkdirSync(stateDir)
    writeFileSync(path, serialize([logLineStaleAgainstSnapshot()]))
    writeFileSync(join(stateDir, `${SESSION_A}${SNAPSHOT_SUFFIX}`), "{not json")

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.ok(data.current !== undefined)
    assert.equal(data.current.budgetTokens, BUDGET_TOKENS_SMALL)
    assert.equal(data.current.manualMode, undefined)
    assert.equal(data.current.stash, undefined)
  })
})

test("loadPanelData falls back to the metrics log when the snapshot file cannot be read", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "lru-state")
    mkdirSync(stateDir)
    mkdirSync(join(stateDir, `${SESSION_A}${SNAPSHOT_SUFFIX}`))
    writeFileSync(path, serialize([logLineStaleAgainstSnapshot()]))

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.ok(data.current !== undefined)
    assert.equal(data.current.budgetTokens, BUDGET_TOKENS_SMALL)
    assert.equal(data.current.manualMode, undefined)
    assert.equal(data.current.stash, undefined)
  })
})

test("loadPanelData serves the snapshot block alongside the log warning when the metrics log cannot be read", async () => {
  await withTempDir(async (dir) => {
    const directoryPath = join(dir, "metrics-dir")
    mkdirSync(directoryPath)
    const stateDir = join(dir, "lru-state")
    mkdirSync(stateDir)
    writeSnapshot(stateDir, SESSION_A, makeSnapshot())

    const data = await loadPanelData({ path: directoryPath, stateDir, sessionID: SESSION_A })

    assert.ok(data.error !== undefined)
    assert.ok(data.current !== undefined)
    assert.equal(data.current.budgetTokens, BUDGET_TOKENS_MODEL)
    assert.equal(data.current.manualMode, true)
    assert.deepEqual(data.current.totals, makeTotals())
    assert.deepEqual(data.current.stash, { entries: SNAPSHOT_STASH_ENTRIES, capacity: SNAPSHOT_STASH_CAPACITY })
    assert.equal(data.current.runs, 0)
    assert.deepEqual(data.current.recentEvictions, [])

    const rows = panelRows(data)
    assert.ok(rows.some((row) => row.text.startsWith("metrics log unreadable:")))
    assert.ok(rows.some((row) => row.text === "mode: manual"))
    assert.ok(rows.some((row) => row.text === "budget: ~200k tokens (per-model limit)"))
    assert.ok(!rows.some((row) => row.text.startsWith("history:")))
  })
})

test("loadPanelData ignores a snapshot file whose recorded session does not match the requested id", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "lru-state")
    mkdirSync(stateDir)
    writeFileSync(path, serialize([logLineStaleAgainstSnapshot()]))
    writeSnapshot(stateDir, SESSION_A, makeSnapshot({ session: SESSION_B }))

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.ok(data.current !== undefined)
    assert.equal(data.current.budgetTokens, BUDGET_TOKENS_SMALL)
    assert.equal(data.current.manualMode, undefined)
  })
})

test("the default live state dir matches the plugin core's resolved state path", async () => {
  const hooks = (await lruContextFactory({}, { metricsLog: false, liveStateLog: false })) as Record<string, Record<string, StatsTool>>
  const stats = JSON.parse((await hooks["tool"]["lru_stats"].execute({}, { sessionID: SESSION_A })) as string) as {
    options: { liveStatePath: string }
  }

  assert.equal(DEFAULT_LIVE_STATE_DIR, join(homedir(), ".local", "share", "opencode", "lru-state"))
  assert.equal(stats.options.liveStatePath, DEFAULT_LIVE_STATE_DIR)
})

test("panelRows renders the current session's budget, last run, counters, and recent evictions", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData(
      [
        makeLine({
          evictedThisRun: [{ tool: "read", subject: "/data/a.txt", bytes: EVICTED_BYTES, messagesAgo: EVICTED_MESSAGES_AGO }],
        }),
      ],
      SESSION_A,
    ),
    global: globalTotals([makeLine()]),
    error: undefined,
  }

  const rows = panelRows(data)

  assert.equal(rows[0].text, "LRU context manager")
  assert.equal(rows[0].tone, "header")
  assert.ok(rows.some((row) => row.text === `session: ${SESSION_A}`))
  assert.ok(rows.some((row) => row.text === `budget: ~200k tokens (per-model limit)`))
  assert.ok(rows.some((row) => row.text === "last run: ~123.5k estimated vs ~100k watermark (over by ~23.5k)"))
  assert.ok(rows.some((row) => row.text === `evictions: ${TOTALS_EVICTIONS} (12 kB reclaimed), fences: ${TOTALS_FENCE_EVICTED}, dedup: ${TOTALS_DEDUPED}, reasoning: ${TOTALS_REASONING_EXPIRED} (2.5 kB), touches: ${TOTALS_TOUCHES}`))
  assert.ok(rows.some((row) => row.text === `stash reads: ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES} (${TOTALS_STASH_HITS} hits / ${TOTALS_STASH_MISSES} misses), dropped: ${TOTALS_STASH_DROPPED}`))
  assert.ok(rows.some((row) => row.text === "recently evicted:"))
  assert.ok(rows.some((row) => row.text === `read /data/a.txt (3 kB, ${EVICTED_MESSAGES_AGO} msgs ago)`))
  assert.equal(rows[rows.length - 1].tone, "muted")
  assert.ok(rows[rows.length - 1].text.startsWith("history: 1 sessions, 1 runs,"))
})

test("panelRows marks an unknown budget inactive and omits watermark fields when null", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData(
      [makeLine({ modelContextTokens: null, modelContextTokensSource: UNKNOWN_BUDGET_SOURCE, watermarkTokens: null, deficitTokens: null })],
      SESSION_A,
    ),
    global: globalTotals([]),
    error: undefined,
  }

  const rows = panelRows(data)

  assert.ok(rows.some((row) => row.text === "budget: inactive (no budget)"))
  assert.ok(rows.some((row) => row.text === "last run: ~123.5k estimated, no watermark"))
})

test("panelRows labels an override-sourced budget as a per-model override", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData([makeLine({ modelContextTokensSource: OVERRIDE_BUDGET_SOURCE })], SESSION_A),
    global: globalTotals([]),
    error: undefined,
  }

  const rows = panelRows(data)

  assert.ok(rows.some((row) => row.text === "budget: ~200k tokens (per-model override)"))
})

test("panelRows reports a session without recorded runs distinctly from a panel opened outside any session", () => {
  const noMetricsData = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_B,
    current: undefined,
    global: globalTotals([makeLine({ session: SESSION_B })]),
    error: undefined,
  }

  const noMetricsRows = panelRows(noMetricsData)

  assert.ok(noMetricsRows.some((row) => row.text === "no metrics recorded for this session yet"))
  assert.ok(!noMetricsRows.some((row) => row.text === "no active session"))
  assert.ok(!noMetricsRows.some((row) => row.text.startsWith("budget:")))
  assert.ok(noMetricsRows[noMetricsRows.length - 1].text.startsWith("history: 1 sessions, 1 runs,"))

  const noSessionRows = panelRows({ ...noMetricsData, activeSession: undefined })

  assert.ok(noSessionRows.some((row) => row.text === "no active session"))
  assert.ok(!noSessionRows.some((row) => row.text === "no metrics recorded for this session yet"))
  assert.ok(noSessionRows[noSessionRows.length - 1].text.startsWith("history: 1 sessions, 1 runs,"))
})

test("panelRows surfaces a log read error as the warning row and omits session details", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: undefined,
    global: globalTotals([]),
    error: "EACCES: permission denied",
  }

  const rows = panelRows(data)

  assert.deepEqual(rows, [
    { text: "LRU context manager", tone: "header" },
    { text: "metrics log unreadable: EACCES: permission denied", tone: "warning" },
  ])
})
