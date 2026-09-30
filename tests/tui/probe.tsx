import { createSignal } from "solid-js"

import { type StubElementNode, renderTree } from "./opentui-stub.ts"

// The reactivity proof fixture: the smallest signal-driven component compiled
// through the same hook the plugin .tsx goes through, so the smoke suite can
// show a signal update landing in the stub tree before any behavior suite is
// written.
export type Probe = { root: StubElementNode; setValue: (value: number) => void; dispose: () => void }

export const mountProbe = (initial: number): Probe => {
  const [value, setValue] = createSignal(initial)
  const tree = renderTree(() => (
    <box flexDirection="column">
      <text>count: {value()}</text>
    </box>
  ))
  return { root: tree.root, setValue, dispose: tree.dispose }
}
