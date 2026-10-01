import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import assert from "node:assert/strict"

import {
  EXPECTED_DIALOG_SIZE,
  MOCK_THEME,
  createTuiApiMock,
  type RegisteredCommand,
  type SidebarSlotRenderer,
  type TuiApiMock,
  type TuiPluginEntry,
} from "./tui/api-mock.ts"
import {
  nodeText,
  renderTree,
  settleUntil,
  walkTree,
  type RenderedTree,
  type StubElementNode,
  type StubNode,
} from "./tui/opentui-stub.ts"

const EXPECTED_SIDEBAR_SLOT_NAME = "sidebar_content"
const NO_SESSION_ROW_TEXT = "no active session"
const UNREADABLE_ROW_MARKER = "metrics log unreadable:"
const EVICTION_ROW_MARKER = "last evicted:"
const MANUAL_MODE_HEADER_SUFFIX = " (manual)"
const BUDGET_LABEL_SPAN = "budget: "
const TOAST_TRIGGER_FAILURE = "setSize exploded"
const SUBAGENT_ROW_MARKER = "General:"
const SUBAGENT_STRONG_LABEL = "General: "
const CHILD_ID = "child-tui-sidebar"
const CHILD_AGENT_TYPE = "general"
const CHILD_UPDATED_MS = 1000

// Expected row text derived from the panel-fixtures values: the snapshot's
// 200000-token model budget formats as ~200k and the "model" source labels
// as per-model limit; the log fixture's eviction reads /data/a.txt.
const SNAPSHOT_BUDGET_ROW = "budget: ~200k tokens (per-model limit)"
const EVICTIONS_SUCCESS_MARKER = "5, ~3.1k tokens"
const STASH_SUCCESS_MARKER = "10, 4 hits"

const EXPECTED_LABEL_SPAN_COUNT = 4
const EXPECTED_TEXT_VALUE_SPAN_COUNT = 3
const EXPECTED_SUCCESS_SPAN_COUNT = 4
const EXPECTED_WARNING_SPAN_COUNT = 1

const SNAPSHOT_SESSION = "sess-tui-panel-snapshot"
const LOG_ONLY_SESSION = "sess-tui-panel-colors"
const UNREADABLE_SESSION = "sess-tui-panel-unreadable"
const SIDEBAR_SESSION = "sess-tui-panel-sidebar"

const SUBAGENT_CHILD = { id: CHILD_ID, agent: CHILD_AGENT_TYPE, time: { updated: CHILD_UPDATED_MS } }

type FgStyle = { fg?: string }

const elementsOfName = (root: StubNode, name: string): StubElementNode[] =>
  walkTree(root).filter((node): node is StubElementNode => node.kind === "element" && node.name === name)

const styleFgOf = (node: StubElementNode): string | undefined => (node.props["style"] as FgStyle | undefined)?.fg

const spansWithFg = (root: StubNode, fg: string): StubElementNode[] =>
  elementsOfName(root, "span").filter((node) => styleFgOf(node) === fg)

// Module-eval, suite-lifetime HOME override: this suite's plugin imports
// (dynamic below) must not evaluate before it lands; the seam is documented
// at the top of tests/tui/fixtures.ts. Fixture writes go through the
// fixtures.ts writers, with paths from the plugin's own exported constants
// so writer and reader cannot drift.
const home = mkdtempSync(join(tmpdir(), "ctx-tui-home-"))
const previousHome = process.env.HOME
process.env.HOME = home
after(() => {
  if (previousHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = previousHome
  }
  rmSync(home, { recursive: true, force: true })
})

const { assertTempHomeOwnsPaths, writeMetricsLog, writeSessionSnapshot } = await import("./tui/fixtures.ts")
const { makeLine } = await import("./panel-fixtures.ts")
const { DEFAULT_LIVE_STATE_DIR, DEFAULT_METRICS_PATH, PANEL_COMMAND_TITLE } = await import("../plugin/panel-data.ts")
const plugin = (await import("../plugin/context-manager.tui.tsx")).default as TuiPluginEntry

test("the suite's temp HOME owns the plugin's default paths", () => {
  assertTempHomeOwnsPaths(home, DEFAULT_METRICS_PATH, DEFAULT_LIVE_STATE_DIR)
})

const registeredCommandOf = (mock: TuiApiMock): RegisteredCommand => {
  const layer = mock.calls.keymapRegisterLayer[0]
  assert.ok(layer !== undefined, "expected the tui entry to register one keymap layer")
  assert.equal(layer.commands.length, 1)
  const command = layer.commands[0] as RegisteredCommand | undefined
  assert.ok(command !== undefined, "expected the layer to carry the panel command")
  return command
}

