import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import assert from "node:assert/strict"

import {
  EXPECTED_DIALOG_SIZE,
  createTuiApiMock,
  type RegisteredCommand,
  type TuiApiMock,
  type TuiPluginEntry,
} from "./tui/api-mock.ts"
import { nodeText, renderTree, settleUntil } from "./tui/opentui-stub.ts"

const EXPECTED_SIDEBAR_SLOT_ORDER = 600
const EXPECTED_SIDEBAR_SLOT_NAME = "sidebar_content"

// Module-eval, suite-lifetime HOME override: this suite's plugin imports
// (dynamic below) must not evaluate before it lands; the seam is documented
// at the top of tests/tui/fixtures.ts.
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

const {
  DEFAULT_LIVE_STATE_DIR,
  DEFAULT_METRICS_PATH,
  PANEL_COMMAND_CATEGORY,
  PANEL_COMMAND_DESCRIPTION,
  PANEL_COMMAND_NAME,
  PANEL_COMMAND_NAMESPACE,
  PANEL_COMMAND_SLASH_NAME,
  PANEL_COMMAND_TITLE,
} = await import("../plugin/panel-data.ts")
const { assertTempHomeOwnsPaths } = await import("./tui/fixtures.ts")
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

test("tui entry registers the keymap layer with the panel command identity", async () => {
  const mock = createTuiApiMock()
  await plugin.tui(mock.api)
  assert.equal(mock.calls.keymapRegisterLayer.length, 1)
  const command = registeredCommandOf(mock)
  assert.equal(command.namespace, PANEL_COMMAND_NAMESPACE)
  assert.equal(command.name, PANEL_COMMAND_NAME)
  assert.equal(command.title, PANEL_COMMAND_TITLE)
  assert.equal(command.desc, PANEL_COMMAND_DESCRIPTION)
  assert.equal(command.category, PANEL_COMMAND_CATEGORY)
  assert.equal(command.slashName, PANEL_COMMAND_SLASH_NAME)
})

test("panel command run opens the dialog through the open flow", async () => {
  const mock = createTuiApiMock()
  await plugin.tui(mock.api)
  registeredCommandOf(mock).run()
  await settleUntil(() => mock.calls.dialogSetSize.length > 0 && mock.calls.dialogReplace.length > 0)
  assert.deepEqual(mock.calls.dialogSetSize, [{ size: EXPECTED_DIALOG_SIZE }])
  const renderer = mock.calls.dialogReplace[0].renderer
  assert.equal(typeof renderer, "function")
  const tree = renderTree(renderer as () => unknown)
  try {
    const rendered = nodeText(tree.root)
    assert.ok(rendered.includes(PANEL_COMMAND_TITLE))
    assert.ok(rendered.includes("no active session"))
  } finally {
    tree.dispose()
  }
})

test("tui entry skips the command when the keymap registry is absent", async () => {
  const mock = createTuiApiMock({ omitKeymap: true })
  await plugin.tui(mock.api)
  assert.equal(mock.calls.keymapRegisterLayer.length, 0)
  assert.equal(mock.calls.slotsRegister.length, 1)
})

test("tui entry skips the sidebar when the slots registry is absent", async () => {
  const mock = createTuiApiMock({ omitSlots: true })
  await plugin.tui(mock.api)
  assert.equal(mock.calls.slotsRegister.length, 0)
  assert.equal(mock.calls.keymapRegisterLayer.length, 1)
})

test("tui entry gates the sidebar slot on the sidebarEnabled option", async () => {
  const mock = createTuiApiMock()
  await plugin.tui(mock.api, { sidebarEnabled: false })
  assert.equal(mock.calls.slotsRegister.length, 0)
  assert.equal(mock.calls.keymapRegisterLayer.length, 1)
})

test("tui entry registers the sidebar slot with order 600 and the sidebar_content renderer", async () => {
  const mock = createTuiApiMock()
  await plugin.tui(mock.api)
  assert.equal(mock.calls.slotsRegister.length, 1)
  const registration = mock.calls.slotsRegister[0]
  assert.equal(registration.order, EXPECTED_SIDEBAR_SLOT_ORDER)
  assert.deepEqual(Object.keys(registration.slots), [EXPECTED_SIDEBAR_SLOT_NAME])
  assert.equal(typeof registration.slots[EXPECTED_SIDEBAR_SLOT_NAME], "function")
})
