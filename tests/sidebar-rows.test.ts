import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import {
  DEFAULT_SIDEBAR_ENABLED,
  SIDEBAR_COLUMN_LIMIT,
  globalTotals,
  loadPanelData,
  panelRows,
  resolveSidebarEnabled,
  sessionPanelData,
  sidebarRows,
  sidebarSubagentsGroup,
  type PanelData,
  type PanelRow,
  type SubagentChild,
} from "../plugin/panel-data.ts"
import {
  EVICTED_BYTES,
  EVICTED_MESSAGES_AGO,
  EXPECTED_DEDUPED_STAT,
  EXPECTED_REASONING_STAT,
  EXPECTED_TOKENS_USED_STAT,
  HUGE_RECLAIMED_BYTES,
  LOG_LINE_ONLY_EVICTIONS,
  OVERRIDE_BUDGET_SOURCE,
  SESSION_A,
  SESSION_B,
  TOTALS_EVICTIONS,
  TOTALS_STASH_HITS,
  TOTALS_STASH_MISSES,
  UNKNOWN_BUDGET_SOURCE,
  logLineStaleAgainstSnapshot,
  makeLine,
  makeSnapshot,
  makeTotals,
  serialize,
  withTempDir,
  writeSnapshot,
} from "./panel-fixtures.ts"

const OVER_LONG_SUBJECT = `/data/${"b".repeat(60)}.txt`
const LONG_READ_ERROR = "EACCES: permission denied, open '/sessions/deep/path/metrics.jsonl' for reading"
const ZERO_DEFICIT = 0
const NEGATIVE_DEFICIT = -5

const sidebarRowsWithinWidth = (data: PanelData): PanelRow[] => {
  const rows = sidebarRows(data)
  for (const row of rows) assert.ok(row.text.length <= SIDEBAR_COLUMN_LIMIT, `row exceeds the sidebar width: ${row.text}`)
  return rows
}

test("sidebarRows renders the approved layout's header, stat block, and eviction footer as blank-line groups", () => {
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

  const rows = sidebarRowsWithinWidth(data)

  assert.deepEqual(rows, [
    { text: "Context Manager", tone: "header" },
    { text: " ", tone: "normal" },
    { text: "Budget: 200k", tone: "normal" },
    { text: "Watermark: 100k", tone: "normal" },
    { text: "Over by: 23.5k", tone: "warning" },
    { text: EXPECTED_TOKENS_USED_STAT, tone: "success" },
    { text: `Evictions: ${TOTALS_EVICTIONS}, 3.1k tokens`, tone: "success" },
    { text: EXPECTED_DEDUPED_STAT, tone: "success" },
    { text: EXPECTED_REASONING_STAT, tone: "success" },
    { text: `Stash reads: ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES}, ${TOTALS_STASH_HITS} hits`, tone: "success" },
    { text: " ", tone: "normal" },
    { text: "Last evicted: read /data/a.txt", tone: "info" },
    { text: `3 kB, ${EVICTED_MESSAGES_AGO} messages ago`, tone: "info" },
  ])
})

test("sidebarRows keeps the panel's manual-mode header suffix over the spaced groups", () => {
  const manualData = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: { ...sessionPanelData([makeLine()], SESSION_A), manualMode: true },
    global: globalTotals([]),
    error: undefined,
  }
  const automaticData = { ...manualData, current: { ...sessionPanelData([makeLine()], SESSION_A), manualMode: false } }

  const rows = sidebarRowsWithinWidth(manualData)

  assert.equal(rows[0].text, "Context Manager (manual)")
  assert.equal(rows[0].tone, "header")
  assert.deepEqual(rows[1], { text: " ", tone: "normal" })
  assert.equal(sidebarRowsWithinWidth(automaticData)[0].text, "Context Manager")
})

test("sidebarRows reports a session without runs and a sidebar outside any session", () => {
  const noMetricsData = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_B,
    current: undefined,
    global: globalTotals([makeLine({ session: SESSION_B })]),
    error: undefined,
  }

  assert.deepEqual(sidebarRowsWithinWidth(noMetricsData), [
    { text: "Context Manager", tone: "header" },
    { text: " ", tone: "normal" },
    { text: "no metrics recorded for this session yet", tone: "normal" },
  ])
  assert.deepEqual(sidebarRowsWithinWidth({ ...noMetricsData, activeSession: undefined }), [
    { text: "Context Manager", tone: "header" },
    { text: " ", tone: "normal" },
    { text: "no active session", tone: "normal" },
  ])
})