const openPanelRenderer = async (mock: TuiApiMock): Promise<unknown> => {
  await plugin.tui(mock.api)
  assert.equal(mock.calls.keymapRegisterLayer.length, 1)
  registeredCommandOf(mock).run()
  await settleUntil(() => mock.calls.dialogReplace.length > 0)
  return mock.calls.dialogReplace[0].renderer
}

// Mounts a recorded renderer into a stub tree and disposes it on every path,
// so a failing assertion inside run cannot leak solid effects or poll timers.
const withRenderedTree = async (renderer: unknown, run: (tree: RenderedTree) => Promise<void>): Promise<void> => {
  const tree = renderTree(renderer as () => unknown)
  try {
    await run(tree)
  } finally {
    tree.dispose()
  }
}

test("open flow sizes the dialog large and replaces its content", async () => {
  const mock = createTuiApiMock()
  mock.setNonSessionRoute()
  const renderer = await openPanelRenderer(mock)
  assert.deepEqual(mock.calls.dialogSetSize, [{ size: EXPECTED_DIALOG_SIZE }])
  await withRenderedTree(renderer, async (tree) => {
    const rendered = nodeText(tree.root)
    assert.ok(rendered.includes(PANEL_COMMAND_TITLE))
    assert.ok(rendered.includes(NO_SESSION_ROW_TEXT))
  })
})

test("session route renders the session's snapshot data plus its log evictions", async () => {
  writeSessionSnapshot(DEFAULT_LIVE_STATE_DIR, SNAPSHOT_SESSION, { session: SNAPSHOT_SESSION })
  // Tests in this file share the one metrics log under the temp HOME; the
  // sharing is safe because every write replaces the file whole, the
  // unreadable-log test's directory substitution is restored to a writable
  // path in its finally, and node --test runs a file's tests serially.
  writeMetricsLog(DEFAULT_METRICS_PATH, [makeLine({ session: SNAPSHOT_SESSION })])
  const mock = createTuiApiMock()
  mock.setSessionRoute(SNAPSHOT_SESSION)
  const renderer = await openPanelRenderer(mock)
  await withRenderedTree(renderer, async (tree) => {
    const rendered = nodeText(tree.root)
    assert.ok(rendered.includes(`${PANEL_COMMAND_TITLE}${MANUAL_MODE_HEADER_SUFFIX}`))
    assert.ok(rendered.includes(SNAPSHOT_BUDGET_ROW))
    assert.ok(rendered.includes(EVICTION_ROW_MARKER))
    assert.equal(rendered.includes(NO_SESSION_ROW_TEXT), false)
    assert.equal(mock.calls.children.length, 0)
  })
})

test("non-session route renders the no-active-session row", async () => {
  const mock = createTuiApiMock()
  mock.setNonSessionRoute()
  const renderer = await openPanelRenderer(mock)
  await withRenderedTree(renderer, async (tree) => {
    const rendered = nodeText(tree.root)
    assert.ok(rendered.includes(NO_SESSION_ROW_TEXT))
    assert.equal(rendered.includes(MANUAL_MODE_HEADER_SUFFIX), false)
  })
})

test("empty sessionID on the session route renders the no-active-session row", async () => {
  const mock = createTuiApiMock()
  mock.setSessionRoute("")
  const renderer = await openPanelRenderer(mock)
  await withRenderedTree(renderer, async (tree) => {
    const rendered = nodeText(tree.root)
    assert.ok(rendered.includes(NO_SESSION_ROW_TEXT))
    assert.equal(rendered.includes(MANUAL_MODE_HEADER_SUFFIX), false)
  })
})

test("unreadable metrics log renders the warning row without toasting", async () => {
  writeSessionSnapshot(DEFAULT_LIVE_STATE_DIR, UNREADABLE_SESSION, { session: UNREADABLE_SESSION })
  // A directory at the metrics path makes open() fail with EISDIR, which is
  // not ENOENT, so the reader rethrows into loadPanelData's error field; the
  // directory replaces any log file earlier tests wrote and is removed below
  // so later tests see a writable path again.
  rmSync(DEFAULT_METRICS_PATH, { force: true })
  mkdirSync(DEFAULT_METRICS_PATH, { recursive: true })
  const mock = createTuiApiMock()
  mock.setSessionRoute(UNREADABLE_SESSION)
  try {
    const renderer = await openPanelRenderer(mock)
    await withRenderedTree(renderer, async (tree) => {
      const rendered = nodeText(tree.root)
      assert.ok(rendered.includes(UNREADABLE_ROW_MARKER))
      assert.ok(rendered.includes(`${PANEL_COMMAND_TITLE}${MANUAL_MODE_HEADER_SUFFIX}`))
      assert.equal(mock.calls.toast.length, 0)
      const warningSpans = spansWithFg(tree.root, MOCK_THEME.warning)
      assert.equal(warningSpans.length, EXPECTED_WARNING_SPAN_COUNT)
      assert.ok(nodeText(warningSpans[0]).length > 0)
    })
  } finally {
    rmSync(DEFAULT_METRICS_PATH, { recursive: true, force: true })
  }
})

