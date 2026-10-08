import assert from "node:assert/strict"
import { test } from "node:test"
import type { PageEntry } from "../plugin/page-store.ts"
import {
  DEFAULT_SUMMARY_TOKEN_BUDGET,
  SUMMARY_LINE_KIND,
  SUMMARY_LINE_SCHEMA_VERSION,
  SUMMARY_OVERLONG_TOLERANCE,
  SUMMARY_QUEUE_DEPTH_CAP,
  SUMMARY_READBACK_TIMEOUT_MS,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  createSummaryCompressor,
  lastAssistantTextOf,
  summaryPageKeyOf,
  truncateToBudget,
  type SummaryClient,
  type SummaryPromptOutcome,
  type SummaryReadbackRow,
  type SummaryStoreLine,
} from "../plugin/summaries.ts"

const ELLIPSIS = "\u2026"
const TEST_SESSION_KEY = "ses_fixture_1"

const pageOf = (overrides: Partial<PageEntry> = {}): PageEntry => ({
  output: "the verbatim evicted tool output",
  tool: "bash",
  subject: "src/app.ts",
  msgIndex: 12,
  partIndex: 3,
  ...overrides,
})

const assistantRow = (text: string, modelID = "test-model", providerID = "test-provider"): SummaryReadbackRow => ({
  info: { role: "assistant", modelID, providerID },
  parts: [{ type: "text", text }],
})

const userRow = (): SummaryReadbackRow => ({ info: { role: "user" }, parts: [{ type: "text", text: "summarize" }] })

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }

