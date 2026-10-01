import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DEFAULT_SIDEBAR_SUBAGENTS,
  SIDEBAR_COLUMN_LIMIT,
  SUBAGENT_FALLBACK_TYPE,
  filterSubagentChildren,
  globalTotals,
  resolveSidebarSubagents,
  resolveSubagentChildren,
  sessionPanelData,
  sidebarRows,
  sidebarSubagentsGroup,
  type PanelData,
  type PanelRow,
  type SessionPanel,
  type SubagentChild,
} from "../plugin/panel-data.ts"
import { EXPECTED_DEDUPED_STAT, EXPECTED_REASONING_STAT, makeLine, makeTotals } from "./panel-fixtures.ts"

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const NOW_MS = 1_758_300_000_000
const CHILD_ID = "sess-child-1"
const PARENT_ID = "sess-parent"

const makeChild = (overrides: Partial<SubagentChild> = {}): SubagentChild => ({
  id: CHILD_ID,
  type: "explore",
  updatedAtMs: NOW_MS,
  archived: false,
  ...overrides,
})

const makePanel = (childID: string, overrides: Partial<ReturnType<typeof makeTotals>> = {}): SessionPanel => {
  const panel = sessionPanelData([makeLine({ session: childID, totals: { ...makeTotals(), ...overrides } })], childID)
  assert.ok(panel !== undefined)
  return panel
}

const dataWithChildren = (panels: Array<{ id: string; panel: SessionPanel | undefined }> = []): PanelData => ({
  source: "/tmp/metrics.jsonl",
  activeSession: PARENT_ID,
  current: undefined,
  global: globalTotals([]),
  error: undefined,
  subagentPanels: panels,
})

const rowsWithinWidth = (rows: PanelRow[]): PanelRow[] => {
  for (const row of rows) assert.ok(row.text.length <= SIDEBAR_COLUMN_LIMIT, `row exceeds the sidebar width: ${row.text}`)
  return rows
}

test("resolveSidebarSubagents defaults to false honors explicit false and falls back to false on non-boolean values", () => {
  assert.equal(DEFAULT_SIDEBAR_SUBAGENTS, false)
  assert.equal(resolveSidebarSubagents(undefined), DEFAULT_SIDEBAR_SUBAGENTS)
  assert.equal(resolveSidebarSubagents(true), true)
  assert.equal(resolveSidebarSubagents(false), false)
  for (const invalid of ["false", 0, null] as const) {
    assert.equal(resolveSidebarSubagents(invalid), false)
  }
})

test("SUBAGENT_FALLBACK_TYPE is the literal subagent", () => {
  assert.equal(SUBAGENT_FALLBACK_TYPE, "subagent")
})

test("filterSubagentChildren keeps a non-archived child no matter how old its last update is", () => {
  const ancient = makeChild({ updatedAtMs: NOW_MS - 24 * HOUR_MS })

  assert.deepEqual(filterSubagentChildren([ancient]), [ancient])
})

test("filterSubagentChildren drops an archived child even when fresh and keeps its non-archived sibling", () => {
  const archived = makeChild({ archived: true })
  const fresh = makeChild({ id: "sess-child-2" })

  assert.deepEqual(filterSubagentChildren([archived, fresh]), [fresh])
})

test("filterSubagentChildren preserves the input order", () => {
  const first = makeChild({ updatedAtMs: NOW_MS - 2 * HOUR_MS })
  const second = makeChild({ id: "sess-child-2", type: "general", updatedAtMs: NOW_MS - HOUR_MS })

  assert.deepEqual(filterSubagentChildren([first, second]), [first, second])
})