test("open failure toasts the panel error", async () => {
  const mock = createTuiApiMock()
  await plugin.tui(mock.api)
  mock.api.ui.dialog.setSize = () => {
    throw new Error(TOAST_TRIGGER_FAILURE)
  }
  registeredCommandOf(mock).run()
  await settleUntil(() => mock.calls.toast.length > 0)
  assert.deepEqual(mock.calls.toast, [
    { variant: "error", title: PANEL_COMMAND_TITLE, message: `panel failed to open: ${TOAST_TRIGGER_FAILURE}` },
  ])
  assert.equal(mock.calls.dialogReplace.length, 0)
})

test("panel rows carry tone colors through fg and style.fg spans", async () => {
  writeMetricsLog(DEFAULT_METRICS_PATH, [makeLine({ session: LOG_ONLY_SESSION })])
  const mock = createTuiApiMock()
  mock.setSessionRoute(LOG_ONLY_SESSION)
  const renderer = await openPanelRenderer(mock)
  await withRenderedTree(renderer, async (tree) => {
    const wholeLineTexts = elementsOfName(tree.root, "text").filter((node) => node.props["fg"] !== undefined)
    assert.equal(wholeLineTexts.length, 1)
    assert.equal(wholeLineTexts[0].props["fg"], MOCK_THEME.primary)
    assert.equal(nodeText(wholeLineTexts[0]), PANEL_COMMAND_TITLE)
    const labelSpans = spansWithFg(tree.root, MOCK_THEME.accent)
    assert.equal(labelSpans.length, EXPECTED_LABEL_SPAN_COUNT)
    assert.equal(spansWithFg(tree.root, MOCK_THEME.text).length, EXPECTED_TEXT_VALUE_SPAN_COUNT)
    const budgetLabel = elementsOfName(tree.root, "span").find((node) => nodeText(node) === BUDGET_LABEL_SPAN)
    assert.ok(budgetLabel !== undefined, "expected the budget row's label span")
    assert.equal(styleFgOf(budgetLabel), MOCK_THEME.accent)
    const infoSpans = spansWithFg(tree.root, MOCK_THEME.info)
    assert.equal(infoSpans.length, 1)
    assert.ok(nodeText(infoSpans[0]).includes("read /data/a.txt"))
  })
})

test("sidebar slot renderer renders bold info labels and success tone values", async () => {
  writeMetricsLog(DEFAULT_METRICS_PATH, [makeLine({ session: SIDEBAR_SESSION })])
  const mock = createTuiApiMock()
  mock.serveChildren({ data: [SUBAGENT_CHILD] })
  await plugin.tui(mock.api, { sidebarSubagents: true })
  assert.equal(mock.calls.slotsRegister.length, 1)
  const renderer = mock.calls.slotsRegister[0].slots[EXPECTED_SIDEBAR_SLOT_NAME] as SidebarSlotRenderer
  assert.equal(typeof renderer, "function")
  await withRenderedTree(() => renderer(undefined, { session_id: SIDEBAR_SESSION }), async (tree) => {
    await settleUntil(() => nodeText(tree.root).includes(SUBAGENT_ROW_MARKER))
    assert.deepEqual(mock.calls.children, [{ sessionID: SIDEBAR_SESSION }])
    const strongLabels = elementsOfName(tree.root, "strong")
    assert.equal(strongLabels.length, 1)
    assert.equal(nodeText(strongLabels[0]), SUBAGENT_STRONG_LABEL)
    assert.equal(styleFgOf(strongLabels[0]), MOCK_THEME.info)
    const successSpans = spansWithFg(tree.root, MOCK_THEME.success)
    assert.equal(successSpans.length, EXPECTED_SUCCESS_SPAN_COUNT)
    const successText = successSpans.map((node) => nodeText(node)).join(" ")
    assert.ok(successText.includes(EVICTIONS_SUCCESS_MARKER))
    assert.ok(successText.includes(STASH_SUCCESS_MARKER))
  })
})