const deferred = <T,>(): Deferred<T> => {
  const holders = { resolve: (_: T) => {}, reject: (_: unknown) => {} }
  const promise = new Promise<T>((resolve, reject) => {
    holders.resolve = resolve
    holders.reject = reject
  })
  return { promise, ...holders }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

// The fake client records every lifecycle call in order and can be told,
// per prompt index, to defer (hang), to resolve a result-error outcome, or
// to throw; readback rows come from a per-call script.
const createFakeClient = (config: {
  promptScript?: (index: number) => Promise<SummaryPromptOutcome>
  readScript?: (index: number) => Promise<SummaryReadbackRow[]>
  createError?: Error
} = {}) => {
  const calls: string[] = []
  const created: string[] = []
  const deleted: string[] = []
  const prompted: string[] = []
  let createCount = 0
  let promptCount = 0
  let readCount = 0
  const client: SummaryClient = {
    createSession: async (_title: string) => {
      calls.push("create")
      if (config.createError !== undefined) throw config.createError
      createCount += 1
      const id = `side-${createCount}`
      created.push(id)
      return id
    },
    disableTools: async (sessionId: string) => {
      calls.push(`tools-off:${sessionId}`)
    },
    sendPrompt: async (sessionId: string, _prompt: string) => {
      calls.push(`prompt:${sessionId}`)
      prompted.push(sessionId)
      const index = promptCount
      promptCount += 1
      if (config.promptScript !== undefined) return config.promptScript(index)
      return { ok: true }
    },
    readMessages: async (sessionId: string) => {
      calls.push(`read:${sessionId}`)
      const index = readCount
      readCount += 1
      if (config.readScript !== undefined) return config.readScript(index)
      return [userRow(), assistantRow("1. one fact from the output")]
    },
    deleteSession: async (sessionId: string) => {
      calls.push(`delete:${sessionId}`)
      deleted.push(sessionId)
    },
  }
  return { client, calls, created, deleted, prompted }
}

const collectLines = (): { sink: (line: SummaryStoreLine) => Promise<void>; lines: SummaryStoreLine[] } => {
  const lines: SummaryStoreLine[] = []
  return { sink: async (line) => { lines.push(line) }, lines }
}

test("the module constants hold the plan's defaults", () => {
  assert.equal(DEFAULT_SUMMARY_TOKEN_BUDGET, 256)
  assert.equal(SUMMARY_READBACK_TIMEOUT_MS, 120000)
  assert.equal(SUMMARY_LINE_SCHEMA_VERSION, 2)
  assert.equal(SUMMARY_LINE_KIND, "summary")
  assert.equal(SUMMARY_OVERLONG_TOLERANCE, 8)
  assert.equal(SUMMARY_QUEUE_DEPTH_CAP, 32)
})

test("buildSummarySystemPrompt states the compressor identity, the numbered-facts contract, and the budget clause", () => {
  const prompt = buildSummarySystemPrompt(256)
  assert.match(prompt, /evicted tool output/)
  assert.match(prompt, /numbered/)
  assert.match(prompt, /no preamble/i)
  assert.match(prompt, /no closing/i)
  assert.match(prompt, /256/)
})

test("buildSummaryUserPrompt carries the tool name, the subject, the message index, and the verbatim evicted output", () => {
  const page = pageOf({ tool: "read", subject: "src/dep.ts", msgIndex: 7, output: "verbatim bytes here" })
  const prompt = buildSummaryUserPrompt(page)
  assert.match(prompt, /read/)
  assert.match(prompt, /src\/dep\.ts/)
  assert.match(prompt, /\b7\b/)
  assert.ok(prompt.includes("verbatim bytes here"))
})

test("truncateToBudget returns text at or under the limit unchanged", () => {
  const text = "x".repeat(8)
  assert.equal(truncateToBudget(text, 4, 2), text)
  assert.equal(truncateToBudget("", 4, 2), "")
})

test("truncateToBudget truncates beyond-limit text to exactly budget x charsPerToken characters terminated by the ellipsis", () => {
  const text = "y".repeat(20)
  const truncated = truncateToBudget(text, 4, 2)
  assert.equal(truncated.length, 8)
  assert.ok(truncated.endsWith(ELLIPSIS))
  assert.ok(truncated.startsWith("yyyyyyy"))
})

test("truncateToBudget treats the default chars per token as four", () => {
  const atLimit = "z".repeat(256 * 4)
  const overLimit = `${atLimit}tail`
  assert.equal(truncateToBudget(atLimit, 256), atLimit)
  assert.equal(truncateToBudget(overLimit, 256).length, 256 * 4)
})

test("summaryPageKeyOf mirrors the page-store key over the pageKeyOf fields, with the stashSlot suffix only when defined", () => {
  assert.equal(summaryPageKeyOf("bash", "src/app.ts", 12, 3), "bash:src/app.ts:12:3")
  assert.equal(summaryPageKeyOf("bash", "src/app.ts", 12, 3, 5), "bash:src/app.ts:12:3:5")
})

test("lastAssistantTextOf returns the last assistant row's text and empty when no assistant row exists", () => {
  const rows = [userRow(), assistantRow("first"), userRow(), assistantRow("second reply")]
  assert.equal(lastAssistantTextOf(rows), "second reply")
  assert.equal(lastAssistantTextOf([userRow()]), "")
  assert.equal(lastAssistantTextOf([]), "")
})

test("a settled side call persists one v2 summary line, records the in-memory summary, and counts written", async () => {
  const fake = createFakeClient()
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf() })
  await compressor.settled()
  assert.equal(lines.length, 1)
  const line = lines[0]
  assert.equal(line.schemaVersion, 2)
  assert.equal(line.kind, "summary")
  assert.equal(line.session, TEST_SESSION_KEY)
  assert.equal(line.tool, "bash")
  assert.equal(line.subject, "src/app.ts")
  assert.equal(line.msgIndex, 12)
  assert.equal(line.partIndex, 3)
  assert.equal(line.stashSlot, undefined)
  assert.equal(typeof line.ts, "string")
  assert.equal(new Date(line.ts).toISOString(), line.ts)
  assert.equal(line.summary, "1. one fact from the output")
  assert.equal(line.summaryModel, "test-provider/test-model")
  assert.equal(line.summaryTokens, Math.ceil(line.summary.length / 4))
  const record = compressor.summaryFor("bash", "src/app.ts", 12, 3)
  assert.ok(record !== undefined)
  assert.equal(record.summary, line.summary)
  assert.equal(record.summaryModel, line.summaryModel)
  assert.equal(record.summaryTokens, line.summaryTokens)
  const counters = compressor.counters()
  assert.equal(counters.queued, 1)
  assert.equal(counters.written, 1)
  assert.equal(counters.failures, 0)
})

test("the side-call lifecycle runs create, tools-off, prompt, readback, delete in order and deletes on settle", async () => {
  const fake = createFakeClient()
  const { sink } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf() })
  await compressor.settled()
  assert.deepEqual(fake.calls, [
    "create",
    `tools-off:${fake.created[0]}`,
    `prompt:${fake.created[0]}`,
    `read:${fake.created[0]}`,
    `delete:${fake.created[0]}`,
  ])
  assert.deepEqual(fake.deleted, [fake.created[0]])
})

