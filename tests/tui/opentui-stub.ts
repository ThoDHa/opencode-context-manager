import { createRenderEffect, createRoot } from "solid-js"
import { createRenderer } from "solid-js/universal"

export type StubTextNode = { kind: "text"; value: string; parent: StubElementNode | null }
export type StubElementNode = {
  kind: "element"
  name: string
  props: Record<string, unknown>
  children: StubNode[]
  parent: StubElementNode | null
}
export type StubNode = StubElementNode | StubTextNode

const DEFAULT_SETTLE_TIMEOUT_MS = 2000
const DEFAULT_SETTLE_TICK_MS = 10

export type SettleOptions = { timeoutMs?: number; tickMs?: number }

const nodeOps = {
  createElement(name: string): StubElementNode {
    return { kind: "element", name, props: {}, children: [], parent: null }
  },
  createTextNode(value: string): StubTextNode {
    return { kind: "text", value, parent: null }
  },
  isTextNode(node: StubNode): node is StubTextNode {
    return node.kind === "text"
  },
  replaceText(node: StubTextNode, value: string): void {
    node.value = value
  },
  insertNode(parent: StubElementNode, node: StubNode, anchor?: StubNode | null): void {
    if (node.parent !== null) {
      const siblings = node.parent.children
      const existing = siblings.indexOf(node)
      if (existing !== -1) siblings.splice(existing, 1)
    }
    const index = anchor === undefined || anchor === null ? parent.children.length : parent.children.indexOf(anchor)
    if (index === -1) {
      parent.children.push(node)
    } else {
      parent.children.splice(index, 0, node)
    }
    node.parent = parent
  },
  removeNode(parent: StubElementNode, node: StubNode): void {
    const index = parent.children.indexOf(node)
    if (index !== -1) {
      parent.children.splice(index, 1)
      node.parent = null
    }
  },
  setProperty(node: StubElementNode, name: string, value: unknown): void {
    node.props[name] = value
  },
  getParentNode(node: StubNode): StubElementNode | null {
    return node.parent
  },
  getFirstChild(node: StubElementNode): StubNode | null {
    return node.children[0] ?? null
  },
  getNextSibling(node: StubNode): StubNode | null {
    if (node.parent === null) return null
    const index = node.parent.children.indexOf(node)
    if (index === -1) return null
    return node.parent.children[index + 1] ?? null
  },
}

const renderer = createRenderer<StubNode>(nodeOps)

export const render = renderer.render
export const insert = renderer.insert
export const spread = renderer.spread
export const createElement = renderer.createElement
export const createTextNode = renderer.createTextNode
export const insertNode = renderer.insertNode
export const setProp = renderer.setProp
export const mergeProps = renderer.mergeProps
export const effect = renderer.effect
export const memo = renderer.memo
export const createComponent = renderer.createComponent
export const use = renderer.use

export type RenderedTree = { root: StubElementNode; dispose: () => void }

// Mounts a component tree over a detached root element, returning the root
// for walking and the root-level disposer for cleanup.
export const renderTree = (code: () => unknown): RenderedTree => {
  const root = createElement("root")
  let dispose = (): void => {}
  createRoot((disposer) => {
    dispose = disposer
    insert(root, code())
  })
  return { root, dispose }
}

// Depth-first flattening of a stub tree: the node itself, then its subtree
// in child order.
export const walkTree = (node: StubNode): StubNode[] =>
  node.kind === "element" ? [node, ...node.children.flatMap(walkTree)] : [node]

// The text content of a subtree in document order.
export const nodeText = (node: StubNode): string =>
  walkTree(node)
    .filter((child): child is StubTextNode => child.kind === "text")
    .map((child) => child.value)
    .join("")

// Bounded real-timer retry until a predicate holds, for awaiting solid's
// async render chains (mock timers never cover promises). Throws with the
// last observed state when the timeout lapses.
export const settleUntil = async (
  predicate: () => boolean,
  { timeoutMs = DEFAULT_SETTLE_TIMEOUT_MS, tickMs = DEFAULT_SETTLE_TICK_MS }: SettleOptions = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`settleUntil timed out after ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, tickMs))
  }
}
