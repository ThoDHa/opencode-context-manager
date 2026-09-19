import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DEFAULT_SIDEBAR_SUBAGENTS,
  SIDEBAR_COLUMN_LIMIT,
  SUBAGENT_FALLBACK_TYPE,
  SUBAGENT_RECENT_WINDOW_MS,
  filterSubagentChildren,
  globalTotals,
  resolveSidebarSubagents,
  sessionPanelData,
  sidebarRows,
  sidebarSubagentsGroup,
  type PanelData,
  type PanelRow,
  type SessionPanel,
  type SubagentChild,
} from "../plugin/lru-panel-data.ts"
import { makeLine, makeTotals } from "./lru-panel-fixtures.ts"

const MINUTE_MS = 60 * 1000
const NOW_MS = 1_758_300_000_000
const CHILD_ID = "sess-child-1"
const PARENT_ID = "sess-parent"

const makeChild = (overrides: Partial<SubagentChild> = {}): SubagentChild => ({
  id: CHILD_ID,
  type: "explore",
  updatedAtMs: NOW_MS,
  running: false,
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

test("SUBAGENT_RECENT_WINDOW_MS is the approved 30-minute recency window and SUBAGENT_FALLBACK_TYPE the literal subagent", () => {
  assert.equal(SUBAGENT_RECENT_WINDOW_MS, 30 * MINUTE_MS)
  assert.equal(SUBAGENT_FALLBACK_TYPE, "subagent")
})

test("filterSubagentChildren drops an archived child even when fresh and running", () => {
  const children = [makeChild({ archived: true, running: true }), makeChild()]

  const kept = filterSubagentChildren(children, NOW_MS)

  assert.deepEqual(kept, [makeChild()])
})

test("filterSubagentChildren keeps a running child no matter how old its last update is", () => {
  const staleRunning = makeChild({ updatedAtMs: NOW_MS - SUBAGENT_RECENT_WINDOW_MS * 10, running: true })

  assert.deepEqual(filterSubagentChildren([staleRunning], NOW_MS), [staleRunning])
})

test("filterSubagentChildren keeps a non-running child exactly at the 30-minute boundary and drops it one millisecond later", () => {
  const boundaryChild = makeChild({ updatedAtMs: NOW_MS - SUBAGENT_RECENT_WINDOW_MS })
  const justPastChild = makeChild({ id: "sess-child-2", updatedAtMs: NOW_MS - SUBAGENT_RECENT_WINDOW_MS - 1 })

  assert.deepEqual(filterSubagentChildren([boundaryChild], NOW_MS), [boundaryChild])
  assert.deepEqual(filterSubagentChildren([justPastChild], NOW_MS), [])
})

test("filterSubagentChildren keeps fresh non-running children and preserves the input order", () => {
  const fresh = makeChild({ updatedAtMs: NOW_MS - MINUTE_MS })
  const olderInWindow = makeChild({ id: "sess-child-2", type: "general", updatedAtMs: NOW_MS - SUBAGENT_RECENT_WINDOW_MS + 1 })

  assert.deepEqual(filterSubagentChildren([olderInWindow, fresh], NOW_MS), [olderInWindow, fresh])
})

test("sidebarSubagentsGroup aggregates a multi-child type into a lead row and one labeled muted row", () => {
  const childOne = makeChild({ id: "sess-child-1", type: "scout" })
  const childTwo = makeChild({ id: "sess-child-2", type: "scout", updatedAtMs: NOW_MS - MINUTE_MS })
  const data = dataWithChildren([
    { id: childOne.id, panel: makePanel(childOne.id, { evictions: 1, evictionTokensSaved: 500 }) },
    { id: childTwo.id, panel: makePanel(childTwo.id, { evictions: 1, evictionTokensSaved: 400 }) },
  ])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([childOne, childTwo], data, NOW_MS))

  assert.deepEqual(rows, [
    { text: "Subagents: 2", tone: "muted" },
    { text: "scout: 2 agents, 2 evictions, ~900 tokens", tone: "muted" },
  ])
})

test("sidebarSubagentsGroup omits the agents clause for a single-child type", () => {
  const child = makeChild({ type: "scout" })
  const data = dataWithChildren([{ id: child.id, panel: makePanel(child.id, { evictions: 1, evictionTokensSaved: 900 }) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([child], data, NOW_MS))

  assert.deepEqual(rows, [
    { text: "Subagents: 1", tone: "muted" },
    { text: "scout: 1 evictions, ~900 tokens", tone: "muted" },
  ])
})

test("sidebarSubagentsGroup renders no data yet for a type whose children all lack panel data", () => {
  const child = makeChild({ type: "general" })

  const rows = rowsWithinWidth(sidebarSubagentsGroup([child], dataWithChildren(), NOW_MS))

  assert.deepEqual(rows, [
    { text: "Subagents: 1", tone: "muted" },
    { text: "general: no data yet", tone: "muted" },
  ])
})

test("sidebarSubagentsGroup sums the landed panels of a type and keeps the agents clause when some children lack data", () => {
  const landed = makeChild({ id: "sess-child-1", type: "scout" })
  const dataless = makeChild({ id: "sess-child-2", type: "scout", updatedAtMs: NOW_MS - MINUTE_MS })
  const data = dataWithChildren([{ id: landed.id, panel: makePanel(landed.id, { evictions: 2, evictionTokensSaved: 900 }) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([landed, dataless], data, NOW_MS))

  assert.deepEqual(rows, [
    { text: "Subagents: 2", tone: "muted" },
    { text: "scout: 2 agents, 2 evictions, ~900 tokens", tone: "muted" },
  ])
})

test("sidebarSubagentsGroup sorts type rows by the type's most recent child update, most recent first", () => {
  const olderExplore = makeChild({ id: "sess-child-1", type: "scan", updatedAtMs: NOW_MS - MINUTE_MS })
  const freshProbe = makeChild({ id: "sess-child-2", type: "probe", updatedAtMs: NOW_MS })
  const olderProbe = makeChild({ id: "sess-child-3", type: "probe", updatedAtMs: NOW_MS - 2 * MINUTE_MS })
  const data = dataWithChildren([{ id: freshProbe.id, panel: makePanel(freshProbe.id, { evictions: 2, evictionTokensSaved: 900 }) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([olderExplore, olderProbe, freshProbe], data, NOW_MS))

  assert.deepEqual(rows, [
    { text: "Subagents: 3", tone: "muted" },
    { text: "probe: 2 agents, 2 evictions, ~900 tokens", tone: "muted" },
    { text: "scan: no data yet", tone: "muted" },
  ])
})

test("sidebarSubagentsGroup caps an over-long type label's row at the sidebar column limit and carries eviction savings only", () => {
  const child = makeChild({ type: "a".repeat(60) })
  const data = dataWithChildren([{ id: child.id, panel: makePanel(child.id) }])

  const rows = rowsWithinWidth(sidebarSubagentsGroup([child], data, NOW_MS))

  assert.equal(rows.length, 2)
  assert.equal(rows[1].text, `${"a".repeat(SIDEBAR_COLUMN_LIMIT - 1)}…`)
  assert.ok(!rows.some((row) => /dedup|stash|Deduped|Stash/i.test(row.text)))
  assert.ok(!rows.some((row) => row.text.includes(String(makeTotals().dedupTokensSaved))))
})

test("sidebarSubagentsGroup returns no rows for an empty in-window set", () => {
  assert.deepEqual(sidebarSubagentsGroup([], dataWithChildren(), NOW_MS), [])
})

test("sidebarRows appends a non-empty subagent group as the last blank-line-separated group", () => {
  const data = dataWithChildren()
  const base = sidebarRows(data)
  const group: PanelRow[] = [
    { text: "Subagents: 1", tone: "muted" },
    { text: "explore: 5 evictions, ~3.1k tokens", tone: "muted" },
  ]

  const rows = sidebarRows(data, group)

  assert.deepEqual(rows, [...base, { text: " ", tone: "normal" }, ...group])
})

test("sidebarRows appends the subagent group after the eviction footer when the session block renders", () => {
  const current = makePanel("sess-current", { evictions: 1, evictionTokensSaved: 900 })
  const data: PanelData = { ...dataWithChildren(), current }
  const group: PanelRow[] = [
    { text: "Subagents: 1", tone: "muted" },
    { text: "scout: 1 evictions, ~900 tokens", tone: "muted" },
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
    { text: "LRU context manager", tone: "header" },
    { text: " ", tone: "normal" },
    { text: "no metrics recorded for this session yet", tone: "muted" },
  ])
  assert.deepEqual(sidebarRows(data, undefined), base)
  assert.deepEqual(sidebarRows(data, []), base)
  assert.deepEqual(sidebarRows({ ...data, subagentPanels: undefined }, []), base)
})
