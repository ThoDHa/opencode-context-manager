import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
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
  readMetricsLog,
  sessionPanelData,
  type PanelMetricsLine,
} from "../../opencode/.config/opencode/plugin/lru-panel-data.ts"
import lruContextFactory from "../../opencode/.config/opencode/plugin/lru-context.ts"

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
  assert.equal(parseMetricsLine(JSON.stringify(makeLine({ totals: { ...makeTotals(), evictions: "many" } }))), undefined)
  assert.equal(parseMetricsLine(JSON.stringify(makeLine({ totals: { ...makeTotals(), fenceEvicted: "some" } }))), undefined)
})

test("parseMetricsLine rejects a line whose evicted entries are malformed", () => {
  const raw = JSON.stringify(makeLine({ evictedThisRun: [{ tool: "read", bytes: EVICTED_BYTES }] }))

  assert.equal(parseMetricsLine(raw), undefined)
})

test("parseMetricsLine accepts the plugin's lines that carry run-scoped fields the panel does not consume and the full totals schema", () => {
  const raw = JSON.stringify({
    ...makeLine(),
    ts: "2026-09-16T12:00:00.000Z",
    dedupedThisRun: 2,
    reasoningExpiredThisRun: 1,
    reasoningBytesExpiredThisRun: 512,
    fenceEvictedThisRun: 1,
    postEvictionTouchesThisRun: 1,
    stashReadsSinceLastLine: 3,
    totals: makeTotals(),
  })

  const line = parseMetricsLine(raw)

  assert.ok(line !== undefined)
  assert.equal(line.session, SESSION_A)
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
  const hooks = (await lruContextFactory({}, { metricsLog: false })) as Record<string, Record<string, StatsTool>>
  const stats = JSON.parse((await hooks["tool"]["lru_stats"].execute({}, { sessionID: SESSION_A })) as string) as {
    options: { metricsPath: string }
  }

  assert.equal(stats.options.metricsPath, DEFAULT_METRICS_PATH)
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
