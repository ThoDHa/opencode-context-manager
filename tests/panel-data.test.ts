import assert from "node:assert/strict"
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  DEFAULT_LIVE_STATE_DIR,
  DEFAULT_METRICS_PATH,
  budgetSourceLabel,
  canRegisterKeymap,
  canRegisterSidebar,
  createMetricsLogReader,
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
} from "../plugin/panel-data.ts"
import { TOTALS_KEYS } from "../plugin/schema.ts"
import contextManagerEntry from "../plugin/context-manager.ts"
import {
  BUDGET_TOKENS_MODEL,
  BUDGET_TOKENS_SMALL,
  DEFICIT_TOKENS,
  ESTIMATED_TOKENS,
  EVICTED_BYTES,
  EVICTED_MESSAGES_AGO,
  HUGE_RECLAIMED_BYTES,
  LOG_LINE_ONLY_EVICTIONS,
  LOG_LINE_TS_STALE,
  MODEL_BUDGET_SOURCE,
  OVERRIDE_BUDGET_SOURCE,
  SECOND_LINE_ESTIMATED,
  SESSION_A,
  SESSION_B,
  SNAPSHOT_HOT_SUBJECTS,
  SNAPSHOT_STASH_CAPACITY,
  SNAPSHOT_STASH_ENTRIES,
  SNAPSHOT_SUFFIX,
  SNAPSHOT_TS,
  TOTALS_BYTES,
  TOTALS_DEDUPED_UNIQUE,
  TOTALS_EVICTIONS,
  TOTALS_FENCE_EVICTED,
  TOTALS_REASONING_BYTES_UNIQUE,
  TOTALS_REASONING_EXPIRED_UNIQUE,
  TOTALS_STASH_HITS,
  TOTALS_STASH_MISSES,
  UNKNOWN_BUDGET_SOURCE,
  WATERMARK_TOKENS,
  logLineAgainstSnapshot,
  logLineStaleAgainstSnapshot,
  makeLine,
  makeSnapshot,
  makeTotals,
  makePreSchemaTotals,
  makePreTokenUsageTotals,
  TOTALS_COLLAPSED_WINDOWS,
  TOTALS_COLLAPSED_WINDOW_BYTES,
  TOTALS_COLLAPSED_WINDOW_TOKENS_SAVED,
  serialize,
  withTempDir,
  writeSnapshot,
} from "./panel-fixtures.ts"

const contextManagerFactory = contextManagerEntry.server

const RECENT_LIMIT = 2
const EVICTION_COUNT_PER_LINE = 3
const SINGLE_LINE_COUNT = 1
const LINE_COUNT_TWO = 2
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
const MEGABYTE_BYTES = 1500000
const GIGABYTE_BYTES = 3 * 1024 ** 3
const SUBJECT_TAIL = "-tail"
const DEFAULT_BUDGET_SOURCE = "default"

const LOG_LINE_TS_NEWER = "2026-09-18T10:00:00.000Z"
const SESSION_A_LOG_LINE_COUNT = 1

const logLineNewerThanSnapshot = (): PanelMetricsLine => logLineAgainstSnapshot(LOG_LINE_TS_NEWER)

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

