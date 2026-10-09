import { readFileSync } from "node:fs"
import { registerHooks, createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

// The compiled universal-mode output imports its helper set from one module
// URL; pointing preset-solid at the stub's URL wires the stub in without any
// resolve-hook aliasing.
export const STUB_MODULE_URL = new URL("./opentui-stub.ts", import.meta.url).href

const require = createRequire(import.meta.url)

// Workaround for solid-js 1.9.17 package exports: the bare "solid-js"
// specifier resolves to dist/server.js under Node's implicit "node" export
// condition, and the server build's createSignal/createRenderEffect are
// no-ops, so signal-driven updates never fire. Expected behavior (browser
// builds) is real reactivity; redirecting the specifier to the client build
// dist/solid.js restores it for every module in the process, including
// solid-js/universal's own internal import. Remove if a later solid-js
// stops shadowing the client build behind the "node" condition.
const SOLID_JS_CLIENT_URL = pathToFileURL(require.resolve("solid-js/dist/solid.js")).href

// Compiles with the pinned test toolchain (babel-preset-solid 1.9.16 with
// generate "universal" over the stub module, plus the TypeScript preset for
// .tsx parsing) against the solid-js 1.9.17 client build, following the
// @opentui/solid 0.5.14 solid-transform recipe; this deliberately diverges
// from the host's bundled solid-js 1.9.10 instead of mirroring it.
export const compileTsxSource = (source, filename) => {
  // Both presets and @babel/core expose the preset/transform as their CJS
  // module.exports directly (verified against the pinned versions).
  const presetSolid = require("babel-preset-solid")
  const presetTypescript = require("@babel/preset-typescript")
  const { transformSync } = require("@babel/core")
  const compiled = transformSync(source, {
    filename,
    presets: [
      [presetSolid, { moduleName: STUB_MODULE_URL, generate: "universal" }],
      [presetTypescript, {}],
    ],
    sourceType: "module",
  })
  if (typeof compiled.code !== "string") {
    throw new Error(`babel produced no code for ${filename}`)
  }
  return compiled.code
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "solid-js") {
      return { url: SOLID_JS_CLIENT_URL, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) {
      const filename = fileURLToPath(url)
      const source = readFileSync(filename, "utf8")
      const code = compileTsxSource(source, filename)
      return { format: "module", source: code, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