test("sidebarSubagentsGroup renders the type's agent count on its row and the token-first stat rows beneath", () => {
  const childOne = makeChild({ id: "sess-child-1", type: "scout" })
  const childTwo = makeChild({ id: "sess-child-2", type: "scout", updatedAtMs: NOW_MS - MINUTE_MS })
  const uniqueCounts = { dedupedUnique: 5, reasoningExpiredUnique: 6 }
  const data = dataWithChildren([
    { id: childOne.id, panel: makePanel(childOne.id, { evictions: 1, evictionTokensSaved: 500, ...uniqueCounts }) },
    { id: childTwo.id, panel: makePanel(childTwo.id, { evictions: 1, evictionTokensSaved: 400, ...uniqueCounts }) },
  ])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([childOne, childTwo], data))

  assert.deepEqual(rows, [
    { text: "Subagents: 2", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Tokens used: 39k tokens", tone: "normal" },
    { text: "Evictions: 2, 900 tokens", tone: "normal" },
    { text: "Deduped: 10, 4.5k tokens", tone: "normal" },
    { text: "Reasoning expired: 12, 1.3k tokens", tone: "normal" },
    { text: "Stash reads: 20, 8 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Scout: 2 agents", tone: "normal", labelTone: "info", labelBold: true },
    { text: "Tokens used: 39k tokens", tone: "normal" },
    { text: "Evictions: 2, 900 tokens", tone: "normal" },
    { text: "Deduped: 10, 4.5k tokens", tone: "normal" },
    { text: "Reasoning expired: 12, 1.3k tokens", tone: "normal" },
    { text: "Stash reads: 20, 8 hits", tone: "normal" },
  ])
})