test("parseMetricsLine rejects a line whose totals carry a non-numeric or missing counter", () => {
  const rawNonNumericEvictions = JSON.stringify(makeLine({ totals: { ...makeTotals(), evictions: "many" } }))
  const rawNonNumericFenceEvictions = JSON.stringify(makeLine({ totals: { ...makeTotals(), fenceEvicted: "some" } }))
  const rawNonNumericEvictionTokensSaved = JSON.stringify(
    makeLine({ totals: { ...makeTotals(), evictionTokensSaved: "plenty" } }),
  )
  const rawNonNumericDedupTokensSaved = JSON.stringify(makeLine({ totals: { ...makeTotals(), dedupTokensSaved: "some" } }))
  const rawNonNumericReasoningTokensSaved = JSON.stringify(
    makeLine({ totals: { ...makeTotals(), reasoningTokensSaved: "gobs" } }),
  )
  const rawNonNumericDedupedUnique = JSON.stringify(makeLine({ totals: { ...makeTotals(), dedupedUnique: "few" } }))
  const rawNonNumericReasoningExpiredUnique = JSON.stringify(
    makeLine({ totals: { ...makeTotals(), reasoningExpiredUnique: "hundreds" } }),
  )
  const rawNonNumericReasoningBytesExpiredUnique = JSON.stringify(
    makeLine({ totals: { ...makeTotals(), reasoningBytesExpiredUnique: "tons" } }),
  )
  const rawNonNumericProcessedContextBytes = JSON.stringify(
    makeLine({ totals: { ...makeTotals(), processedContextBytes: "heaps" } }),
  )
  const rawNonNumericProcessedContextTokens = JSON.stringify(
    makeLine({ totals: { ...makeTotals(), processedContextTokens: "loads" } }),
  )
  // JSON.stringify drops undefined values, so this line's totals lack the
  // key entirely: the pre-upgrade shape rejected per the savings-key
  // precedent instead of being read with the counter zeroed.
  const rawMissingReasoningBytesExpiredUnique = JSON.stringify(
    makeLine({ totals: { ...makeTotals(), reasoningBytesExpiredUnique: undefined } }),
  )

  assert.equal(parseMetricsLine(rawNonNumericEvictions), undefined)
  assert.equal(parseMetricsLine(rawNonNumericFenceEvictions), undefined)
  assert.equal(parseMetricsLine(rawNonNumericEvictionTokensSaved), undefined)
  assert.equal(parseMetricsLine(rawNonNumericDedupTokensSaved), undefined)
  assert.equal(parseMetricsLine(rawNonNumericReasoningTokensSaved), undefined)
  assert.equal(parseMetricsLine(rawNonNumericDedupedUnique), undefined)
  assert.equal(parseMetricsLine(rawNonNumericReasoningExpiredUnique), undefined)
  assert.equal(parseMetricsLine(rawNonNumericReasoningBytesExpiredUnique), undefined)
  assert.equal(parseMetricsLine(rawNonNumericProcessedContextBytes), undefined)
  assert.equal(parseMetricsLine(rawNonNumericProcessedContextTokens), undefined)
  assert.equal(parseMetricsLine(rawMissingReasoningBytesExpiredUnique), undefined)
})

test("parseMetricsLine and parseStateSnapshot drop pre-upgrade records whose totals predate the token-savings keys", () => {
  const legacyTotals = makePreSchemaTotals()
  const legacyLine = JSON.stringify(makeLine({ totals: legacyTotals }))
  const legacySnapshot = JSON.stringify(makeSnapshot({ totals: legacyTotals }))

  assert.equal(parseMetricsLine(legacyLine), undefined)
  assert.equal(parseStateSnapshot(legacySnapshot), undefined)
})

test("readMetricsLog keeps the newest parseable line per session and skips pre-upgrade and malformed lines in a mixed log", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const legacyTotals = makePreSchemaTotals()
    const legacyLine = JSON.stringify(makeLine({ totals: legacyTotals }))
    const currentLine = JSON.stringify(makeLine())
    const malformedLine = "{not json"
    writeFileSync(path, [legacyLine, currentLine, malformedLine].join("\n") + "\n")

    const lines = await readMetricsLog(path)

    assert.deepEqual(lines, [makeLine()])
  })
})

test("readMetricsLog keeps every line of a log whose all lines parse strict", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine(), makeLine({ session: SESSION_B }), makeLine()]))

    const lines = await readMetricsLog(path)

    assert.equal(lines.length, LINE_COUNT_THREE)
    assert.deepEqual(lines, [makeLine(), makeLine({ session: SESSION_B }), makeLine()])
  })
})

