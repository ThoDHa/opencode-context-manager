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
  DEFAULT_SIDEBAR_MODE,
  HOST_SIDEBAR_CONTENT_PLUGIN_IDS,
  PANEL_COMMAND_CATEGORY,
  PANEL_COMMAND_DESCRIPTION,
  PANEL_COMMAND_NAME,
  PANEL_COMMAND_NAMESPACE,
  PANEL_COMMAND_SLASH_NAME,
  PANEL_COMMAND_TITLE,
  SIDEBAR_MODE_CONTEXT,
  SIDEBAR_MODE_FULL,
  resolveSidebarMode,
} = await import("../plugin/panel-data.ts")
const { assertTempHomeOwnsPaths } = await import("./tui/fixtures.ts")
const plugin = (await import("../plugin/context-manager.tui.tsx")).default as TuiPluginEntry

test("the suite's temp HOME owns the plugin's default paths", () => {
  assertTempHomeOwnsPaths(home, DEFAULT_METRICS_PATH, DEFAULT_LIVE_STATE_DIR)
})

const EXPECTED_FOOTER_PLUGIN_ID = "internal:sidebar-footer"

test("resolveSidebarMode defaults to full and falls back to full on unrecognized values", () => {
  assert.equal(SIDEBAR_MODE_FULL, "full")
  assert.equal(SIDEBAR_MODE_CONTEXT, "context")
  assert.equal(DEFAULT_SIDEBAR_MODE, SIDEBAR_MODE_FULL)
  assert.equal(resolveSidebarMode(undefined), DEFAULT_SIDEBAR_MODE)
  assert.equal(resolveSidebarMode(SIDEBAR_MODE_CONTEXT), SIDEBAR_MODE_CONTEXT)
  assert.equal(resolveSidebarMode(SIDEBAR_MODE_FULL), SIDEBAR_MODE_FULL)
  for (const invalid of ["subagents", "FULL", "context ", 42, null, true] as const) {
    assert.equal(resolveSidebarMode(invalid), DEFAULT_SIDEBAR_MODE, `expected ${String(invalid)} to fall back to full`)
  }
})

test("tui entry in context mode deactivates exactly the five host sidebar content built-ins once each", async () => {
  const mock = createTuiApiMock()
  await plugin.tui(mock.api, { sidebarMode: SIDEBAR_MODE_CONTEXT })
  assert.deepEqual(
    mock.calls.pluginsDeactivate,
    HOST_SIDEBAR_CONTENT_PLUGIN_IDS.map((pluginID) => ({ pluginID })),
  )
  assert.equal(mock.calls.pluginsDeactivate.some((call) => call.pluginID === EXPECTED_FOOTER_PLUGIN_ID), false)
  assert.equal(mock.calls.slotsRegister.length, 1)
})

test("tui entry without the option, with full, or with an invalid value records no deactivate call", async () => {
  for (const sidebarMode of [undefined, SIDEBAR_MODE_FULL, "subagents", 42] as const) {
    const mock = createTuiApiMock()
    await plugin.tui(mock.api, sidebarMode === undefined ? {} : { sidebarMode })
    assert.equal(mock.calls.pluginsDeactivate.length, 0, `expected no deactivate for sidebarMode ${String(sidebarMode)}`)
    assert.equal(mock.calls.slotsRegister.length, 1)
  }
})

test("tui entry without a plugins registry skips deactivation without throwing and still registers the sidebar", async () => {
  const mock = createTuiApiMock({ omitPlugins: true })
  await plugin.tui(mock.api, { sidebarMode: SIDEBAR_MODE_CONTEXT })
  assert.equal(mock.calls.pluginsDeactivate.length, 0)
  assert.equal(mock.calls.slotsRegister.length, 1)
  assert.equal(mock.calls.keymapRegisterLayer.length, 1)
})

test("tui entry with sidebarEnabled false skips context-mode deactivation along with the slot registration", async () => {
  const mock = createTuiApiMock()
  await plugin.tui(mock.api, { sidebarEnabled: false, sidebarMode: SIDEBAR_MODE_CONTEXT })
  assert.equal(mock.calls.pluginsDeactivate.length, 0)
  assert.equal(mock.calls.slotsRegister.length, 0)
  assert.equal(mock.calls.keymapRegisterLayer.length, 1)
})

const RECORDED_AROUND_FAILURE_IDS = 2

test("tui entry degrades a throwing and a rejecting deactivate per id and still registers the sidebar", async () => {
  const mock = createTuiApiMock()
  const survived: string[] = []
  mock.api.plugins = {
    deactivate: (pluginID: string): unknown => {
      if (pluginID === HOST_SIDEBAR_CONTENT_PLUGIN_IDS[0]) throw new Error("hostile sync deactivate")
      if (pluginID === HOST_SIDEBAR_CONTENT_PLUGIN_IDS[1]) return Promise.reject(new Error("hostile async deactivate"))
      survived.push(pluginID)
      return undefined
    },
  }
  await plugin.tui(mock.api, { sidebarMode: SIDEBAR_MODE_CONTEXT })
  assert.equal(mock.calls.slotsRegister.length, 1)
  assert.deepEqual(survived, HOST_SIDEBAR_CONTENT_PLUGIN_IDS.slice(RECORDED_AROUND_FAILURE_IDS))
  // A rejected promise-like return must never surface as an unhandled
  // rejection: one macrotask tick lets any escaped rejection crash the
  // runner, so reaching this line after the flush pins the no-op catch.
  await new Promise((resolve) => setImmediate(resolve))
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
