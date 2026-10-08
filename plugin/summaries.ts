import type { PageEntry } from "./page-store.ts"
import { rememberSessionValue } from "./session-maps.ts"

// The compressor module: one side-session model call per evicted page,
// mock-bounded behind the SummaryClient interface so the unit suite fakes
// the host. This module owns the side-call lifecycle only: prompt build,
// budget truncation, readback validation with the malformed-success guard,
// failure classification, the serial queue with its depth cap, and the
// per-instance in-memory summary map. It never touches the transform, the
// page store, or any host type; persistence and recall serving ride the
// sink callback and the page-store v2 line kind in their own slices.

export const DEFAULT_SUMMARY_TOKEN_BUDGET = 256

// A failure-path constant, generous against the spike's 5.7-22.9s prompt
// range while bounding zombie side sessions.
export const SUMMARY_READBACK_TIMEOUT_MS = 120000

// The v2 summary line kind this module builds; the page-store slice stamps
// the same discriminator when the sink lands the line.
export const SUMMARY_LINE_SCHEMA_VERSION = 2
export const SUMMARY_LINE_KIND = "summary"

// The malformed-success guard's overlong bound: readback text beyond
// tolerance x budget x charsPerToken characters is a model compliance
// failure, not a summary to persist.
export const SUMMARY_OVERLONG_TOLERANCE = 8

// Bounds the queue's memory, not its latency: the serial drain's k-th side
// call cannot start before the (k-1)-th completes, so a burst's last
// summary lands after roughly k prompt latencies.
export const SUMMARY_QUEUE_DEPTH_CAP = 32

export const DEFAULT_SUMMARY_CHARS_PER_TOKEN = 4

// The in-memory summary map's default insertion-order bound.
export const DEFAULT_SUMMARY_MAP_LIMIT = 256

// One initial prompt plus the malformed guard's single bounded retry.
export const SUMMARY_READBACK_ATTEMPTS = 2

export const SUMMARY_SESSION_TITLE = "context-manager: summarize evicted output"

const ELLIPSIS = "\u2026"
const SUMMARY_UNKNOWN_MODEL = "unknown"

export type SummaryPromptOutcome = { ok: true } | { ok: false; error: string }

// The readback rows mirror the host's message list loosely: this module
// only reads role, model id fields, and text parts, so the shape types
// exactly those and leaves the rest to the host.
export type SummaryReadbackRow = {
  info: { role: string; modelID?: string; providerID?: string }
  parts: Array<{ type: string; text?: string }>
}

// The narrow host seam (create session, set tools-off, prompt, readback,
// delete) the LRU-60 spike validated; the entry builds the real client
// behind this interface, the tests fake it.
export type SummaryClient = {
  createSession: (title: string) => Promise<string>
  disableTools: (sessionId: string) => Promise<void>
  sendPrompt: (sessionId: string, prompt: string) => Promise<SummaryPromptOutcome>
  readMessages: (sessionId: string) => Promise<SummaryReadbackRow[]>
  deleteSession: (sessionId: string) => Promise<void>
}

// The v2 summary store line, keyed by the same pageKeyOf fields as the
// page line it summarizes; the sink's writer (page-store slice) lands it
// through the store's rotation and refusal machinery.
export type SummaryStoreLine = {
  ts: string
  schemaVersion: typeof SUMMARY_LINE_SCHEMA_VERSION
  session: string
  kind: typeof SUMMARY_LINE_KIND
  tool: string
  subject: string
  msgIndex: number
  partIndex: number
  stashSlot?: number
  summary: string
  summaryModel: string
  summaryTokens: number
}

export type SummaryRecord = {
  summary: string
  summaryModel: string
  summaryTokens: number
}

export type SummaryFailureKind = "session-error" | "exception" | "readback-timeout" | "malformed" | "queue-depth"

export type SummaryCounters = {
  queued: number
  written: number
  failures: number
  lastFailureKind: SummaryFailureKind | undefined
  lastError: string | undefined
}

export type SummaryQueueItem = { sessionKey: string; page: PageEntry }

export type SummaryCompressorOptions = {
  client: SummaryClient
  sink: (line: SummaryStoreLine) => Promise<void>
  budgetTokens?: number
  charsPerToken?: number
  readbackTimeoutMs?: number
  queueDepthCap?: number
  mapLimit?: number
}