test("readMetricsLog preserves the eviction footer and runs count of strict sessions while tolerating a stale session", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const evictionLine = makeLine()
    const evictionFreeLine = makeLine({ evictedThisRun: [] })
    const staleLine = JSON.stringify(makeLine({ session: SESSION_B, totals: makePreSchemaTotals() }))
    writeFileSync(path, serialize([evictionLine, evictionFreeLine]) + staleLine + "\n")

    const lines = await readMetricsLog(path)
    const panel = sessionPanelData(lines, SESSION_A)

    assert.ok(panel !== undefined)
    assert.equal(panel.runs, LINE_COUNT_TWO)
    assert.deepEqual(panel.recentEvictions, [evictionLine.evictedThisRun[0]])
  })
})

test("parseTotals defaults an absent dedupedBytes to zero while still rejecting other missing keys", () => {
  const { dedupedBytes: _dedupedBytes, ...preDedupedBytesTotals } = makeTotals()
  const raw = JSON.stringify(makeLine({ totals: preDedupedBytesTotals }))

  const line = parseMetricsLine(raw)

  assert.ok(line !== undefined)
  assert.equal(line.totals.dedupedBytes, 0)
  const { fenceEvicted: _fenceEvicted, ...missingFenceTotals } = makeTotals()
  assert.equal(parseMetricsLine(JSON.stringify(makeLine({ totals: missingFenceTotals }))), undefined)
})

test("parseTotals defaults the absent processed context keys to zero while still rejecting other missing keys", () => {
  const preTokenUsageTotals = makePreTokenUsageTotals()
  const rawLine = JSON.stringify(makeLine({ totals: preTokenUsageTotals }))
  const rawSnapshot = JSON.stringify(makeSnapshot({ totals: preTokenUsageTotals }))

  const line = parseMetricsLine(rawLine)
  const snapshot = parseStateSnapshot(rawSnapshot)

  assert.ok(line !== undefined)
  assert.equal(line.totals.processedContextBytes, 0)
  assert.equal(line.totals.processedContextTokens, 0)
  assert.ok(snapshot !== undefined)
  assert.equal(snapshot.totals.processedContextBytes, 0)
  assert.equal(snapshot.totals.processedContextTokens, 0)
  const { fenceEvicted: _fenceEvicted, ...missingFenceTotals } = preTokenUsageTotals
  assert.equal(parseMetricsLine(JSON.stringify(makeLine({ totals: missingFenceTotals }))), undefined)
})

test("readMetricsLog keeps a pre-token-usage line alongside current lines once its missing keys default to zero", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine({ totals: makePreTokenUsageTotals() }), makeLine()]))

    const lines = await readMetricsLog(path)

    assert.equal(lines.length, LINE_COUNT_TWO)
    assert.equal(lines[0].totals.processedContextBytes, 0)
    assert.equal(lines[0].totals.processedContextTokens, 0)
    assert.deepEqual(lines[1], makeLine())
  })
})

test("the fixture totals carry exactly the shared schema keys at runtime", () => {
  assert.deepEqual(Object.keys(makeTotals()).sort(), [...TOTALS_KEYS].sort())
})

const appendLine = (path: string, line: PanelMetricsLine): void => {
  appendFileSync(path, `${JSON.stringify(line)}\n`)
}

test("the incremental reader matches the full read after appends", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine()]))
    const reader = createMetricsLogReader(path)
    const first = await reader.load()
    assert.equal(first.length, SINGLE_LINE_COUNT)

    appendLine(path, makeLine({ session: SESSION_B }))
    const second = await reader.load()
    assert.equal(second.length, PARSED_LINE_COUNT)
    assert.equal(second[1].session, SESSION_B)

    // A cold full read produces the identical line list.
    const cold = await readMetricsLog(path)
    assert.deepEqual(second, cold)
  })
})

test("the incremental reader falls back to a full read when the file shrinks (rotation)", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine(), makeLine({ session: SESSION_B }), makeLine()]))
    const reader = createMetricsLogReader(path)
    const first = await reader.load()
    assert.equal(first.length, LINE_COUNT_THREE)

    // Rotation replaced the file with a fresh generation holding one line.
    writeFileSync(path, serialize([makeLine({ ts: LOG_LINE_TS_NEWER })]))
    const second = await reader.load()

    assert.equal(second.length, SINGLE_LINE_COUNT)
    assert.deepEqual(second, [makeLine({ ts: LOG_LINE_TS_NEWER })])
  })
})