test("a passing readback over the truncation limit is truncated before the sink line and its token estimate", async () => {
  const withinTolerance = "f".repeat(256 * 4 * 2)
  const fake = createFakeClient({ readScript: async () => [userRow(), assistantRow(withinTolerance)] })
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink, budgetTokens: 256, charsPerToken: 4 })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf() })
  await compressor.settled()
  assert.equal(lines.length, 1)
  assert.equal(lines[0].summary.length, 256 * 4)
  assert.ok(lines[0].summary.endsWith(ELLIPSIS))
  assert.equal(lines[0].summaryTokens, Math.ceil((256 * 4) / 4))
})

test("the summary map serves the exact pageKeyOf fields and misses other pages", async () => {
  const fake = createFakeClient()
  const { sink } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ stashSlot: 5 }) })
  await compressor.settled()
  assert.ok(compressor.summaryFor("bash", "src/app.ts", 12, 3, 5) !== undefined)
  assert.equal(compressor.summaryFor("bash", "src/app.ts", 12, 3), undefined)
  assert.equal(compressor.summaryFor("bash", "src/app.ts", 12, 4, 5), undefined)
  assert.equal(compressor.summaryFor("read", "src/app.ts", 12, 3, 5), undefined)
})

test("a session-error prompt outcome fails the page once, deletes the side session, and never lands a store line", async () => {
  const fake = createFakeClient({ promptScript: async () => ({ ok: false, error: "prompt quota exhausted" }) })
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf() })
  await compressor.settled()
  assert.equal(lines.length, 0)
  assert.equal(compressor.summaryFor("bash", "src/app.ts", 12, 3), undefined)
  assert.deepEqual(fake.deleted, fake.created)
  assert.equal(fake.deleted.length, 1)
  const counters = compressor.counters()
  assert.equal(counters.queued, 1)
  assert.equal(counters.written, 0)
  assert.equal(counters.failures, 1)
  assert.equal(counters.lastFailureKind, "session-error")
  assert.match(counters.lastError ?? "", /session-error/)
  assert.match(counters.lastError ?? "", /quota/)
})

test("a thrown client exception fails the page, deletes the side session, and never lands a store line", async () => {
  const fake = createFakeClient({ promptScript: async () => { throw new Error("transport down") } })
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf() })
  await compressor.settled()
  assert.equal(lines.length, 0)
  assert.deepEqual(fake.deleted, fake.created)
  assert.equal(compressor.counters().failures, 1)
  assert.equal(compressor.counters().lastFailureKind, "exception")
})

test("a readback timeout fails the page, deletes the side session, a late zombie prompt cannot land a store line, and the queue keeps draining", async () => {
  const firstPrompt = deferred<SummaryPromptOutcome>()
  const fake = createFakeClient({ promptScript: (index) => (index === 0 ? firstPrompt.promise : Promise.resolve({ ok: true })) })
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink, readbackTimeoutMs: 20 })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ msgIndex: 1 }) })
  await compressor.settled()
  assert.equal(lines.length, 0)
  assert.equal(compressor.counters().lastFailureKind, "readback-timeout")
  assert.deepEqual(fake.deleted, fake.created)
  firstPrompt.resolve({ ok: true })
  await flush()
  await flush()
  assert.equal(lines.length, 0)
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ msgIndex: 2 }) })
  await compressor.settled()
  assert.equal(lines.length, 1)
  assert.equal(compressor.counters().written, 1)
  assert.equal(compressor.counters().failures, 1)
})

test("an empty readback retries once and a second empty readback fails without ever landing a store line", async () => {
  const fake = createFakeClient({ readScript: async () => [userRow()] })
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf() })
  await compressor.settled()
  assert.equal(fake.prompted.length, 2)
  assert.equal(lines.length, 0)
  assert.equal(compressor.summaryFor("bash", "src/app.ts", 12, 3), undefined)
  assert.deepEqual(fake.deleted, fake.created)
  const counters = compressor.counters()
  assert.equal(counters.written, 0)
  assert.equal(counters.failures, 2)
  assert.equal(counters.lastFailureKind, "malformed")
})

test("a malformed first readback that passes on the retry lands exactly one summary line", async () => {
  const fake = createFakeClient({
    readScript: async (index) => (index === 0 ? [userRow()] : [userRow(), assistantRow("retried summary")]),
  })
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf() })
  await compressor.settled()
  assert.equal(fake.prompted.length, 2)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].summary, "retried summary")
  assert.ok(compressor.summaryFor("bash", "src/app.ts", 12, 3) !== undefined)
  const counters = compressor.counters()
  assert.equal(counters.written, 1)
  assert.equal(counters.failures, 1)
})

