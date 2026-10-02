import assert from "node:assert/strict"
import { test } from "node:test"

import {
  formatTokenCount,
  globalTotals,
  panelRows,
  parseCheckpoint,
  sessionPanelData,
  snapshotSessionPanel,
  splitRowText,
} from "../plugin/panel-data.ts"
import {
  ESTIMATED_TOKENS,
  EVICTED_BYTES,
  EVICTED_MESSAGES_AGO,
  OVERRIDE_CONTEXT_LIMIT_SOURCE,
  SESSION_A,
  SESSION_B,
  SNAPSHOT_ADVISORY_BAND_START_TOKENS,
  SNAPSHOT_ADVISORY_DEFICIT_TOKENS,
  SNAPSHOT_ADVISORY_RATIO,
  SNAPSHOT_ADVISORY_SUBJECTS,
  TOTALS_DEDUPED_UNIQUE,
  TOTALS_EVICTIONS,
  TOTALS_FENCE_EVICTED,
  TOTALS_REASONING_EXPIRED,
  TOTALS_RECALL_HITS,
  TOTALS_RECALL_MISSES,
  UNKNOWN_CONTEXT_LIMIT_SOURCE,
  logLineStaleAgainstSnapshot,
  makeAdvisory,
  makeLine,
  makeSnapshot,
} from "./panel-fixtures.ts"

const COLLECTED_EVICTION_COUNT = 2
const STALENESS_NOW_MS = Date.parse("2026-09-18T09:30:00.000Z")

const panelDataWithAdvisory = () => ({
  source: "/tmp/metrics.jsonl",
  activeSession: SESSION_A,
  current: { ...sessionPanelData([makeLine()], SESSION_A), advisory: makeAdvisory() },
  global: globalTotals([]),
  error: undefined,
})

const advisoryRowText = (): string => {
  const deficit = SNAPSHOT_ADVISORY_DEFICIT_TOKENS
  const pressure = deficit > 0 ? `over by ${formatTokenCount(deficit)}` : `${formatTokenCount(-deficit)} to watermark`
  return `advisory: ${SNAPSHOT_ADVISORY_RATIO} of watermark (${formatTokenCount(SNAPSHOT_ADVISORY_BAND_START_TOKENS)} tokens), ${formatTokenCount(ESTIMATED_TOKENS)} estimate, ${pressure}; next: ${SNAPSHOT_ADVISORY_SUBJECTS.join(", ")}`
}

test("panelRows renders the advisory row between the last-run row and the counters row", () => {
  const rows = panelRows(panelDataWithAdvisory())

  const lastIndex = rows.findIndex((row) => row.text.startsWith("last run:"))
  const advisoryIndex = rows.findIndex((row) => row.text.startsWith("advisory:"))
  const countersIndex = rows.findIndex((row) => row.text.startsWith("counters:"))
  assert.ok(lastIndex !== -1)
  assert.ok(advisoryIndex !== -1)
  assert.ok(countersIndex !== -1)
  assert.ok(lastIndex < advisoryIndex && advisoryIndex < countersIndex, `advisory row must sit between the last-run and counters rows: ${JSON.stringify(rows)}`)
  assert.equal(rows[advisoryIndex].tone, "warning")
  assert.equal(rows[advisoryIndex].text, advisoryRowText())
})

test("panelRows omits the advisory row when the panel carries no advisory", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData([makeLine()], SESSION_A),
    global: globalTotals([]),
    error: undefined,
  }

  const rows = panelRows(data)

  assert.ok(!rows.some((row) => row.text.startsWith("advisory:")))
  assert.equal(rows.length, 6)
})

test("splitRowText splits a label value row at the first colon-space", () => {
  assert.deepEqual(splitRowText("context limit: 200k tokens"), { label: "context limit", value: "200k tokens" })
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
  assert.equal(splitRowText("context limit: "), undefined)
})

test("splitRowText returns undefined for a row whose label before the colon-space is empty", () => {
  assert.equal(splitRowText(": value"), undefined)
})