test("the incremental reader falls back to a full re-read when rotation swaps in a larger same-path generation", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine()]))
    const reader = createMetricsLogReader(path)
    const first = await reader.load()
    assert.equal(first.length, SINGLE_LINE_COUNT)

    // Rotation by rename: the new generation is larger than the old
    // offset, so the size-greater check alone would read only its tail;
    // the inode mismatch must take the full-re-read branch.
    const generationPath = join(dir, "next-generation.jsonl")
    writeFileSync(generationPath, serialize([makeLine({ ts: LOG_LINE_TS_NEWER }), makeLine({ session: SESSION_B, ts: LOG_LINE_TS_NEWER }), makeLine({ ts: LOG_LINE_TS_NEWER })]))
    renameSync(generationPath, path)

    const second = await reader.load()

    assert.equal(second.length, LINE_COUNT_THREE)
    assert.deepEqual(second.map((line) => line.session), [SESSION_A, SESSION_B, SESSION_A])
  })
})

test("the incremental reader preserves tolerance semantics when a stale-marking line arrives in a later chunk", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine(), makeLine({ session: SESSION_B })]))
    const reader = createMetricsLogReader(path)
    const first = await reader.load()
    assert.equal(first.length, LINE_COUNT_TWO)

    // The appended chunk carries a line the strict parser rejects for
    // SESSION_A: from this point on, SESSION_A collapses to its newest
    // parseable line while SESSION_B keeps every line.
    appendLine(path, makeLine({ totals: makePreSchemaTotals() }))

    const second = await reader.load()

    assert.equal(second.length, LINE_COUNT_TWO)
    assert.deepEqual(second.map((line) => line.session), [SESSION_A, SESSION_B])
    assert.deepEqual(second[0].totals, makeTotals())
    const expectedFullRead = await readMetricsLog(path)
    assert.deepEqual(second, expectedFullRead)
  })
})

// Shape one: strict-session retention across two loads, then a
// rejecting-only chunk collapses session A to newest-only.
test("the incremental reader retains two parseable lines for a strict session until a rejecting line collapses it to newest-only", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    // Two parseable SESSION_A lines across two loads (the strict-session
    // retention the parity invariant rests on), then a rejecting-only
    // chunk for A: the retained state must collapse to the newest A line,
    // equal to readMetricsLog over the same full content.
    writeFileSync(path, serialize([makeLine()]))
    const reader = createMetricsLogReader(path)
    const first = await reader.load()
    assert.equal(first.length, SINGLE_LINE_COUNT)

    appendLine(path, makeLine({ ts: LOG_LINE_TS_NEWER }))
    const two = await reader.load()
    assert.equal(two.length, LINE_COUNT_TWO)

    appendLine(path, makeLine({ totals: makePreSchemaTotals() }))
    const third = await reader.load()

    assert.equal(third.length, SINGLE_LINE_COUNT)
    assert.deepEqual(third, [makeLine({ ts: LOG_LINE_TS_NEWER })])
    const expectedFullRead = await readMetricsLog(path)
    assert.deepEqual(third, expectedFullRead)
  })
})

test("the incremental reader collapses a session whose only retained line predates its rejecting line in a later chunk", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine()]))
    const reader = createMetricsLogReader(path)
    const first = await reader.load()
    assert.equal(first.length, SINGLE_LINE_COUNT)

    // Reviewer's shape two: the retained list holds [A1] when the
    // chunk appends only a rejecting line for A. A1 is parseable, so the
    // cold read of the same content keeps it; the persistent stale set
    // matters for divergence only when A has multiple retained lines
    // (the sibling test). Here the assertion is full-read parity: A1
    // stays, and A is now a stale session so any future A1-then-rejecting
    // sequence collapses exactly as a cold read would.
    appendLine(path, makeLine({ totals: makePreSchemaTotals() }))

    const second = await reader.load()

    assert.equal(second.length, SINGLE_LINE_COUNT)
    const expectedFullRead = await readMetricsLog(path)
    assert.deepEqual(second, expectedFullRead)

    // The divergence the persistent set closes: a third load with nothing
    // new still matches, and a later parseable A2 collapses A1 (kept
    // newest-only for the stale session) matching the cold read.
    appendLine(path, makeLine({ ts: LOG_LINE_TS_NEWER }))
    const third = await reader.load()
    assert.equal(third.length, SINGLE_LINE_COUNT)
    assert.deepEqual(third, [makeLine({ ts: LOG_LINE_TS_NEWER })])
    const expectedThirdFullRead = await readMetricsLog(path)
    assert.deepEqual(third, expectedThirdFullRead)
  })
})