test("sidebarSubagentsGroup uses the singular agent unit for a single-child type", () => {
  const child = makeChild({ type: "scout" })
  const data = dataWithChildren([{ id: child.id, panel: makePanel(child.id, { evictions: 1, evictionTokensSaved: 900 }) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([child], data))

  assert.deepEqual(rows, [
    { text: "Subagents: 1", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 1, 900 tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Scout: 1 agent", tone: "normal", labelTone: "info", labelBold: true },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 1, 900 tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
  ])
})

test("sidebarSubagentsGroup renders no data yet for a type whose children all lack panel data", () => {
  const child = makeChild({ type: "general" })

  const rows = rowsWithinWidth(sidebarSubagentsGroup([child], dataWithChildren()))

  assert.deepEqual(rows, [
    { text: "Subagents: 1", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "General: no data yet", tone: "normal", labelTone: "info", labelBold: true },
  ])
})

test("sidebarSubagentsGroup sums the landed panels of a type and keeps the agents clause when some children lack data", () => {
  const landed = makeChild({ id: "sess-child-1", type: "scout" })
  const dataless = makeChild({ id: "sess-child-2", type: "scout", updatedAtMs: NOW_MS - MINUTE_MS })
  const data = dataWithChildren([{ id: landed.id, panel: makePanel(landed.id, { evictions: 2, evictionTokensSaved: 900 }) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([landed, dataless], data))

  assert.deepEqual(rows, [
    { text: "Subagents: 2", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 2, 900 tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Scout: 2 agents", tone: "normal", labelTone: "info", labelBold: true },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 2, 900 tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
  ])
})

test("sidebarSubagentsGroup renders the cumulative token-first block directly under the lead row and sums landed panels across types", () => {
  const scout = makeChild({ id: "sess-child-1", type: "scout" })
  const worker = makeChild({ id: "sess-child-2", type: "worker", updatedAtMs: NOW_MS - MINUTE_MS })
  const data = dataWithChildren([
    { id: scout.id, panel: makePanel(scout.id, { evictions: 2, evictionTokensSaved: 900, processedContextTokens: 700 }) },
    { id: worker.id, panel: makePanel(worker.id, { evictions: 1, evictionTokensSaved: 600, processedContextTokens: 400 }) },
  ])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([scout, worker], data))

  assert.deepEqual(rows, [
    { text: "Subagents: 2", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Tokens used: 1.1k tokens", tone: "normal" },
    { text: "Evictions: 3, 1.5k tokens", tone: "normal" },
    { text: "Deduped: 8, 4.5k tokens", tone: "normal" },
    { text: "Reasoning expired: 6, 1.3k tokens", tone: "normal" },
    { text: "Stash reads: 20, 8 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Worker: 1 agent", tone: "normal", labelTone: "info", labelBold: true },
    { text: "Tokens used: 400 tokens", tone: "normal" },
    { text: "Evictions: 1, 600 tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Scout: 1 agent", tone: "normal", labelTone: "info", labelBold: true },
    { text: "Tokens used: 700 tokens", tone: "normal" },
    { text: "Evictions: 2, 900 tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
  ])
})

test("sidebarSubagentsGroup renders no cumulative block when no child's panel has landed", () => {
  const scout = makeChild({ id: "sess-child-1", type: "scout" })
  const worker = makeChild({ id: "sess-child-2", type: "worker", updatedAtMs: NOW_MS - MINUTE_MS })

  const rows = rowsWithinWidth(sidebarSubagentsGroup([scout, worker], dataWithChildren()))

  assert.deepEqual(rows, [
    { text: "Subagents: 2", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Worker: no data yet", tone: "normal", labelTone: "info", labelBold: true },
    { text: " ", tone: "normal" },
    { text: "Scout: no data yet", tone: "normal", labelTone: "info", labelBold: true },
  ])
})

test("sidebarSubagentsGroup sums the token rows over the landed children only", () => {
  const landedOne = makeChild({ id: "sess-child-1", type: "scout" })
  const landedTwo = makeChild({ id: "sess-child-2", type: "scout", updatedAtMs: NOW_MS - MINUTE_MS })
  const dataless = makeChild({ id: "sess-child-3", type: "scout", updatedAtMs: NOW_MS - 2 * MINUTE_MS })
  const data = dataWithChildren([
    { id: landedOne.id, panel: makePanel(landedOne.id, { processedContextTokens: 700 }) },
    { id: landedTwo.id, panel: makePanel(landedTwo.id, { processedContextTokens: 400 }) },
  ])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([landedOne, landedTwo, dataless], data))

  assert.equal(rows[0].text, "Subagents: 3")
  assert.equal(rows[2].text, "Tokens used: 1.1k tokens")
  assert.equal(rows[8].text, "Scout: 3 agents")
  assert.equal(rows[9].text, "Tokens used: 1.1k tokens")
})

test("sidebarSubagentsGroup orders type blocks alphabetically regardless of the type's most recent child update", () => {
  const freshScan = makeChild({ id: "sess-child-1", type: "scan", updatedAtMs: NOW_MS })
  const staleProbe = makeChild({ id: "sess-child-2", type: "probe", updatedAtMs: NOW_MS - MINUTE_MS })
  const data = dataWithChildren([{ id: freshScan.id, panel: makePanel(freshScan.id) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([freshScan, staleProbe], data))

  assert.deepEqual(rows, [
    { text: "Subagents: 2", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Probe: no data yet", tone: "normal", labelTone: "info", labelBold: true },
    { text: " ", tone: "normal" },
    { text: "Scan: 1 agent", tone: "normal", labelTone: "info", labelBold: true },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
  ])
})

test("sidebarSubagentsGroup places the fleet agent types first in the canonical sequence and every other type after them in code-unit order", () => {
  const worker = makeChild({ id: "sess-child-1", type: "worker", updatedAtMs: NOW_MS - 3 * MINUTE_MS })
  const verifier = makeChild({ id: "sess-child-2", type: "verifier", updatedAtMs: NOW_MS - 2 * MINUTE_MS })
  const reviewer = makeChild({ id: "sess-child-3", type: "reviewer", updatedAtMs: NOW_MS - MINUTE_MS })
  const planner = makeChild({ id: "sess-child-4", type: "planner", updatedAtMs: NOW_MS - 4 * MINUTE_MS })
  const freshestExplore = makeChild({ id: "sess-child-5", type: "explore", updatedAtMs: NOW_MS - MINUTE_MS })
  const freshestZeta = makeChild({ id: "sess-child-6", type: "zeta", updatedAtMs: NOW_MS })
  const data = dataWithChildren([{ id: freshestZeta.id, panel: makePanel(freshestZeta.id) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([freshestZeta, freshestExplore, planner, reviewer, worker, verifier], data))

  assert.deepEqual(rows, [
    { text: "Subagents: 6", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Worker: no data yet", tone: "normal", labelTone: "info", labelBold: true },
    { text: " ", tone: "normal" },
    { text: "Verifier: no data yet", tone: "normal", labelTone: "info", labelBold: true },
    { text: " ", tone: "normal" },
    { text: "Reviewer: no data yet", tone: "normal", labelTone: "info", labelBold: true },
    { text: " ", tone: "normal" },
    { text: "Planner: no data yet", tone: "normal", labelTone: "info", labelBold: true },
    { text: " ", tone: "normal" },
    { text: "Explore: no data yet", tone: "normal", labelTone: "info", labelBold: true },
    { text: " ", tone: "normal" },
    { text: "Zeta: 1 agent", tone: "normal", labelTone: "info", labelBold: true },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
  ])
})

test("sidebarSubagentsGroup keeps a capitalized fleet type in the fleet block ahead of a code-unit-earlier non-fleet type", () => {
  const freshAudit = makeChild({ id: "sess-child-1", type: "Audit", updatedAtMs: NOW_MS })
  const staleWorker = makeChild({ id: "sess-child-2", type: "Worker", updatedAtMs: NOW_MS - MINUTE_MS })
  const data = dataWithChildren()

  const rows = rowsWithinWidth(sidebarSubagentsGroup([freshAudit, staleWorker], data))

  assert.deepEqual(rows, [
    { text: "Subagents: 2", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Worker: no data yet", tone: "normal", labelTone: "info", labelBold: true },
    { text: " ", tone: "normal" },
    { text: "Audit: no data yet", tone: "normal", labelTone: "info", labelBold: true },
  ])
})

test("sidebarSubagentsGroup compares non-fleet types locale-free so an uppercase-initial type precedes a lowercase one regardless of recency", () => {
  const freshAudit = makeChild({ id: "sess-child-1", type: "audit", updatedAtMs: NOW_MS })
  const staleSummarizer = makeChild({ id: "sess-child-2", type: "Summarizer", updatedAtMs: NOW_MS - MINUTE_MS })
  const data = dataWithChildren([{ id: freshAudit.id, panel: makePanel(freshAudit.id) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([freshAudit, staleSummarizer], data))

  assert.deepEqual(rows, [
    { text: "Subagents: 2", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Summarizer: no data yet", tone: "normal", labelTone: "info", labelBold: true },
    { text: " ", tone: "normal" },
    { text: "Audit: 1 agent", tone: "normal", labelTone: "info", labelBold: true },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
  ])
})

test("sidebarSubagentsGroup renders an ancient child alongside fresh ones regardless of update age", () => {
  const ancient = makeChild({ id: "sess-child-1", type: "scan", updatedAtMs: NOW_MS - 24 * HOUR_MS })
  const fresh = makeChild({ id: "sess-child-2", type: "probe" })
  const data = dataWithChildren([{ id: fresh.id, panel: makePanel(fresh.id) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([ancient, fresh], data))

  assert.deepEqual(rows[0], { text: "Subagents: 2", tone: "normal" })
  assert.deepEqual(rows[rows.length - 1], { text: "Scan: no data yet", tone: "normal", labelTone: "info", labelBold: true })
})

test("sidebarSubagentsGroup excludes an archived child from the count and the type rows", () => {
  const archived = makeChild({ id: "sess-child-1", type: "scan", archived: true })
  const fresh = makeChild({ id: "sess-child-2", type: "probe" })
  const data = dataWithChildren([{ id: fresh.id, panel: makePanel(fresh.id) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([archived, fresh], data))

  assert.deepEqual(rows, [
    { text: "Subagents: 1", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Probe: 1 agent", tone: "normal", labelTone: "info", labelBold: true },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
  ])
})

test("sidebarSubagentsGroup leaves the raw child type untouched while rendering a capitalized row label", () => {
  const child = makeChild({ type: "worker" })
  const data = dataWithChildren([{ id: child.id, panel: makePanel(child.id) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([child], data))

  assert.equal(child.type, "worker")
  assert.deepEqual(rows[8], { text: "Worker: 1 agent", tone: "normal", labelTone: "info", labelBold: true })
})

test("sidebarSubagentsGroup capitalizes only the first letter of an already-capitalized or hyphenated type", () => {
  const alreadyCapitalized = makeChild({ id: "sess-child-1", type: "Scout" })
  const hyphenated = makeChild({ id: "sess-child-2", type: "code-reviewer", updatedAtMs: NOW_MS - MINUTE_MS })
  const data = dataWithChildren([{ id: alreadyCapitalized.id, panel: makePanel(alreadyCapitalized.id) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([alreadyCapitalized, hyphenated], data))

  assert.deepEqual(rows, [
    { text: "Subagents: 2", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Scout: 1 agent", tone: "normal", labelTone: "info", labelBold: true },
    { text: "Tokens used: 19.5k tokens", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
    { text: EXPECTED_DEDUPED_STAT, tone: "normal" },
    { text: EXPECTED_REASONING_STAT, tone: "normal" },
    { text: "Stash reads: 10, 4 hits", tone: "normal" },
    { text: " ", tone: "normal" },
    { text: "Code-reviewer: no data yet", tone: "normal", labelTone: "info", labelBold: true },
  ])
})

test("sidebarSubagentsGroup caps an over-long type label's row at the sidebar column limit and keeps the stat rows beneath it", () => {
  const child = makeChild({ type: "a".repeat(60) })
  const data = dataWithChildren([{ id: child.id, panel: makePanel(child.id) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([child], data))

  assert.equal(rows.length, 14)
  assert.deepEqual(rows[1], { text: " ", tone: "normal" })
  assert.equal(rows[8].text, `A${"a".repeat(SIDEBAR_COLUMN_LIMIT - 2)}…`)
  assert.equal(rows[9].text, "Tokens used: 19.5k tokens")
  assert.equal(rows[10].text, "Evictions: 5, 3.1k tokens")
  assert.equal(rows[11].text, EXPECTED_DEDUPED_STAT)
  assert.equal(rows[12].text, EXPECTED_REASONING_STAT)
  assert.equal(rows[13].text, "Stash reads: 10, 4 hits")
})

test("sidebarSubagentsGroup returns no rows for an empty child list", () => {
  assert.deepEqual(sidebarSubagentsGroup([], dataWithChildren()), [])
})

test("sidebarSubagentsGroup returns no rows when every child is archived", () => {
  const archived = makeChild({ archived: true })

  assert.deepEqual(sidebarSubagentsGroup([archived], dataWithChildren()), [])
})

test("sidebarRows appends a non-empty subagent group as the last blank-line-separated group", () => {
  const data = dataWithChildren()
  const base = sidebarRows(data)
  const group: PanelRow[] = [
    { text: "Subagents: 1", tone: "normal" },
    { text: "explore: 1 agent", tone: "normal" },
    { text: "Evictions: 5, 3.1k tokens", tone: "normal" },
  ]

  const rows = sidebarRows(data, group)

  assert.deepEqual(rows, [...base, { text: " ", tone: "normal" }, ...group])
})

test("sidebarRows appends the subagent group after the eviction footer when the session block renders", () => {
  const current = makePanel("sess-current", { evictions: 1, evictionTokensSaved: 900 })
  const data: PanelData = { ...dataWithChildren(), current }
  const group: PanelRow[] = [
    { text: "Subagents: 1", tone: "normal" },
    { text: "scout: 1 agent", tone: "normal" },
  ]

  const rows = rowsWithinWidth(sidebarRows(data, group))

  assert.deepEqual(rows.slice(-3), [
    { text: " ", tone: "normal" },
    ...group,
  ])
  assert.deepEqual(sidebarRows(data), rows.slice(0, rows.length - group.length - 1))
})

test("sidebarRows with an absent or empty subagent group stays byte-identical to the group-less output", () => {
  const data = dataWithChildren()
  const base = sidebarRows(data)

  assert.deepEqual(base, [
    { text: "Context Manager", tone: "header" },
    { text: " ", tone: "normal" },
    { text: "no metrics recorded for this session yet", tone: "normal" },
  ])
  assert.deepEqual(sidebarRows(data, undefined), base)
  assert.deepEqual(sidebarRows(data, []), base)
  assert.deepEqual(sidebarRows({ ...data, subagentPanels: undefined }, []), base)
})

const makeRawChild = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: CHILD_ID,
  agent: "explore",
  time: { updated: NOW_MS },
  ...overrides,
})

test("resolveSubagentChildren degrades a rejecting children fetch to an empty group", async () => {
  assert.deepEqual(await resolveSubagentChildren(Promise.reject(new Error("hostile host"))), [])
})

test("resolveSubagentChildren returns no children for an undefined, null, or non-object fetch result", async () => {
  for (const result of [undefined, null, 42, "sessions", [makeRawChild()]]) {
    assert.deepEqual(await resolveSubagentChildren(result), [])
  }
})

test("resolveSubagentChildren returns no children when the fetch result carries an error field", async () => {
  assert.deepEqual(await resolveSubagentChildren({ error: "boom", data: [makeRawChild()] }), [])
  assert.deepEqual(await resolveSubagentChildren({ error: null, data: [makeRawChild()] }), [])
})

test("resolveSubagentChildren returns no children when data is missing or not an array", async () => {
  for (const data of [undefined, null, {}, "sessions", 7]) {
    assert.deepEqual(await resolveSubagentChildren({ data }), [])
  }
})

test("resolveSubagentChildren maps a valid result field-for-field, deriving type and archived from the raw child", async () => {
  const explore = makeRawChild({ id: "sess-child-1" })
  const general = makeRawChild({ id: "sess-child-2", agent: "general", time: { updated: NOW_MS - MINUTE_MS } })
  const archived = makeRawChild({ id: "sess-child-3", time: { updated: NOW_MS, archived: NOW_MS - MINUTE_MS } })
  const untypedAgent = makeRawChild({ id: "sess-child-4", agent: undefined })

  const children = await resolveSubagentChildren({ data: [explore, general, archived, untypedAgent] })

  assert.deepEqual(children, [
    { id: "sess-child-1", type: "explore", updatedAtMs: NOW_MS, archived: false },
    { id: "sess-child-2", type: "general", updatedAtMs: NOW_MS - MINUTE_MS, archived: false },
    { id: "sess-child-3", type: "explore", updatedAtMs: NOW_MS, archived: true },
    { id: "sess-child-4", type: SUBAGENT_FALLBACK_TYPE, updatedAtMs: NOW_MS, archived: false },
  ])
})

test("resolveSubagentChildren accepts the fetch promise itself and maps what it resolves", async () => {
  const child = makeRawChild({ id: "sess-child-1", agent: "general" })

  assert.deepEqual(await resolveSubagentChildren(Promise.resolve({ data: [child] })), [
    { id: "sess-child-1", type: "general", updatedAtMs: NOW_MS, archived: false },
  ])
})

test("resolveSubagentChildren drops a child with a hostile shape and keeps its usable siblings", async () => {
  const usable = makeRawChild({ id: "sess-child-good" })

  const children = await resolveSubagentChildren({
    data: [
      null,
      42,
      { agent: "explore", time: { updated: NOW_MS } },
      { id: "", agent: "explore", time: { updated: NOW_MS } },
      { id: "sess-no-time", agent: "explore" },
      { id: "sess-empty-time", agent: "explore", time: {} },
      { id: "sess-string-time", agent: "explore", time: { updated: "soon" } },
      usable,
    ],
  })

  assert.deepEqual(children, [{ id: "sess-child-good", type: "explore", updatedAtMs: NOW_MS, archived: false }])
})

test("resolveSubagentChildren drops only the child that throws while being mapped and keeps its siblings", async () => {
  const hostile: Record<string, unknown> = { id: "sess-hostile" }
  Object.defineProperty(hostile, "time", {
    get() {
      throw new Error("hostile getter")
    },
  })
  const sibling = makeRawChild({ id: "sess-child-good" })

  const children = await resolveSubagentChildren({ data: [hostile, sibling] })

  assert.deepEqual(children, [{ id: "sess-child-good", type: "explore", updatedAtMs: NOW_MS, archived: false }])
})