test("panelRows renders the session's context limit, last run, compact counters, and newest eviction", () => {
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
  assert.ok(rows.some((row) => row.text === `context limit: 200k tokens (per-model limit)`))
  assert.ok(rows.some((row) => row.text === "last run: 123.5k estimated vs 100k watermark (over by 23.5k)"))
  assert.ok(
    rows.some(
      (row) =>
        row.text ===
        `counters: ${TOTALS_EVICTIONS} evictions (12 kB reclaimed, 3.1k tokens saved), ${TOTALS_DEDUPED_UNIQUE} dedup (2.3k tokens saved), ${TOTALS_RECALL_HITS + TOTALS_RECALL_MISSES} recalls (${TOTALS_RECALL_HITS} hits)`,
    ),
  )
  assert.ok(rows.some((row) => row.text === `last evicted: read /data/a.txt (3 kB, ${EVICTED_MESSAGES_AGO} msgs ago)`))
  assert.equal(rows.length, 6)
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

test("panelRows marks an unknown context limit inactive and omits watermark fields when null", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData(
      [makeLine({ contextLimit: null, contextLimitSource: UNKNOWN_CONTEXT_LIMIT_SOURCE, watermarkTokens: null, deficitTokens: null })],
      SESSION_A,
    ),
    global: globalTotals([]),
    error: undefined,
  }

  const rows = panelRows(data)

  assert.ok(rows.some((row) => row.text === "context limit: inactive (no context limit)"))
  assert.ok(rows.some((row) => row.text === "last run: 123.5k estimated, no watermark"))
})

test("panelRows labels an override-sourced context limit as a per-model override", () => {
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: sessionPanelData([makeLine({ contextLimitSource: OVERRIDE_CONTEXT_LIMIT_SOURCE })], SESSION_A),
    global: globalTotals([]),
    error: undefined,
  }

  const rows = panelRows(data)

  assert.ok(rows.some((row) => row.text === "context limit: 200k tokens (per-model override)"))
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
  assert.ok(!noMetricsRows.some((row) => row.text.startsWith("context limit:")))
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

test("panelRows renders the staleness sentence as the final row with the transform and metrics ages", () => {
  const checkpoint = parseCheckpoint(JSON.stringify(makeSnapshot()))
  assert.ok(checkpoint !== undefined)
  const data = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: snapshotSessionPanel(checkpoint, [logLineStaleAgainstSnapshot()], SESSION_A),
    global: globalTotals([]),
    error: undefined,
  }

  const rows = panelRows(data, { nowMs: STALENESS_NOW_MS })

  const stalenessText = "last transform 30 minutes ago; metrics last written 1 hour ago"
  assert.ok(rows.some((row) => row.text === stalenessText))
  assert.equal(rows[rows.length - 1].text, stalenessText)
  assert.ok(rows[rows.length - 2].text.startsWith("last evicted:"))
})

test("panelRows renders only the metrics age for a log-fallback session and omits the staleness row when neither timestamp is available", () => {
  const logOnlyCurrent = sessionPanelData([logLineStaleAgainstSnapshot()], SESSION_A)
  assert.ok(logOnlyCurrent !== undefined)
  const logOnlyData = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: logOnlyCurrent,
    global: globalTotals([]),
    error: undefined,
  }
  const logOnlyRows = panelRows(logOnlyData, { nowMs: STALENESS_NOW_MS })

  assert.ok(logOnlyRows.some((row) => row.text === "metrics last written 1 hour ago"))
  assert.ok(!logOnlyRows.some((row) => row.text.startsWith("last transform")))
  assert.equal(logOnlyRows[logOnlyRows.length - 1].text, "metrics last written 1 hour ago")

  const noTimestampData = {
    source: "/tmp/metrics.jsonl",
    activeSession: SESSION_A,
    current: { ...logOnlyCurrent, lastTransformAtMs: undefined, lastMetricsLineAtMs: undefined },
    global: globalTotals([]),
    error: undefined,
  }
  const noTimestampRows = panelRows(noTimestampData, { nowMs: STALENESS_NOW_MS })

  assert.ok(!noTimestampRows.some((row) => row.text.startsWith("last transform")))
  assert.ok(!noTimestampRows.some((row) => row.text.startsWith("metrics last written")))
  assert.ok(noTimestampRows[noTimestampRows.length - 1].text.startsWith("last evicted:"))
})