test("the incremental reader collapses the older line when a stale-marking line lands between two parseable lines of one session", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine()]))
    const reader = createMetricsLogReader(path)
    const first = await reader.load()
    assert.equal(first.length, SINGLE_LINE_COUNT)

    // Shape two from the review: retained [A1], then the chunk appends
    // rejecting X(A) followed by a parseable A2. The backward walk keeps
    // A2 (the newest) and splices A1, matching the cold read.
    appendLine(path, makeLine({ totals: makePreSchemaTotals() }))
    appendLine(path, makeLine({ ts: LOG_LINE_TS_NEWER }))

    const second = await reader.load()

    assert.equal(second.length, SINGLE_LINE_COUNT)
    assert.deepEqual(second, [makeLine({ ts: LOG_LINE_TS_NEWER })])
    const expectedFullRead = await readMetricsLog(path)
    assert.deepEqual(second, expectedFullRead)
  })
})

test("loadPanelData with a held reader produces identical output across incremental loads", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine(), makeLine({ session: SESSION_B })]))
    const reader = createMetricsLogReader(path)

    const first = await loadPanelData({ path, sessionID: SESSION_A, reader })
    appendLine(path, makeLine())
    const second = await loadPanelData({ path, sessionID: SESSION_A, reader })

    assert.equal(first.global.runs, LINE_COUNT_TWO)
    assert.equal(second.global.runs, LINE_COUNT_THREE)
    assert.equal(second.global.sessions, LINE_COUNT_TWO)
    assert.deepEqual(second.current?.totals, makeTotals())
    // Full-read parity: the reader retains all parseable lines, so the
    // eviction footer walks both SESSION_A lines exactly as a cold read
    // of the same file would.
    assert.deepEqual(second.current?.recentEvictions, [
      makeLine().evictedThisRun[0],
      makeLine().evictedThisRun[0],
    ])

    // The readerless call path stays a full read and matches exactly.
    const readerless = await loadPanelData({ path, sessionID: SESSION_A })
    assert.equal(readerless.global.runs, LINE_COUNT_THREE)
    assert.deepEqual(readerless.current?.totals, second.current?.totals)
  })
})

test("a log mixing one pre-upgrade line with current lines yields the current newest totals and a global count that skips the stale line", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const legacyTotals = makePreSchemaTotals()
    const legacySessionLine = JSON.stringify(makeLine({ session: SESSION_B, totals: legacyTotals }))
    writeFileSync(path, serialize([makeLine()]) + legacySessionLine + "\n")

    const data = await loadPanelData({ path, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.deepEqual(data.current?.totals, makeTotals())
    assert.equal(data.global.sessions, 1)
    assert.equal(data.global.runs, 1)
    assert.equal(data.global.evictions, TOTALS_EVICTIONS)
  })
})

