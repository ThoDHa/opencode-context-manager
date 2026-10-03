import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import type { TestContext } from "node:test"

import type { SidebarSlotRenderer, TuiApiMock } from "./tui/api-mock.ts"
import type { StubElementNode } from "./tui/opentui-stub.ts"

// Module-eval, suite-lifetime HOME override, with the plugin imports (the
// dynamic panel-data import below and the .tsx inside the test) kept behind
// it: the seam is documented at the top of tests/tui/fixtures.ts.
const previousHome = process.env.HOME
const home = mkdtempSync(join(tmpdir(), "ctx-tui-home-"))
process.env.HOME = home

after(() => {
  if (previousHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = previousHome
  }
  rmSync(home, { recursive: true, force: true })
})

const { createTuiApiMock } = await import("./tui/api-mock.ts")
const { nodeText, renderTree, settleUntil } = await import("./tui/opentui-stub.ts")
const { assertTempHomeOwnsPaths, writeMetricsLog, writeSessionSnapshot } = await import("./tui/fixtures.ts")
const { EXPECTED_TOKENS_PROCESSED_STAT, makeAdvisory, makeLine, makeTotals, SNAPSHOT_ADVISORY_BAND_START_TOKENS, SNAPSHOT_ADVISORY_RATIO } = await import("./panel-fixtures.ts")
const { DEFAULT_LIVE_STATE_DIR, DEFAULT_METRICS_PATH, formatTokenCount } = await import("../plugin/panel-data.ts")

const POLL_INTERVAL_MS = 5000
const HALF_POLL_INTERVAL_MS = POLL_INTERVAL_MS / 2
// Real-time window for a released refresh chain to reach setRows if the
// dispose guard were broken: mock timers are narrowed to setInterval, so
// this setTimeout stays live, and tmpdir fs round-trips land far inside it.
const GUARD_WINDOW_MS = 250
const CHILD_UPDATED_MS = 1_758_300_000_000
const MINUTE_MS = 60 * 1000

// Per-test separation: every scenario owns a unique sessionID, so the shared
// metrics log and state dir under the suite's single temp HOME never leak
// rows between tests.
const HIDDEN_SESSION = "sess-tui-hidden"
const REPAINT_SESSION = "sess-tui-repaint"
const MOUNT_SESSION = "sess-tui-mount"
const ADVISORY_SESSION = "sess-tui-advisory"
const ADVISORY_BAND_START_FRAGMENT = `${SNAPSHOT_ADVISORY_RATIO} of watermark (${formatTokenCount(SNAPSHOT_ADVISORY_BAND_START_TOKENS)}`
const POLL_SESSION = "sess-tui-poll"
const SUBAGENTS_SESSION = "sess-tui-subagents"
const SUBAGENTS_CHILD = "sess-tui-subagents-child"
const SUBAGENTS_ARCHIVED_CHILD = "sess-tui-subagents-archived"
const NO_SUBAGENTS_SESSION = "sess-tui-no-subagents"
const DISPOSE_INFLIGHT_SESSION = "sess-tui-dispose-inflight"
const DISPOSE_PAINTED_SESSION = "sess-tui-dispose-painted"

type SidebarTuiEntry = (
  api: TuiApiMock["api"],
  options?: { sidebarEnabled?: boolean; sidebarSubagents?: boolean },
) => Promise<void>

type MountedSidebar = {
  root: StubElementNode
  dispose: () => void
  calls: TuiApiMock["calls"]
}

// One `client.session.children` payload row in the shape
// resolveSubagentChildren parses; archived rides time.archived's presence.
const childRecord = (id: string, agent: string, updatedMs: number, archived = false): Record<string, unknown> => ({
  id,
  agent,
  time: archived ? { updated: updatedMs, archived: true } : { updated: updatedMs },
})

