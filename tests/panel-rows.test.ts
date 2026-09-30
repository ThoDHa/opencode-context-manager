import assert from "node:assert/strict"
import { test } from "node:test"

import {
  globalTotals,
  panelRows,
  sessionPanelData,
  splitRowText,
} from "../plugin/panel-data.ts"
import {
  EVICTED_BYTES,
  EVICTED_MESSAGES_AGO,
  OVERRIDE_BUDGET_SOURCE,
  SESSION_A,
  SESSION_B,
  TOTALS_DEDUPED_UNIQUE,
  TOTALS_EVICTIONS,
  TOTALS_FENCE_EVICTED,
  TOTALS_REASONING_EXPIRED,
  TOTALS_STASH_HITS,
  TOTALS_STASH_MISSES,
  UNKNOWN_BUDGET_SOURCE,
  makeLine,
} from "./panel-fixtures.ts"

const COLLECTED_EVICTION_COUNT = 2

test("splitRowText splits a label value row at the first colon-space", () => {
  assert.deepEqual(splitRowText("budget: ~200k tokens"), { label: "budget", value: "~200k tokens" })
})

test("splitRowText splits at the first colon-space only and keeps later colons in the value", () => {
  assert.deepEqual(splitRowText("last evicted: read /data/a.txt (3 kB, 5 msgs ago: check)"), {
    label: "last evicted",
    value: "read /data/a.txt (3 kB, 5 msgs ago: check)",
  })
})

test("splitRowText returns undefined for a row without any colon", () => {
  assert.equal(splitRowText("Context Manager"), undefined)
})

test("splitRowText returns undefined when the colon has no trailing space", () => {
  assert.equal(splitRowText("metrics log unreadable:EACCES"), undefined)
})

test("splitRowText returns undefined when the value after the colon-space is empty", () => {
  assert.equal(splitRowText("budget: "), undefined)
})

test("splitRowText returns undefined for a row whose label before the colon-space is empty", () => {
  assert.equal(splitRowText(": value"), undefined)
})

test("panelRows renders the session's budget, last run, compact counters, and newest eviction", () => {
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

  assert.equal(rows[0].text, "Context Manager")
  assert.equal(rows[0].tone, "header")
  assert.ok(rows.some((row) => row.text === `budget: ~200k tokens (per-model limit)`))
  assert.ok(rows.some((row) => row.text === "last run: ~123.5k estimated vs ~100k watermark (over by ~23.5k)"))
  assert.ok(
    rows.some(
      (row) =>
        row.text ===
        `counters: ${TOTALS_EVICTIONS} evictions (12 kB reclaimed, ~3.1k tokens saved), ${TOTALS_DEDUPED_UNIQUE} dedup (~2.3k tokens saved), ${TOTALS_STASH_HITS + TOTALS_STASH_MISSES} stash reads (${TOTALS_STASH_HITS} hits)`,
    ),
  )
  assert.ok(rows.some((row) => row.text === `last evicted: read /data/a.txt (3 kB, ${EVICTED_MESSAGES_AGO} msgs ago)`))
  assert.equal(rows.length, 5)
  assert.ok(!rows.some((row) => row.text === "recently evicted:"))
  assert.ok(!rows.some((row) => row.text.startsWith("session:")))
  assert.ok(!rows.some((row) => row.text.startsWith("mode:")))
  assert.ok(!rows.some((row) => row.text.startsWith("hot subjects:")))
  assert.ok(!rows.some((row) => row.text.startsWith("history:")))
  assert.ok(!rows.some((row) => row.text.includes(`${TOTALS_FENCE_EVICTED} fences`)))
  assert.ok(!rows.some((row) => row.text.includes(`${TOTALS_REASONING_EXPIRED} reasoning`)))
})

test("panelRows compresses multiple recent evictions to a single newest-subject line", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData(
      [
        makeLine({
          evictedThisRun: [
            { tool: "read", subject: "/data/old.txt", bytes: EVICTED_BYTES, messagesAgo: EVICTED_MESSAGES_AGO },
          ],
        }),
        makeLine({
          evictedThisRun: [
            { tool: "bash", subject: "tail-cmd", bytes: EVICTED_BYTES, messagesAgo: EVICTED_MESSAGES_AGO },
          ],
        }),
      ],
      SESSION_A,
    ),
    global: globalTotals([]),
    error: undefined,
  }

  const rows = panelRows(data)

  assert.equal(data.current?.recentEvictions.length, COLLECTED_EVICTION_COUNT)
  assert.equal(rows.filter((row) => row.text.startsWith("last evicted:")).length, 1)
  assert.ok(rows.some((row) => row.text === `last evicted: bash tail-cmd (3 kB, ${EVICTED_MESSAGES_AGO} msgs ago)`))
  assert.ok(!rows.some((row) => row.text.includes("/data/old.txt")))
})

test("panelRows flags manual mode in the header and leaves the automatic-mode header unlabeled", () => {
  const manualData = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: { ...sessionPanelData([makeLine()], SESSION_A), manualMode: true },
    global: globalTotals([]),
    error: undefined,
  }
  const automaticData = { ...manualData, current: { ...sessionPanelData([makeLine()], SESSION_A), manualMode: false } }

  assert.equal(panelRows(manualData)[0].text, "Context Manager (manual)")
  assert.equal(panelRows(automaticData)[0].text, "Context Manager")
  assert.ok(!panelRows(automaticData).some((row) => row.text.startsWith("mode:")))
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
  assert.deepEqual(noMetricsRows, [
    { text: "Context Manager", tone: "header" },
    { text: "no metrics recorded for this session yet", tone: "normal" },
  ])

  const noSessionRows = panelRows({ ...noMetricsData, activeSession: undefined })

  assert.ok(noSessionRows.some((row) => row.text === "no active session"))
  assert.ok(!noSessionRows.some((row) => row.text === "no metrics recorded for this session yet"))
  assert.deepEqual(noSessionRows, [
    { text: "Context Manager", tone: "header" },
    { text: "no active session", tone: "normal" },
  ])
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
    { text: "Context Manager", tone: "header" },
    { text: "metrics log unreadable: EACCES: permission denied", tone: "warning" },
  ])
})
