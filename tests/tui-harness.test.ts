import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import assert from "node:assert/strict"

import { compileTsxSource, STUB_MODULE_URL } from "./tui/hooks.mjs"
import { mountProbe } from "./tui/probe.tsx"
import { nodeText, settleUntil, walkTree } from "./tui/opentui-stub.ts"
import { canRegisterKeymap, canRegisterSidebar } from "../plugin/panel-data.ts"
import { createTuiApiMock } from "./tui/api-mock.ts"
import { PLUGIN_ID } from "../plugin/schema.ts"

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const TUI_SOURCE_PATH = join(THIS_DIR, "..", "plugin", "context-manager.tui.tsx")

const IMPORT_PATTERN = /import\s+(?:([^;]*?)\s+from\s+)?["']([^"']+)["']/g

test("plugin TUI module imports through the hook with the host entry shape", async () => {
  const mod = await import("../plugin/context-manager.tui.tsx")
  assert.equal(mod.default.id, PLUGIN_ID)
  assert.equal(typeof mod.default.tui, "function")
})

test("compiled TUI module imports nothing from node_modules except solid-js and the stub covers its helpers", async () => {
  const source = readFileSync(TUI_SOURCE_PATH, "utf8")
  const compiled = compileTsxSource(source, pathToFileURL(TUI_SOURCE_PATH).href)

  const specifiers: string[] = []
  const stubImports: string[] = []
  for (const match of compiled.matchAll(IMPORT_PATTERN)) {
    const [, names, specifier] = match
    specifiers.push(specifier)
    if (specifier === STUB_MODULE_URL && names !== undefined) {
      stubImports.push(...names.replace(/[{}]/g, "").split(",").map((name) => name.trim().split(/\s+as\s+/)[0]).filter(Boolean))
    }
  }

  assert.ok(stubImports.length > 0, "compiled module should import helpers from the stub")
  const stubModule = await import("./tui/opentui-stub.ts")
  for (const name of stubImports) {
    assert.ok(name in stubModule, `stub must export emitted helper "${name}"`)
  }
  for (const specifier of specifiers) {
    const isStub = specifier === STUB_MODULE_URL
    const isSolid = specifier === "solid-js"
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../")
    assert.ok(isStub || isSolid || isRelative, `unexpected module specifier in compiled output: ${specifier}`)
  }
})

test("walker flattens the stub tree depth first with element names and props", async () => {
  const probe = mountProbe(1)
  try {
    const nodes = walkTree(probe.root)
    const names = nodes
      .filter((node) => node.kind === "element" && node !== probe.root)
      .map((node) => node.name)
    assert.deepEqual(names, ["box", "text"])
    assert.equal(nodeText(probe.root), "count: 1")
  } finally {
    probe.dispose()
  }
})

test("probe component's signal-driven update is observable through the walker", async () => {
  const probe = mountProbe(1)
  try {
    assert.equal(nodeText(probe.root), "count: 1")
    probe.setValue(2)
    await settleUntil(() => nodeText(probe.root).includes("count: 2"))
    assert.equal(nodeText(probe.root), "count: 2")
  } finally {
    probe.dispose()
  }
})

test("api mock omits keymap and slots on demand so the canRegister guard paths go false", () => {
  const full = createTuiApiMock()
  assert.equal(canRegisterKeymap(full.api), true)
  assert.equal(canRegisterSidebar(full.api), true)

  const noKeymap = createTuiApiMock({ omitKeymap: true })
  assert.equal(canRegisterKeymap(noKeymap.api), false)
  assert.equal(canRegisterSidebar(noKeymap.api), true)

  const noSlots = createTuiApiMock({ omitSlots: true })
  assert.equal(canRegisterKeymap(noSlots.api), true)
  assert.equal(canRegisterSidebar(noSlots.api), false)

  const bare = createTuiApiMock({ omitKeymap: true, omitSlots: true })
  assert.equal(canRegisterKeymap(bare.api), false)
  assert.equal(canRegisterSidebar(bare.api), false)
})