// Mounts the sidebar the way the host does: the tui() registration path
// yields the sidebar_content slot renderer, and the stub tree renders it
// with the session props the host slot call would pass. configure runs
// before mount, so handlers (children results) are in place for the
// onMount refresh's first fetch.
const mountSidebar = async (
  tui: SidebarTuiEntry,
  sessionID: string,
  subagentsEnabled: boolean,
  configure?: (mock: TuiApiMock) => void,
): Promise<MountedSidebar> => {
  const mock = createTuiApiMock()
  configure?.(mock)
  await tui(mock.api, { sidebarEnabled: true, sidebarSubagents: subagentsEnabled })
  const registration = mock.calls.slotsRegister[0]
  const renderer = registration?.slots["sidebar_content"] as SidebarSlotRenderer | undefined
  assert.equal(typeof renderer, "function", "tui must register the sidebar_content slot renderer")
  const tree = renderTree(() => renderer(undefined, { session_id: sessionID }))
  return { root: tree.root, dispose: tree.dispose, calls: mock.calls }
}

const waitRealMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// One scaffold per scenario: mock the poll interval (narrowly, so the
// settle helper's own setTimeout stays real), mount under it, run the
// body, then dispose the tree and restore the timers on every path.
const withPollSidebar = async (
  st: TestContext,
  tui: SidebarTuiEntry,
  sessionID: string,
  subagentsEnabled: boolean,
  run: (sidebar: MountedSidebar) => Promise<void>,
  configure?: (mock: TuiApiMock) => void,
): Promise<void> => {
  let sidebar: MountedSidebar | undefined
  try {
    st.mock.timers.enable({ apis: ["setInterval"] })
    sidebar = await mountSidebar(tui, sessionID, subagentsEnabled, configure)
    await run(sidebar)
  } finally {
    sidebar?.dispose()
    st.mock.timers.reset()
  }
}

test("the suite's temp HOME owns the plugin's default paths", () => {
  assertTempHomeOwnsPaths(home, DEFAULT_METRICS_PATH, DEFAULT_LIVE_STATE_DIR)
})