test("an overlong readback beyond the tolerance retries once and two overlong readbacks never land a store line", async () => {
  const overlong = "g".repeat(256 * 4 * SUMMARY_OVERLONG_TOLERANCE + 1)
  const fake = createFakeClient({ readScript: async () => [userRow(), assistantRow(overlong)] })
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf() })
  await compressor.settled()
  assert.equal(fake.prompted.length, 2)
  assert.equal(lines.length, 0)
  assert.deepEqual(fake.deleted, fake.created)
  const counters = compressor.counters()
  assert.equal(counters.failures, 2)
  assert.equal(counters.lastFailureKind, "malformed")
})

test("the drain is serial single-flight: the second page's side call starts only after the first page's completes", async () => {
  const firstPrompt = deferred<SummaryPromptOutcome>()
  const fake = createFakeClient({ promptScript: (index) => (index === 0 ? firstPrompt.promise : Promise.resolve({ ok: true })) })
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ msgIndex: 1 }) })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ msgIndex: 2 }) })
  await flush()
  assert.equal(fake.created.length, 1)
  firstPrompt.resolve({ ok: true })
  await compressor.settled()
  assert.equal(fake.created.length, 2)
  assert.equal(lines.length, 2)
  const firstDone = fake.calls.indexOf(`delete:${fake.created[0]}`)
  const secondStart = fake.calls.indexOf("create", 1)
  assert.ok(secondStart > firstDone)
})

test("enqueue beyond the depth cap drops the oldest queued page with a queue-depth failure and the survivors still drain", async () => {
  const firstPrompt = deferred<SummaryPromptOutcome>()
  const fake = createFakeClient({ promptScript: (index) => (index === 0 ? firstPrompt.promise : Promise.resolve({ ok: true })) })
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink, queueDepthCap: 2 })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ msgIndex: 1 }) })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ msgIndex: 2 }) })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ msgIndex: 3 }) })
  assert.equal(compressor.counters().failures, 1)
  assert.equal(compressor.counters().lastFailureKind, "queue-depth")
  firstPrompt.resolve({ ok: true })
  await compressor.settled()
  assert.equal(fake.created.length, 2)
  assert.equal(lines.length, 2)
  const served = lines.map((line) => line.msgIndex).sort((a, b) => a - b)
  assert.deepEqual(served, [1, 3])
  const counters = compressor.counters()
  assert.equal(counters.queued, 3)
  assert.equal(counters.written, 2)
  assert.equal(counters.failures, 1)
})

test("a create failure counts one exception and never deletes a session", async () => {
  const fake = createFakeClient({ createError: new Error("session create refused") })
  const { sink, lines } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf() })
  await compressor.settled()
  assert.equal(fake.deleted.length, 0)
  assert.equal(lines.length, 0)
  const counters = compressor.counters()
  assert.equal(counters.failures, 1)
  assert.equal(counters.lastFailureKind, "exception")
})

test("a failing sink write counts an exception and records no in-memory summary", async () => {
  const fake = createFakeClient()
  const compressor = createSummaryCompressor({
    client: fake.client,
    sink: async () => { throw new Error("store write refused") },
  })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf() })
  await compressor.settled()
  assert.deepEqual(fake.deleted, fake.created)
  assert.equal(compressor.summaryFor("bash", "src/app.ts", 12, 3), undefined)
  const counters = compressor.counters()
  assert.equal(counters.written, 0)
  assert.equal(counters.failures, 1)
  assert.equal(counters.lastFailureKind, "exception")
})

test("the in-memory summary map trims to its bound oldest-first", async () => {
  const fake = createFakeClient()
  const { sink } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink, mapLimit: 2 })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ msgIndex: 1 }) })
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ msgIndex: 2 }) })
  await compressor.settled()
  compressor.enqueue({ sessionKey: TEST_SESSION_KEY, page: pageOf({ msgIndex: 3 }) })
  await compressor.settled()
  assert.equal(compressor.summaryFor("bash", "src/app.ts", 1, 3), undefined)
  assert.ok(compressor.summaryFor("bash", "src/app.ts", 2, 3) !== undefined)
  assert.ok(compressor.summaryFor("bash", "src/app.ts", 3, 3) !== undefined)
})

test("settled resolves immediately when nothing was ever queued", async () => {
  const fake = createFakeClient()
  const { sink } = collectLines()
  const compressor = createSummaryCompressor({ client: fake.client, sink })
  await compressor.settled()
  assert.equal(compressor.counters().queued, 0)
})