test("sidebarRows shows the empty-session state when the session's log lines are all malformed", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    writeFileSync(path, "{not json\n")

    const data = await loadPanelData({ path, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.equal(data.current, undefined)
    assert.deepEqual(sidebarRowsWithinWidth(data), [
      { text: "Context Manager", tone: "header" },
      { text: " ", tone: "normal" },
      { text: "no metrics recorded for this session yet", tone: "normal" },
    ])
  })
})

test("sidebarRows pins the unreadable-log warning as its own group when no snapshot serves the session", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: undefined,
    global: globalTotals([]),
    error: "EACCES: permission denied",
  }

  assert.deepEqual(sidebarRowsWithinWidth(data), [
    { text: "Context Manager", tone: "header" },
    { text: " ", tone: "normal" },
    { text: "metrics log unreadable: EACCES: permissio…", tone: "warning" },
  ])
})

test("sidebarRows keeps the snapshot-fed session block under the warning group when the log is unreadable", async () => {
  await withTempDir(async (dir) => {
    const directoryPath = join(dir, "metrics-dir")
    mkdirSync(directoryPath)
    const stateDir = join(dir, "context-state")
    mkdirSync(stateDir)
    writeSnapshot(stateDir, SESSION_A, makeSnapshot())

    const data = await loadPanelData({ path: directoryPath, stateDir, sessionID: SESSION_A })

    assert.ok(data.error !== undefined)
    assert.ok(data.current !== undefined)
    const rows = sidebarRowsWithinWidth(data)
    assert.deepEqual(rows.slice(0, 2), [
      { text: "Context Manager (manual)", tone: "header" },
      { text: " ", tone: "normal" },
    ])
    assert.ok(rows[2].text.startsWith("metrics log unreadable:"))
    assert.equal(rows[2].tone, "warning")
    assert.deepEqual(rows.slice(3), [
      { text: " ", tone: "normal" },
      { text: "Budget: 200k", tone: "normal" },
      { text: "Watermark: 100k", tone: "normal" },
      { text: "Over by: 23.5k", tone: "warning" },
      { text: EXPECTED_TOKENS_USED_STAT, tone: "success" },
      { text: `Evictions: ${TOTALS_EVICTIONS}, 3.1k tokens`, tone: "success" },
      { text: EXPECTED_DEDUPED_STAT, tone: "success" },
      { text: EXPECTED_REASONING_STAT, tone: "success" },
      { text: `Stash reads: ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES}, ${TOTALS_STASH_HITS} hits`, tone: "success" },
    ])
  })
})

test("sidebarRows renders the log-fed fallback session in the spaced groups", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "metrics.jsonl")
    const stateDir = join(dir, "context-state")
    mkdirSync(stateDir)
    writeFileSync(path, serialize([logLineStaleAgainstSnapshot()]))

    const data = await loadPanelData({ path, stateDir, sessionID: SESSION_A })

    assert.equal(data.error, undefined)
    assert.ok(data.current !== undefined)
    assert.deepEqual(sidebarRowsWithinWidth(data), [
      { text: "Context Manager", tone: "header" },
      { text: " ", tone: "normal" },
      { text: `Budget: 600`, tone: "normal" },
      { text: "Watermark: 100k", tone: "normal" },
      { text: "Over by: 23.5k", tone: "warning" },
      { text: EXPECTED_TOKENS_USED_STAT, tone: "success" },
      { text: `Evictions: ${LOG_LINE_ONLY_EVICTIONS}, 3.1k tokens`, tone: "success" },
      { text: EXPECTED_DEDUPED_STAT, tone: "success" },
      { text: EXPECTED_REASONING_STAT, tone: "success" },
      { text: `Stash reads: ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES}, ${TOTALS_STASH_HITS} hits`, tone: "success" },
      { text: " ", tone: "normal" },
      { text: "Last evicted: read /data/a.txt", tone: "info" },
      { text: `3 kB, ${EVICTED_MESSAGES_AGO} messages ago`, tone: "info" },
    ])
  })
})