test("a session whose only lines are pre-upgrade falls back cleanly for the global block and the log-only session block", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const legacyTotals = makePreSchemaTotals()
    writeFileSync(path, serialize([makeLine({ session: SESSION_B, totals: legacyTotals })]))

    const data = await loadPanelData({ path, sessionID: SESSION_B })

    assert.equal(data.error, undefined)
    assert.equal(data.current, undefined)
    assert.equal(data.global.sessions, 0)
    assert.equal(data.global.runs, 0)
    assert.equal(data.global.evictions, 0)
  })
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
    wouldEvictThisRun: 4,
    wouldEvictBytesThisRun: 12288,
    toolPoolBytes: 9500,
    textChars: 1800,
    reasoningInWindowBytes: 512,
    escapeBytes: 96,
    attachmentBytes: 20480,
  })

  const line = parseMetricsLine(raw)

  assert.ok(line !== undefined)
  assert.equal(line.session, SESSION_A)
  assert.equal(line.ts, "2026-09-16T12:00:00.000Z")
  assert.equal(line.estimatedTokens, ESTIMATED_TOKENS)
  assert.equal(line.totals.dedupedUnique, TOTALS_DEDUPED_UNIQUE)
  assert.equal(line.totals.reasoningExpiredUnique, TOTALS_REASONING_EXPIRED_UNIQUE)
  assert.equal(line.totals.reasoningBytesExpiredUnique, TOTALS_REASONING_BYTES_UNIQUE)
  assert.equal(line.totals.collapsedWindows, TOTALS_COLLAPSED_WINDOWS)
  assert.equal(line.totals.collapsedWindowBytes, TOTALS_COLLAPSED_WINDOW_BYTES)
  assert.equal(line.totals.collapsedWindowTokensSaved, TOTALS_COLLAPSED_WINDOW_TOKENS_SAVED)
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

test("formatBytes renders sub-kilobyte counts as-is and larger sizes in kB, MB, and GB tiers", () => {
  assert.equal(formatBytes(PLAIN_BYTES), `${PLAIN_BYTES} B`)
  assert.equal(formatBytes(KILOBYTE_BYTES), "2 kB")
  assert.equal(formatBytes(KILOBYTE_FRACTIONAL_BYTES), "1.5 kB")
  assert.equal(formatBytes(MEGABYTE_BYTES), "1.4 MB")
  assert.equal(formatBytes(GIGABYTE_BYTES), "3 GB")
  assert.equal(formatBytes(HUGE_RECLAIMED_BYTES), "115 GB")
})

test("budgetSourceLabel maps the plugin's source ids to panel labels", () => {
  assert.equal(budgetSourceLabel(OVERRIDE_BUDGET_SOURCE), "per-model override")
  assert.equal(budgetSourceLabel(MODEL_BUDGET_SOURCE), "per-model limit")
  assert.equal(budgetSourceLabel(DEFAULT_BUDGET_SOURCE), "plugin default")
  assert.equal(budgetSourceLabel(UNKNOWN_BUDGET_SOURCE), "inactive (no budget)")
  assert.equal(budgetSourceLabel("anything-else"), "inactive (no budget)")
})

test("canRegisterSidebar accepts only an api object whose slots.register is callable", () => {
  assert.equal(canRegisterSidebar({ slots: { register: () => {} } }), true)
  assert.equal(canRegisterSidebar({ slots: { register: undefined } }), false)
  assert.equal(canRegisterSidebar({ slots: {} }), false)
  assert.equal(canRegisterSidebar({ slots: "yes" }), false)
  assert.equal(canRegisterSidebar({}), false)
  assert.equal(canRegisterSidebar(null), false)
  assert.equal(canRegisterSidebar("slots"), false)
  assert.equal(canRegisterSidebar(42), false)
  assert.equal(canRegisterSidebar(undefined), false)
  // A hostile getter must not propagate into the TUI mount path: reading
  // api.slots or slots.register through a throwing getter reads as
  // cannot-register.
  const throwingSlots = Object.create(null, { slots: { get: () => { throw new Error("slots getter exploded") } } })
  assert.equal(canRegisterSidebar(throwingSlots), false)
  const throwingRegister = { slots: Object.create(null, { register: { get: () => { throw new Error("register getter exploded") } } }) }
  assert.equal(canRegisterSidebar(throwingRegister), false)
})