test("SidebarEntry renders, polls, and disposes against the temp HOME fixtures", async (suite) => {
  // First .tsx import, inside the test so the compiled module evaluates
  // after the module-eval HOME override above; the seam is documented at
  // the top of tests/tui/fixtures.ts.
  const tui: SidebarTuiEntry = (await import("../plugin/context-manager.tui.tsx")).default.tui

  await suite.test("startup ENOENT transient keeps the entry hidden on mount and on a data-less poll tick", async (st) => {
    await withPollSidebar(st, tui, HIDDEN_SESSION, true, async (sidebar) => {
      await settleUntil(() => sidebar.calls.children.length >= 1)
      assert.equal(nodeText(sidebar.root), "")

      st.mock.timers.tick(POLL_INTERVAL_MS)
      await settleUntil(() => sidebar.calls.children.length >= 2)
      assert.equal(nodeText(sidebar.root), "")
      assert.equal(sidebar.calls.children.length, 2)
    })
  })

  await suite.test("entry repaints when data arrives on the poll tick after the startup transient", async (st) => {
    await withPollSidebar(st, tui, REPAINT_SESSION, true, async (sidebar) => {
      await settleUntil(() => sidebar.calls.children.length >= 1)
      assert.equal(nodeText(sidebar.root), "")

      writeSessionSnapshot(DEFAULT_LIVE_STATE_DIR, REPAINT_SESSION, { session: REPAINT_SESSION })
      writeMetricsLog(DEFAULT_METRICS_PATH, [makeLine({ session: REPAINT_SESSION, evictedThisRun: [] })])

      st.mock.timers.tick(POLL_INTERVAL_MS)
      await settleUntil(() => nodeText(sidebar.root).includes("Context Manager"))
      assert.ok(nodeText(sidebar.root).includes("Context limit: 200k"))
    })
  })

  await suite.test("mount renders the checkpoint's context limit and totals while the log supplies the recent eviction", async (st) => {
    writeSessionSnapshot(DEFAULT_LIVE_STATE_DIR, MOUNT_SESSION, { session: MOUNT_SESSION, contextLimit: 300000 })
    writeMetricsLog(DEFAULT_METRICS_PATH, [makeLine({ session: MOUNT_SESSION, totals: { ...makeTotals(), evictions: 9 } })])
    await withPollSidebar(st, tui, MOUNT_SESSION, false, async (sidebar) => {
      await settleUntil(() => nodeText(sidebar.root).includes("Context Manager"))
      const text = nodeText(sidebar.root)
      assert.ok(text.includes("Context Manager (manual)"))
      assert.ok(text.includes("Context limit: 300k"), `snapshot budget should win: ${text}`)
      assert.ok(!text.includes("Context limit: 200k"))
      assert.ok(text.includes("Watermark: 100k"))
      assert.ok(text.includes("Over by: 23.5k"))
      assert.ok(text.includes("Window: 123.5k"))
      assert.ok(text.includes(EXPECTED_TOKENS_PROCESSED_STAT))
      assert.ok(text.includes("Evictions: 5, 3.1k tokens"), `snapshot totals should win: ${text}`)
      assert.ok(!text.includes("Evictions: 9"))
      assert.ok(text.includes("Last evicted: read /data/a.txt"), `log should supply evictions: ${text}`)
      assert.ok(text.includes("3 kB, 7 messages ago"))
    })
  })

  await suite.test("entry renders the snapshot's Advisory row after the Window row when the checkpoint carries one", async (st) => {
    writeSessionSnapshot(DEFAULT_LIVE_STATE_DIR, ADVISORY_SESSION, { session: ADVISORY_SESSION, advisory: makeAdvisory() })
    writeMetricsLog(DEFAULT_METRICS_PATH, [makeLine({ session: ADVISORY_SESSION, evictedThisRun: [] })])
    await withPollSidebar(st, tui, ADVISORY_SESSION, false, async (sidebar) => {
      await settleUntil(() => nodeText(sidebar.root).includes("Context Manager"))
      const text = nodeText(sidebar.root)
      const windowIndex = text.indexOf("Window:")
      const advisoryIndex = text.indexOf("Advisory:")
      const tokensIndex = text.indexOf("Tokens processed:")
      assert.ok(windowIndex !== -1)
      assert.ok(advisoryIndex !== -1, "expected the Advisory row to render")
      assert.ok(tokensIndex !== -1)
      assert.ok(windowIndex < advisoryIndex && advisoryIndex < tokensIndex, `the Advisory row must sit after Window and before Tokens processed: ${text}`)
      assert.ok(text.includes(ADVISORY_BAND_START_FRAGMENT))
    })
  })

  await suite.test("poll-tick refresh fires at 5000 ms and repaints a whole-file log rewrite", async (st) => {
    writeMetricsLog(DEFAULT_METRICS_PATH, [makeLine({ session: POLL_SESSION })])
    await withPollSidebar(st, tui, POLL_SESSION, false, async (sidebar) => {
      await settleUntil(() => nodeText(sidebar.root).includes("Evictions: 5,"))

      writeMetricsLog(DEFAULT_METRICS_PATH, [
        makeLine({ session: POLL_SESSION, evictedThisRun: [], totals: { ...makeTotals(), evictions: 9 } }),
      ])

      st.mock.timers.tick(HALF_POLL_INTERVAL_MS)
      assert.ok(nodeText(sidebar.root).includes("Evictions: 5,"))
      assert.ok(!nodeText(sidebar.root).includes("Evictions: 9"))

      st.mock.timers.tick(HALF_POLL_INTERVAL_MS)
      await settleUntil(() => nodeText(sidebar.root).includes("Evictions: 9"))
      assert.ok(!nodeText(sidebar.root).includes("Evictions: 5,"))
    })
  })

  await suite.test("subagents enabled fetches children with the session id, renders the group, and filters archived children", async (st) => {
    writeSessionSnapshot(DEFAULT_LIVE_STATE_DIR, SUBAGENTS_SESSION, { session: SUBAGENTS_SESSION })
    writeSessionSnapshot(DEFAULT_LIVE_STATE_DIR, SUBAGENTS_CHILD, {
      session: SUBAGENTS_CHILD,
      totals: {
        ...makeTotals(),
        evictions: 2,
        evictionTokensSaved: 1500,
        dedupedUnique: 1,
        dedupTokensSaved: 800,
        reasoningExpiredUnique: 2,
        reasoningTokensSaved: 1200,
      },
    })
    await withPollSidebar(st, tui, SUBAGENTS_SESSION, true, async (sidebar) => {
      await settleUntil(() => nodeText(sidebar.root).includes("Subagents:"))
      assert.deepEqual(sidebar.calls.children, [{ sessionID: SUBAGENTS_SESSION }])
      const text = nodeText(sidebar.root)
      assert.ok(text.includes("Subagents: 1"))
      assert.ok(text.includes(EXPECTED_TOKENS_PROCESSED_STAT))
      assert.equal(text.split("Window:").length - 1, 1, "only the session block renders a Window row")
      assert.ok(text.includes("Explore: 1 agent"))
      assert.ok(text.includes("Evictions: 2, 1.5k tokens"))
      assert.ok(text.includes("Deduped: 1, 800 tokens"))
      assert.ok(text.includes("Reasoning expired: 2, 1.2k tokens"))
      assert.ok(!text.includes("General"))
      assert.ok(!text.includes("Subagents: 2"))
    }, (mock) => {
      mock.serveChildren({
        data: [
          childRecord(SUBAGENTS_CHILD, "explore", CHILD_UPDATED_MS),
          childRecord(SUBAGENTS_ARCHIVED_CHILD, "general", CHILD_UPDATED_MS - MINUTE_MS, true),
        ],
      })
    })
  })

  await suite.test("subagents disabled never calls the children endpoint, even across poll ticks", async (st) => {
    writeSessionSnapshot(DEFAULT_LIVE_STATE_DIR, NO_SUBAGENTS_SESSION, { session: NO_SUBAGENTS_SESSION })
    await withPollSidebar(st, tui, NO_SUBAGENTS_SESSION, false, async (sidebar) => {
      await settleUntil(() => nodeText(sidebar.root).includes("Context Manager"))
      assert.equal(sidebar.calls.children.length, 0)

      st.mock.timers.tick(POLL_INTERVAL_MS)
      await waitRealMs(GUARD_WINDOW_MS)
      assert.equal(sidebar.calls.children.length, 0)
      assert.ok(nodeText(sidebar.root).includes("Context limit: 200k"))
    })
  })

  await suite.test("disposing during an in-flight refresh freezes the tree without throwing", async (st) => {
    writeSessionSnapshot(DEFAULT_LIVE_STATE_DIR, DISPOSE_INFLIGHT_SESSION, { session: DISPOSE_INFLIGHT_SESSION })
    let releaseChildren!: (value: unknown) => void
    await withPollSidebar(st, tui, DISPOSE_INFLIGHT_SESSION, true, async (sidebar) => {
      await settleUntil(() => sidebar.calls.children.length >= 1)
      sidebar.dispose()
      releaseChildren({ data: [] })
      await waitRealMs(GUARD_WINDOW_MS)
      assert.equal(nodeText(sidebar.root), "")

      st.mock.timers.tick(POLL_INTERVAL_MS)
      await waitRealMs(GUARD_WINDOW_MS)
      assert.equal(sidebar.calls.children.length, 1)
      assert.equal(nodeText(sidebar.root), "")
    }, (mock) => {
      mock.serveChildren(
        new Promise((resolve) => {
          releaseChildren = resolve
        }),
      )
    })
  })

  await suite.test("post-dispose poll ticks are no-ops after clearInterval", async (st) => {
    writeMetricsLog(DEFAULT_METRICS_PATH, [makeLine({ session: DISPOSE_PAINTED_SESSION })])
    await withPollSidebar(st, tui, DISPOSE_PAINTED_SESSION, false, async (sidebar) => {
      await settleUntil(() => nodeText(sidebar.root).includes("Evictions: 5,"))

      writeMetricsLog(DEFAULT_METRICS_PATH, [
        makeLine({ session: DISPOSE_PAINTED_SESSION, evictedThisRun: [], totals: { ...makeTotals(), evictions: 9 } }),
      ])

      sidebar.dispose()
      st.mock.timers.tick(POLL_INTERVAL_MS)
      st.mock.timers.tick(POLL_INTERVAL_MS)
      await waitRealMs(GUARD_WINDOW_MS)
      assert.ok(nodeText(sidebar.root).includes("Evictions: 5,"))
      assert.ok(!nodeText(sidebar.root).includes("Evictions: 9"))
    })
  })
})