export type SummaryCompressor = {
  enqueue: (item: SummaryQueueItem) => void
  settled: () => Promise<void>
  summaryFor: (
    tool: string,
    subject: string,
    msgIndex: number,
    partIndex: number,
    stashSlot?: number,
  ) => SummaryRecord | undefined
  counters: () => SummaryCounters
}

// The fixed system prompt: identity, the numbered chronological facts
// contract, and the budget clause the hard truncation backs up.
export const buildSummarySystemPrompt = (budgetTokens: number): string =>
  [
    "You compress an evicted tool output for a coding agent's later recall.",
    "Write a numbered, chronological list of the distinct facts a developer would need from the output.",
    "No preamble. No closing remarks.",
    `Keep the summary within ${budgetTokens} tokens; shorter is better.`,
  ].join(" ")

// The per-entry user prompt: tool, subject, message index, and the
// verbatim evicted output.
export const buildSummaryUserPrompt = (page: PageEntry): string =>
  [
    `Tool: ${page.tool}`,
    `Subject: ${page.subject}`,
    `Message index: ${page.msgIndex}`,
    "",
    "Summarize this evicted tool output:",
    page.output,
  ].join("\n")

// The budget's hard half: beyond-limit text is cut to exactly
// budgetTokens x charsPerToken characters, ellipsis-terminated, so the
// invariant holds regardless of model compliance.
export const truncateToBudget = (text: string, budgetTokens: number, charsPerToken: number = DEFAULT_SUMMARY_CHARS_PER_TOKEN): string => {
  const limit = budgetTokens * charsPerToken
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}${ELLIPSIS}`
}

// page-store's pageKeyOf is module-private, so the summary map carries this
// deliberate twin; the two must stay field-for-field identical or the map
// and the store disagree on what one page is.
export const summaryPageKeyOf = (tool: string, subject: string, msgIndex: number, partIndex: number, stashSlot?: number): string =>
  `${tool}:${subject}:${msgIndex}:${partIndex}${stashSlot === undefined ? "" : `:${stashSlot}`}`

const lastAssistantRowOf = (rows: SummaryReadbackRow[]): SummaryReadbackRow | undefined => {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row !== undefined && row.info.role === "assistant") return row
  }
  return undefined
}

const textOfRow = (row: SummaryReadbackRow): string => {
  const texts: string[] = []
  for (const part of row.parts) {
    if (part.type === "text" && typeof part.text === "string") texts.push(part.text)
  }
  return texts.join("\n")
}

// The last assistant row's text: the side session's answer; empty when the
// readback carried no assistant row, which the malformed guard drops.
export const lastAssistantTextOf = (rows: SummaryReadbackRow[]): string => {
  const row = lastAssistantRowOf(rows)
  return row === undefined ? "" : textOfRow(row)
}

const summaryModelOf = (row: SummaryReadbackRow | undefined): string => {
  if (row === undefined) return SUMMARY_UNKNOWN_MODEL
  const providerID = typeof row.info.providerID === "string" ? row.info.providerID : SUMMARY_UNKNOWN_MODEL
  const modelID = typeof row.info.modelID === "string" ? row.info.modelID : SUMMARY_UNKNOWN_MODEL
  return `${providerID}/${modelID}`
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

type SettledOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown }

// Wrap a side-session call so neither settlement path can surface as an
// unhandled rejection once the race has moved on.
const settleQuietly = <T>(promise: Promise<T>): Promise<SettledOutcome<T>> =>
  promise.then(
    (value): SettledOutcome<T> => ({ ok: true, value }),
    (error): SettledOutcome<T> => ({ ok: false, error }),
  )

type TimedOutcome<T> = { kind: "in-time"; outcome: SettledOutcome<T> } | { kind: "expired" }

// Race one side-session call against the readback deadline: a loss resolves
// "expired" while the losing call's eventual settlement is absorbed by
// settleQuietly's handlers, so a late zombie answer can neither reject
// unobserved nor resume the abandoned attempt.
const withReadbackTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<TimedOutcome<T>> => {
  let clearDeadline = (): void => {}
  const expired = new Promise<TimedOutcome<T>>((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "expired" }), timeoutMs)
    clearDeadline = (): void => clearTimeout(timer)
  })
  return Promise.race([
    settleQuietly(promise).then((outcome): TimedOutcome<T> => ({ kind: "in-time", outcome })),
    expired,
  ]).finally(clearDeadline)
}

// The compressor factory: closures over the queue, the counters, and the
// summary map; every client touch sits inside the failure taxonomy so the
// fire-and-forget chain never rejects.
export const createSummaryCompressor = (options: SummaryCompressorOptions): SummaryCompressor => {
  const { client, sink } = options
  const budgetTokens = options.budgetTokens ?? DEFAULT_SUMMARY_TOKEN_BUDGET
  const charsPerToken = options.charsPerToken ?? DEFAULT_SUMMARY_CHARS_PER_TOKEN
  const readbackTimeoutMs = options.readbackTimeoutMs ?? SUMMARY_READBACK_TIMEOUT_MS
  const queueDepthCap = options.queueDepthCap ?? SUMMARY_QUEUE_DEPTH_CAP
  const mapLimit = options.mapLimit ?? DEFAULT_SUMMARY_MAP_LIMIT

  const summaries = new Map<string, SummaryRecord>()
  const queue: SummaryQueueItem[] = []
  let queued = 0
  let written = 0
  let failures = 0
  let lastFailureKind: SummaryFailureKind | undefined
  let lastError: string | undefined
  let drainPromise: Promise<void> | undefined

  const recordFailure = (kind: SummaryFailureKind, detail: string): void => {
    failures += 1
    lastFailureKind = kind
    lastError = `${kind}: ${detail}`
  }

  const buildStoreLine = (item: SummaryQueueItem, summary: string, summaryModel: string): SummaryStoreLine => ({
    ts: new Date().toISOString(),
    schemaVersion: SUMMARY_LINE_SCHEMA_VERSION,
    session: item.sessionKey,
    kind: SUMMARY_LINE_KIND,
    tool: item.page.tool,
    subject: item.page.subject,
    msgIndex: item.page.msgIndex,
    partIndex: item.page.partIndex,
    ...(item.page.stashSlot === undefined ? {} : { stashSlot: item.page.stashSlot }),
    summary,
    summaryModel,
    summaryTokens: Math.ceil(summary.length / charsPerToken),
  })

  // Every client touch raced against the readback deadline, classified:
  // undefined records the readback-timeout or exception failure (the phase
  // name riding the message), the settled outcome carries the value the
  // caller validates further. A host call that never settles therefore
  // classifies instead of wedging the serial drain.
  const settleInTime = async <T>(call: Promise<T>, phase: string): Promise<SettledOutcome<T> | undefined> => {
    const timed = await withReadbackTimeout(call, readbackTimeoutMs)
    if (timed.kind === "expired") {
      recordFailure("readback-timeout", `the side-session ${phase} did not settle within ${readbackTimeoutMs}ms`)
      return undefined
    }
    if (!timed.outcome.ok) {
      recordFailure("exception", `the side-session ${phase} failed: ${messageOf(timed.outcome.error)}`)
      return undefined
    }
    return timed.outcome
  }

  // One prompt, one classified readback: session-error on the outcome's
  // error verdict, malformed on an empty or overlong readback text.
  const attemptOnce = async (sessionId: string, userPrompt: string, item: SummaryQueueItem): Promise<"written" | "failed" | "malformed"> => {
    try {
      const promptOutcome = await settleInTime(client.sendPrompt(sessionId, userPrompt), "prompt")
      if (promptOutcome === undefined) return "failed"
      if (!promptOutcome.value.ok) {
        recordFailure("session-error", promptOutcome.value.error)
        return "failed"
      }
      const readOutcome = await settleInTime(client.readMessages(sessionId), "readback")
      if (readOutcome === undefined) return "failed"
      const text = lastAssistantTextOf(readOutcome.value)
      if (text.length === 0) {
        recordFailure("malformed", "the side-session readback carried no assistant text")
        return "malformed"
      }
      const toleranceLimit = budgetTokens * charsPerToken * SUMMARY_OVERLONG_TOLERANCE
      if (text.length > toleranceLimit) {
        recordFailure("malformed", `the side-session readback of ${text.length} characters exceeds the tolerance bound of ${toleranceLimit}`)
        return "malformed"
      }
      const summary = truncateToBudget(text, budgetTokens, charsPerToken)
      const summaryModel = summaryModelOf(lastAssistantRowOf(readOutcome.value))
      const line = buildStoreLine(item, summary, summaryModel)
      await sink(line)
      rememberSessionValue(
        summaries,
        summaryPageKeyOf(item.page.tool, item.page.subject, item.page.msgIndex, item.page.partIndex, item.page.stashSlot),
        { summary, summaryModel, summaryTokens: line.summaryTokens },
        mapLimit,
      )
      written += 1
      return "written"
    } catch (error) {
      recordFailure("exception", messageOf(error))
      return "failed"
    }
  }

  // The initial prompt plus the malformed guard's single bounded retry on
  // the same side session; every other verdict ends the item.
  const runAttempts = async (sessionId: string, item: SummaryQueueItem): Promise<void> => {
    const userPrompt = buildSummaryUserPrompt(item.page)
    for (let attempt = 1; attempt <= SUMMARY_READBACK_ATTEMPTS; attempt += 1) {
      const verdict = await attemptOnce(sessionId, userPrompt, item)
      if (verdict !== "malformed") return
    }
  }

  // The delete path runs on both settle and failure: settleInTime records
  // a thrown or hung delete (exception or phase-named timeout), so the
  // fire-and-forget chain never escapes and the drain never wedges here.
  const deleteQuietly = async (sessionId: string): Promise<void> => {
    await settleInTime(client.deleteSession(sessionId), "delete")
  }

  // Create and tools-off ride the same deadline as every other touch: a
  // hung or thrown call classifies and ends the item (a session that was
  // created is still deleted), so the serial drain always advances.
  const processItem = async (item: SummaryQueueItem): Promise<void> => {
    const created = await settleInTime(client.createSession(SUMMARY_SESSION_TITLE), "create")
    if (created === undefined) return
    const sessionId = created.value
    const disabled = await settleInTime(client.disableTools(sessionId), "tools-off")
    if (disabled === undefined) {
      await deleteQuietly(sessionId)
      return
    }
    try {
      await runAttempts(sessionId, item)
    } finally {
      await deleteQuietly(sessionId)
    }
  }

  // Serial single-flight: the next side call starts only after the
  // previous one's delete, so the queue's latency is a distribution.
  const drainLoop = async (): Promise<void> => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item === undefined) break
      await processItem(item)
    }
  }

  // The depth cap bounds outstanding work, in-flight plus queued: an
  // enqueue that would exceed it drops the oldest queued page synchronously
  // and counts the drop as a queue-depth failure.
  const outstandingCount = (): number => queue.length + (drainPromise === undefined ? 0 : 1)

  const dropOverflow = (): void => {
    while (outstandingCount() > queueDepthCap) {
      const dropped = queue.shift()
      if (dropped === undefined) break
      recordFailure("queue-depth", `the queue depth cap of ${queueDepthCap} is exceeded; the oldest queued page is dropped`)
    }
  }

  // Kicks the drain synchronously so the first item is dequeued before
  // enqueue returns; the reset only clears the chain it belongs to, so an
  // enqueue racing the drain's tail cannot lose its wakeup.
  const enqueue = (item: SummaryQueueItem): void => {
    queued += 1
    queue.push(item)
    dropOverflow()
    if (drainPromise !== undefined) return
    const chain = drainLoop().finally(() => {
      if (drainPromise === chain) drainPromise = undefined
    })
    drainPromise = chain
  }

  const settled = (): Promise<void> => drainPromise ?? Promise.resolve()

  const summaryFor = (
    tool: string,
    subject: string,
    msgIndex: number,
    partIndex: number,
    stashSlot?: number,
  ): SummaryRecord | undefined => summaries.get(summaryPageKeyOf(tool, subject, msgIndex, partIndex, stashSlot))

  const counters = (): SummaryCounters => ({ queued, written, failures, lastFailureKind, lastError })

  return { enqueue, settled, summaryFor, counters }
}