test("canRegisterKeymap accepts only an api object whose keymap.registerLayer is callable", () => {
  assert.equal(canRegisterKeymap({ keymap: { registerLayer: () => {} } }), true)
  assert.equal(canRegisterKeymap({ keymap: { registerLayer: undefined } }), false)
  assert.equal(canRegisterKeymap({ keymap: {} }), false)
  assert.equal(canRegisterKeymap({ keymap: "yes" }), false)
  assert.equal(canRegisterKeymap({}), false)
  assert.equal(canRegisterKeymap(null), false)
  assert.equal(canRegisterKeymap("keymap"), false)
  assert.equal(canRegisterKeymap(42), false)
  assert.equal(canRegisterKeymap(undefined), false)
  const throwingKeymap = Object.create(null, { keymap: { get: () => { throw new Error("keymap getter exploded") } } })
  assert.equal(canRegisterKeymap(throwingKeymap), false)
  const throwingRegisterLayer = { keymap: Object.create(null, { registerLayer: { get: () => { throw new Error("registerLayer getter exploded") } } }) }
  assert.equal(canRegisterKeymap(throwingRegisterLayer), false)
})

test("the default metrics path matches the plugin's log location", () => {
  assert.equal(DEFAULT_METRICS_PATH, join(homedir(), ".local", "share", "opencode", "context-metrics.jsonl"))
})

type StatsTool = { execute: (args: unknown, context: unknown) => Promise<unknown> }

test("the panel's default metrics path matches the plugin core's resolved metrics path", async () => {
  const hooks = (await contextManagerFactory({}, { metricsLog: false, liveStateLog: false, ingestionHygieneCopy: false })) as Record<string, Record<string, StatsTool>>
  const stats = JSON.parse((await hooks["tool"]["context_stats"].execute({}, { sessionID: SESSION_A })) as string) as {
    options: { metricsPath: string }
  }

  assert.equal(stats.options.metricsPath, DEFAULT_METRICS_PATH)
})

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
    const stateDir = join(dir, "context-state")
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
    assert.equal(rows[0].text, "Context Manager (manual)")
    assert.equal(rows[0].tone, "header")
    assert.ok(
      rows.some(
        (row) =>
          row.text ===
          `counters: ${TOTALS_EVICTIONS} evictions (12 kB reclaimed, 3.1k tokens saved), ${TOTALS_DEDUPED_UNIQUE} dedup (2.3k tokens saved), ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES} stash reads (${TOTALS_STASH_HITS} hits)`,
      ),
    )
    assert.ok(!rows.some((row) => row.text.includes("occupancy:")))
    assert.ok(!rows.some((row) => row.text.startsWith("hot subjects:")))
  })
})

test("loadPanelData lets the session's newer log line win the fields it carries while snapshot-only fields stay", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "context-state")
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
    assert.equal(panelRows(data)[0].text, "Context Manager (manual)")
  })
})

test("loadPanelData keeps the snapshot's fields when the newest log line shares the snapshot's timestamp", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "context-state")
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
    const stateDir = join(dir, "context-state")
    mkdirSync(stateDir)
    writeSnapshot(stateDir, SESSION_A, makeSnapshot({ manualMode: false }))

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.current?.manualMode, false)
    assert.equal(panelRows(data)[0].text, "Context Manager")
  })
})

test("loadPanelData renders the snapshot block with empty history when no metrics log exists yet", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "absent-metrics.jsonl")
    const stateDir = join(dir, "context-state")
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
    assert.equal(panelRows(data)[0].text, "Context Manager")
  })
})

test("loadPanelData falls back to the metrics log when no snapshot exists for the session", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "context-state")
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
    assert.equal(rows[0].text, "Context Manager")
    assert.ok(!rows.some((row) => row.text.includes("occupancy:")))
    assert.ok(!rows.some((row) => row.text.startsWith("hot subjects:")))
    assert.ok(
      rows.some(
        (row) =>
          row.text ===
          `counters: ${LOG_LINE_ONLY_EVICTIONS} evictions (12 kB reclaimed, 3.1k tokens saved), ${TOTALS_DEDUPED_UNIQUE} dedup (2.3k tokens saved), ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES} stash reads (${TOTALS_STASH_HITS} hits)`,
      ),
    )
  })
})