test("sidebarRows caps an over-long eviction line and the footer's huge byte total at the sidebar column limit", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData(
      [
        makeLine({
          evictedThisRun: [{ tool: "read", subject: OVER_LONG_SUBJECT, bytes: HUGE_RECLAIMED_BYTES, messagesAgo: EVICTED_MESSAGES_AGO }],
        }),
      ],
      SESSION_A,
    ),
    global: globalTotals([]),
    error: undefined,
  }

  const rows = sidebarRowsWithinWidth(data)

  assert.ok(OVER_LONG_SUBJECT.length > SIDEBAR_COLUMN_LIMIT)
  assert.deepEqual(rows.slice(-3), [
    { text: " ", tone: "normal" },
    { text: `Last evicted: read /data/${"b".repeat(16)}…`, tone: "info" },
    { text: `115 GB, ${EVICTED_MESSAGES_AGO} messages ago`, tone: "info" },
  ])
})

test("sidebarRows caps an over-long read error in the warning group at the sidebar column limit", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: undefined,
    global: globalTotals([]),
    error: LONG_READ_ERROR,
  }

  assert.ok(LONG_READ_ERROR.length > SIDEBAR_COLUMN_LIMIT - "metrics log unreadable: ".length)
  assert.deepEqual(sidebarRowsWithinWidth(data), [
    { text: "Context Manager", tone: "header" },
    { text: " ", tone: "normal" },
    { text: "metrics log unreadable: EACCES: permissio…", tone: "warning" },
  ])
})

test("sidebarRows restyles a null budget and a missing watermark into the colon forms without an over-by line", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData(
      [
        makeLine({
          modelContextTokens: null,
          modelContextTokensSource: UNKNOWN_BUDGET_SOURCE,
          watermarkTokens: null,
          deficitTokens: null,
          evictedThisRun: [],
        }),
      ],
      SESSION_A,
    ),
    global: globalTotals([]),
    error: undefined,
  }

  assert.deepEqual(sidebarRowsWithinWidth(data), [
    { text: "Context Manager", tone: "header" },
    { text: " ", tone: "normal" },
    { text: "Budget: inactive (no budget)", tone: "normal" },
    { text: "Watermark: none", tone: "normal" },
    { text: EXPECTED_TOKENS_USED_STAT, tone: "success" },
    { text: `Evictions: ${TOTALS_EVICTIONS}, 3.1k tokens`, tone: "success" },
    { text: EXPECTED_DEDUPED_STAT, tone: "success" },
    { text: EXPECTED_REASONING_STAT, tone: "success" },
    { text: `Stash reads: ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES}, ${TOTALS_STASH_HITS} hits`, tone: "success" },
  ])
})

test("sidebarRows shows Watermark none for a present budget when only the watermark trio is null", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData([makeLine({ watermarkTokens: null, deficitTokens: null, evictedThisRun: [] })], SESSION_A),
    global: globalTotals([]),
    error: undefined,
  }

  assert.deepEqual(sidebarRowsWithinWidth(data), [
    { text: "Context Manager", tone: "header" },
    { text: " ", tone: "normal" },
    { text: "Budget: 200k", tone: "normal" },
    { text: "Watermark: none", tone: "normal" },
    { text: EXPECTED_TOKENS_USED_STAT, tone: "success" },
    { text: `Evictions: ${TOTALS_EVICTIONS}, 3.1k tokens`, tone: "success" },
    { text: EXPECTED_DEDUPED_STAT, tone: "success" },
    { text: EXPECTED_REASONING_STAT, tone: "success" },
    { text: `Stash reads: ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES}, ${TOTALS_STASH_HITS} hits`, tone: "success" },
  ])
})

test("sidebarRows omits the over-by line when the deficit is zero or negative", () => {
  const makeWithinData = (deficitTokens: number): PanelData => ({
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData([makeLine({ deficitTokens, evictedThisRun: [] })], SESSION_A),
    global: globalTotals([]),
    error: undefined,
  })

  for (const deficitTokens of [ZERO_DEFICIT, NEGATIVE_DEFICIT]) {
    const rows = sidebarRowsWithinWidth(makeWithinData(deficitTokens))
    assert.deepEqual(rows.slice(2), [
      { text: `Budget: 200k`, tone: "normal" },
      { text: "Watermark: 100k", tone: "normal" },
      { text: EXPECTED_TOKENS_USED_STAT, tone: "success" },
      { text: `Evictions: ${TOTALS_EVICTIONS}, 3.1k tokens`, tone: "success" },
      { text: EXPECTED_DEDUPED_STAT, tone: "success" },
      { text: EXPECTED_REASONING_STAT, tone: "success" },
      { text: `Stash reads: ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES}, ${TOTALS_STASH_HITS} hits`, tone: "success" },
    ])
  }
})

test("sidebarRows leads the stat rows with a zeroed Tokens used row before the savings rows", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData([makeLine({ evictedThisRun: [], totals: { ...makeTotals(), processedContextTokens: 0 } })], SESSION_A),
    global: globalTotals([]),
    error: undefined,
  }

  const rows = sidebarRowsWithinWidth(data)

  const tokensUsedIndex = rows.findIndex((row) => row.text.startsWith("Tokens used:"))
  const evictionsIndex = rows.findIndex((row) => row.text.startsWith("Evictions:"))
  assert.notEqual(tokensUsedIndex, -1)
  assert.notEqual(evictionsIndex, -1)
  assert.deepEqual(rows[tokensUsedIndex], { text: "Tokens used: 0 tokens", tone: "success" })
  assert.ok(tokensUsedIndex < evictionsIndex, "the Tokens used row must precede the Evictions row")
})

test("sidebarRows drops the budget source label while the panel keeps it", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData([makeLine({ modelContextTokensSource: OVERRIDE_BUDGET_SOURCE, evictedThisRun: [] })], SESSION_A),
    global: globalTotals([]),
    error: undefined,
  }

  const rows = sidebarRowsWithinWidth(data)

  assert.ok(rows.some((row) => row.text === "Budget: 200k"))
  assert.ok(!rows.some((row) => row.text.includes("override")))
  assert.ok(panelRows(data).some((row) => row.text === "budget: 200k tokens (per-model override)"))
})

const GUARD_CHILD_NOW_MS = 1_758_300_000_000

test("sidebarRows emits no muted or secondary row across its active, empty, and error outputs with the subagent group included", () => {
  const scoutChild: SubagentChild = { id: "sess-child-1", type: "scout", updatedAtMs: GUARD_CHILD_NOW_MS, archived: false }
  const scanChild: SubagentChild = { id: "sess-child-2", type: "scan", updatedAtMs: GUARD_CHILD_NOW_MS - 1, archived: false }
  const current = sessionPanelData([makeLine()], SESSION_A)
  assert.ok(current !== undefined)
  const activeData: PanelData = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current,
    global: globalTotals([makeLine()]),
    error: undefined,
    subagentPanels: [
      { id: scoutChild.id, panel: sessionPanelData([makeLine({ session: scoutChild.id })], scoutChild.id) },
      { id: scanChild.id, panel: undefined },
    ],
  }
  const emptyData: PanelData = { ...activeData, current: undefined }
  const errorData: PanelData = { ...activeData, current: undefined, error: "EACCES: permission denied" }
  const subagentRows = sidebarSubagentsGroup([scoutChild, scanChild], activeData)
  assert.ok(subagentRows.length > 0)

  for (const data of [activeData, emptyData, errorData]) {
    const rows = sidebarRows(data, subagentRows)
    assert.ok(rows.length > 0)
    for (const row of rows) {
      assert.notEqual(row.tone, "muted", `muted row leaked into the sidebar: ${JSON.stringify(row)}`)
      assert.notEqual(row.tone, "secondary", `secondary row leaked into the sidebar: ${JSON.stringify(row)}`)
    }
  }
})

const SIDEBAR_ENABLED_INVALID_VALUES: unknown[] = ["false", 0, null]

test("resolveSidebarEnabled defaults to true honors explicit false and falls back to true on non-boolean values", () => {
  assert.equal(resolveSidebarEnabled(undefined), DEFAULT_SIDEBAR_ENABLED)
  assert.equal(resolveSidebarEnabled(true), true)
  assert.equal(resolveSidebarEnabled(false), false)
  for (const invalid of SIDEBAR_ENABLED_INVALID_VALUES) {
    assert.equal(resolveSidebarEnabled(invalid), true)
  }
})