test("loadPanelData degrades to the metrics log when the snapshot is malformed", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "context-state")
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
    const stateDir = join(dir, "context-state")
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
    const stateDir = join(dir, "context-state")
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
    assert.equal(rows[0].text, "Context Manager (manual)")
    assert.ok(rows.some((row) => row.text === "budget: 200k tokens (per-model limit)"))
    assert.ok(!rows.some((row) => row.text.startsWith("history:")))
  })
})

test("loadPanelData ignores a snapshot file whose recorded session does not match the requested id", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "context-state")
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
  const hooks = (await contextManagerFactory({}, { metricsLog: false, liveStateLog: false, ingestionHygieneCopy: false })) as Record<string, Record<string, StatsTool>>
  const stats = JSON.parse((await hooks["tool"]["context_stats"].execute({}, { sessionID: SESSION_A })) as string) as {
    options: { liveStatePath: string }
  }

  assert.equal(DEFAULT_LIVE_STATE_DIR, join(homedir(), ".local", "share", "opencode", "context-state"))
  assert.equal(stats.options.liveStatePath, DEFAULT_LIVE_STATE_DIR)
})

const CHILD_C = "sess-child-c"

test("loadPanelData resolves each child's panel with the snapshot-preferred logic over one shared log read", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "context-state")
    mkdirSync(stateDir)
    writeFileSync(path, serialize([logLineStaleAgainstSnapshot(), makeLine({ session: SESSION_B }), makeLine({ session: CHILD_C })]))
    writeSnapshot(stateDir, SESSION_A, makeSnapshot())

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A, childSessionIDs: [SESSION_A, SESSION_B, CHILD_C] })

    assert.equal(data.error, undefined)
    assert.ok(data.subagentPanels !== undefined)
    assert.equal(data.subagentPanels.length, LINE_COUNT_THREE)
    const [snapshotChild, logChild, thirdChild] = data.subagentPanels
    assert.equal(snapshotChild.id, SESSION_A)
    assert.ok(snapshotChild.panel !== undefined)
    assert.equal(snapshotChild.panel.manualMode, true)
    assert.deepEqual(snapshotChild.panel.totals, makeTotals())
    assert.equal(logChild.id, SESSION_B)
    assert.ok(logChild.panel !== undefined)
    assert.equal(logChild.panel.manualMode, undefined)
    assert.deepEqual(logChild.panel.totals, makeTotals())
    assert.equal(thirdChild.id, CHILD_C)
    assert.ok(thirdChild.panel !== undefined)
    assert.equal(thirdChild.panel.runs, 1)
    assert.equal(thirdChild.panel.manualMode, undefined)
  })
})

test("loadPanelData leaves a child without any data an undefined panel", async () => {
  await withTempDir(async (dir) => {
    const data = await loadPanelData({ path: join(dir, "absent-metrics.jsonl"), sessionID: SESSION_A, childSessionIDs: [SESSION_B] })

    assert.equal(data.error, undefined)
    assert.ok(data.subagentPanels !== undefined)
    assert.deepEqual(data.subagentPanels, [{ id: SESSION_B, panel: undefined }])
  })
})

test("loadPanelData omits the subagent panels when no child ids were requested", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, serialize([makeLine()]))

    const data = await loadPanelData({ path, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.equal(data.subagentPanels, undefined)
  })
})

test("loadPanelData serves child snapshots alongside the log warning when the metrics log cannot be read", async () => {
  await withTempDir(async (dir) => {
    const directoryPath = join(dir, "metrics-dir")
    mkdirSync(directoryPath)
    const stateDir = join(dir, "context-state")
    mkdirSync(stateDir)
    writeSnapshot(stateDir, SESSION_A, makeSnapshot())

    const data = await loadPanelData({ path: directoryPath, stateDir, sessionID: SESSION_A, childSessionIDs: [SESSION_A, SESSION_B] })

    assert.ok(data.error !== undefined)
    assert.ok(data.subagentPanels !== undefined)
    const [snapshotChild, missingChild] = data.subagentPanels
    assert.ok(snapshotChild.panel !== undefined)
    assert.equal(snapshotChild.panel.manualMode, true)
    assert.deepEqual(snapshotChild.panel.totals, makeTotals())
    assert.equal(missingChild.panel, undefined)
  })
})
