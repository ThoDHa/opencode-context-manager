import { appendFile, readFile } from "node:fs/promises"
import type { ResolvedOptions } from "./options.ts"
import { touchMapEntry, trimMapToBound } from "./session-maps.ts"
import { isRecord, logRotationIsDue, METRICS_ROTATION_DISABLED_MAX_BYTES, rotateMetricsLogPastCap } from "./persistence.ts"
import type { MetricsStore } from "./state.ts"
import { withSessionMetricsEntry } from "./state.ts"

// The page-store line contract's own version, stamped on every new line so
// mixed-version stores classify line by line: a legacy unstamped line reads
// as this version, a strictly newer version is refused rather than
// interpreted, and refusal halts this process's appends and rotation so it
// cannot bury a newer build's pages. v2 adds the kind discriminator and the
// summary line kind but no new page fields, so a v1 page line's shape is
// identical to a v2 page line's.
export const PAGE_STORE_SCHEMA_VERSION = 2

// The one line kind v2 introduces; page lines carry no kind field, which
// keeps their shape identical across v1 and v2.
export const PAGE_STORE_SUMMARY_LINE_KIND = "summary"

// The first stamped version (v1 introduced the schemaVersion stamp); older
// admission below admits only plausible prior stamps.
const FIRST_STAMPED_PAGE_STORE_SCHEMA_VERSION = 1

export type PageEntry = {
  output: string
  tool: string
  subject: string
  msgIndex: number
  partIndex: number
  attachments?: unknown[]
  stashSlot?: number
}

// The summary record a v2 summary line carries beside its page-key fields,
// and the shape the plugin instance's in-memory summary map holds: keyed by
// the same pageKeyOf fields as the page, so the file store and the map
// serve one record shape.
export type PageSummaryRecord = {
  tool: string
  subject: string
  msgIndex: number
  partIndex: number
  stashSlot?: number
  summary: string
  summaryModel: string
  summaryTokens: number
}

// The reader-side consult seam for the in-memory summary map: the recall
// tool resolves a page's summary from the map first (a summary written this
// session may not be re-read from the store yet), then from the store line
// merged onto the match.
export type PageSummaryLookup = (
  tool: string,
  subject: string,
  msgIndex: number,
  partIndex: number,
  stashSlot?: number,
) => PageSummaryRecord | undefined

// A matched page joined with the newest summary line sharing its key
// fields; the summary is absent until a summary line for that exact key
// exists.
export type StoredPageMatch = PageEntry & { summary?: PageSummaryRecord }

export type SessionPageStore = Map<string, PageEntry>

// The instance-level downgrade-refusal fact, the PruneThrottle pattern: one
// flag per plugin process, set the first time any walk of the store (the
// recall walk or the writer's pre-rename walk) classifies a line whose
// schema version is newer than this build's, and never cleared, so the
// process stops managing the store for its remaining lifetime.
export type PageStoreGuard = { newerSchemaObserved: boolean }

// One parsed store line's relation to this build's schema version: absent
// or equal admits the line under the current shape, a plausible older stamp
// on a kindless (page-shaped) line is admitted deliberately since v2 added
// no new page fields, strictly greater is a newer writer's line this build
// must never interpret, and anything else is corruption the existing
// invalid-line skip covers.
type PageStoreSchemaVerdict =
  | { kind: "admissible" }
  | { kind: "invalid" }
  | { kind: "newer"; observed: number }

export type PageStoreBySession = Map<string, SessionPageStore>

export const pageKeyOf = (tool: string, subject: string, msgIndex: number, partIndex: number, stashSlot?: number): string =>
  `${tool}:${subject}:${msgIndex}:${partIndex}${stashSlot === undefined ? "" : `:${stashSlot}`}`

export const pagesForSession = (pageStores: PageStoreBySession, sessionKey: string, sessionBound: number): SessionPageStore => {
  const touched = touchMapEntry(pageStores, sessionKey)
  if (touched !== undefined) return touched
  trimMapToBound(pageStores, sessionBound)
  const created: SessionPageStore = new Map()
  pageStores.set(sessionKey, created)
  return created
}

const trimPages = (pageStore: SessionPageStore, limit: number): number => {
  let dropped = 0
  while (pageStore.size > limit) {
    const oldest = pageStore.keys().next()
    if (oldest.done === true) break
    pageStore.delete(oldest.value)
    dropped += 1
  }
  return dropped
}

export const storeEvictedPage = (pageStore: SessionPageStore, entry: PageEntry, limit: number): number => {
  pageStore.set(pageKeyOf(entry.tool, entry.subject, entry.msgIndex, entry.partIndex, entry.stashSlot), entry)
  return trimPages(pageStore, limit)
}

// The store's line shape, validated field by field: a line failing any
// required field is skipped (per-line tolerance, mirroring the log seeder's
// corrupt-line skip) rather than failing the whole read.
const pageStoreLineOf = (parsed: unknown): PageEntry | undefined => {
  if (!isRecord(parsed)) return undefined
  const output = parsed["output"]
  const tool = parsed["tool"]
  const subject = parsed["subject"]
  const msgIndex = parsed["msgIndex"]
  const partIndex = parsed["partIndex"]
  if (typeof output !== "string" || typeof tool !== "string" || typeof subject !== "string") return undefined
  if (typeof msgIndex !== "number" || typeof partIndex !== "number") return undefined
  const attachments = parsed["attachments"]
  if (attachments !== undefined && !Array.isArray(attachments)) return undefined
  const stashSlot = parsed["stashSlot"]
  if (stashSlot !== undefined && typeof stashSlot !== "number") return undefined
  return {
    output,
    tool,
    subject,
    msgIndex,
    partIndex,
    ...(stashSlot === undefined ? {} : { stashSlot }),
    ...(attachments === undefined ? {} : { attachments }),
  }
}

// The v2 summary line's payload, validated field by field with the same
// per-line tolerance as the page shape: a line failing any required field
// is skipped rather than failing the whole read. The kind check rides here
// so a kindless admissible line never parses as a summary.
const pageStoreSummaryLineOf = (parsed: unknown): PageSummaryRecord | undefined => {
  if (!isRecord(parsed) || parsed["kind"] !== PAGE_STORE_SUMMARY_LINE_KIND) return undefined
  const summary = parsed["summary"]
  const summaryModel = parsed["summaryModel"]
  const summaryTokens = parsed["summaryTokens"]
  const tool = parsed["tool"]
  const subject = parsed["subject"]
  const msgIndex = parsed["msgIndex"]
  const partIndex = parsed["partIndex"]
  if (typeof summary !== "string" || summary.length === 0) return undefined
  if (typeof summaryModel !== "string" || summaryModel.length === 0) return undefined
  if (typeof summaryTokens !== "number" || !Number.isFinite(summaryTokens)) return undefined
  if (typeof tool !== "string" || typeof subject !== "string") return undefined
  if (typeof msgIndex !== "number" || typeof partIndex !== "number") return undefined
  const stashSlot = parsed["stashSlot"]
  if (stashSlot !== undefined && typeof stashSlot !== "number") return undefined
  return {
    tool,
    subject,
    msgIndex,
    partIndex,
    ...(stashSlot === undefined ? {} : { stashSlot }),
    summary,
    summaryModel,
    summaryTokens,
  }
}

const pageStoreSchemaVerdictOf = (parsed: unknown): PageStoreSchemaVerdict => {
  const schemaVersion = isRecord(parsed) ? parsed["schemaVersion"] : undefined
  if (schemaVersion === undefined) return { kind: "admissible" }
  if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) return { kind: "invalid" }
  if (schemaVersion > PAGE_STORE_SCHEMA_VERSION) return { kind: "newer", observed: schemaVersion }
  if (schemaVersion === PAGE_STORE_SCHEMA_VERSION) return { kind: "admissible" }
  // Older-stamped PAGE lines are admitted deliberately: v2 added the kind
  // discriminator and the summary line kind but no new page fields, so a
  // v1 page line's shape is identical to a v2 page line's and refusing it
  // would destroy recall depth for every store a v1 build wrote. A
  // stamped-older line carrying any kind stays unreadable: no older build
  // wrote kinds, so the line is corruption rather than a page.
  const lineIsKindlessPageShape = isRecord(parsed) && parsed["kind"] === undefined
  if (Number.isInteger(schemaVersion) && schemaVersion >= FIRST_STAMPED_PAGE_STORE_SCHEMA_VERSION && lineIsKindlessPageShape) {
    return { kind: "admissible" }
  }
  return { kind: "invalid" }
}

const pageStoreSchemaErrorFor = (observed: number | undefined): string =>
  observed === undefined
    ? `the page store holds lines from a newer schema version than this build's ${PAGE_STORE_SCHEMA_VERSION}; appends and rotation are halted to leave the newer store untouched`
    : `the page store holds schemaVersion ${observed} lines but this build writes ${PAGE_STORE_SCHEMA_VERSION}; appends and rotation are halted to leave the newer store untouched`

const recordPageStoreSchemaError = (
  metrics: MetricsStore,
  sessionKey: string,
  sessionBound: number,
  observed: number | undefined,
): void =>
  withSessionMetricsEntry(metrics, sessionKey, sessionBound, (entry) => {
    entry.pageStoreSchemaError ??= pageStoreSchemaErrorFor(observed)
  })

// The store's line loop, shared by the recall walk (classify and match in
// one pass) and the writer's pre-rename observation walk: read and parse
// failures degrade to visiting nothing, a corrupt or unreadable store being
// a clean outcome, never a thrown error.
const pageStoreParsedLines = async (options: ResolvedOptions, visit: (parsed: unknown) => void): Promise<void> => {
  let content: string
  try {
    content = await readFile(options.pageStorePath, "utf8")
  } catch {
    return
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    visit(parsed)
  }
}

// The observation side effect both walks share: a newer-schema line sets
// the instance guard permanently and records the observing session's
// diagnostic, the message keeping the first observed version.
const observePageStoreSchemaVerdict = (
  verdict: PageStoreSchemaVerdict,
  guard: PageStoreGuard,
  metrics: MetricsStore,
  sessionKey: string,
  sessionBound: number,
): void => {
  if (verdict.kind !== "newer") return
  guard.newerSchemaObserved = true
  recordPageStoreSchemaError(metrics, sessionKey, sessionBound, verdict.observed)
}

// Cross-session pages for one subject, read fresh per miss (misses are the
// rare path) in file order, so the last matching line is the newest page.
// Any read or parse failure degrades to no pages: a corrupt or unreadable
// store is a clean miss, never a thrown tool error. The same pass classifies
// each line's schema version: newer-version lines are skipped uninterpreted
// and flip the instance guard, so this process's writer halts before it can
// bury them. v2 summary lines ride the same pass and merge onto the matched
// page whose key fields they share, the last summary line per key winning;
// a matched page without a summary serves its full original.
export const pageStoreMatchesFor = async (
  options: ResolvedOptions,
  subject: string,
  guard: PageStoreGuard,
  metrics: MetricsStore,
  sessionKey: string,
): Promise<StoredPageMatch[]> => {
  if (options.pageStore === false) return []
  const matches: StoredPageMatch[] = []
  const summariesByPageKey = new Map<string, PageSummaryRecord>()
  await pageStoreParsedLines(options, (parsed) => {
    const verdict = pageStoreSchemaVerdictOf(parsed)
    observePageStoreSchemaVerdict(verdict, guard, metrics, sessionKey, options.metricsSessions)
    if (verdict.kind !== "admissible") return
    const lineKind = isRecord(parsed) ? parsed["kind"] : undefined
    if (typeof lineKind === "string") {
      // A kind this build does not know is skipped uninterpreted rather
      // than parsed as a page; the one known kind lands in its own parser.
      if (lineKind !== PAGE_STORE_SUMMARY_LINE_KIND) return
      const summary = pageStoreSummaryLineOf(parsed)
      if (summary !== undefined) {
        summariesByPageKey.set(pageKeyOf(summary.tool, summary.subject, summary.msgIndex, summary.partIndex, summary.stashSlot), summary)
      }
      return
    }
    const entry = pageStoreLineOf(parsed)
    if (entry !== undefined && entry.subject === subject) matches.push(entry)
  })
  for (const match of matches) {
    const summary = summariesByPageKey.get(pageKeyOf(match.tool, match.subject, match.msgIndex, match.partIndex, match.stashSlot))
    if (summary !== undefined) match.summary = summary
  }
  return matches
}

// The writer's rotation-time observation walk, run immediately before the
// rotation rename so the sole burying operation can never fire unobserved:
// an instance that only evicts and never runs an observing recall still
// halts at its next rotation boundary instead of renaming a newer build's
// pages out of every reader's reach.
const pageStoreWalkObservesNewerSchema = async (
  options: ResolvedOptions,
  guard: PageStoreGuard,
  metrics: MetricsStore,
  sessionKey: string,
): Promise<boolean> => {
  let observed = false
  await pageStoreParsedLines(options, (parsed) => {
    const verdict = pageStoreSchemaVerdictOf(parsed)
    observePageStoreSchemaVerdict(verdict, guard, metrics, sessionKey, options.metricsSessions)
    if (verdict.kind === "newer") observed = true
  })
  return observed
}

// The shared store-write body for both line kinds: the gate checks, the
// downgrade refusal, one clock read per run, the rotation boundary with its
// observation walk, the single append, and the write-error diagnostic. The
// failure surface never blocks the caller: a failed write is a session
// diagnostic, never a thrown error.
const recordPageStorePayload = async (
  options: ResolvedOptions,
  metrics: MetricsStore,
  sessionKey: string,
  pageStoreGuard: PageStoreGuard,
  payloadOf: (ts: string) => string,
): Promise<void> => {
  if (options.pageStore === false) return
  if (options.pageStoreRotationMaxBytes === METRICS_ROTATION_DISABLED_MAX_BYTES) return
  // The downgrade refusal: once this instance has observed a newer-schema
  // line, both the append and the rotation halt, so this older build can
  // neither bury newer lines into the .1 generation nor mix its own older
  // writes into the newer build's store. The diagnostic lands on the
  // evicting session even when another session's recall set the guard, so
  // an evict-only session still learns why its pages stopped persisting.
  if (pageStoreGuard.newerSchemaObserved) {
    recordPageStoreSchemaError(metrics, sessionKey, options.metricsSessions, undefined)
    return
  }
  // One clock read per run: the lines a single run produced share one
  // timestamp instead of drifting across the walk.
  const ts = new Date(options.now()).toISOString()
  try {
    const pageStoreJsonLine = payloadOf(ts)
    // The schema-classification walk rides the rotation boundary only: it
    // runs exactly when a rename is about to fire, so the sole burying
    // operation can never fire unobserved while ordinary appends pay one
    // size stat instead of a full-store walk. The pending line is not yet
    // in the file, so the walk sees exactly what a rename would bury, and
    // an observation stops the run before either half fires.
    const incomingBytes = Buffer.byteLength(pageStoreJsonLine)
    if (await logRotationIsDue(options.pageStorePath, incomingBytes, options.pageStoreRotationMaxBytes)) {
      if (await pageStoreWalkObservesNewerSchema(options, pageStoreGuard, metrics, sessionKey)) return
      await rotateMetricsLogPastCap(options.pageStorePath, incomingBytes, options.pageStoreRotationMaxBytes)
    }
    await appendFile(options.pageStorePath, pageStoreJsonLine)
    const entry = touchMapEntry(metrics, sessionKey)
    if (entry !== undefined) delete entry.pageStoreWriteError
  } catch (error) {
    withSessionMetricsEntry(metrics, sessionKey, options.metricsSessions, (target) => {
      target.pageStoreWriteError = error instanceof Error ? error.message : String(error)
    })
  }
}

// The persistent half of the stash: every entry the evictor stashed this run
// becomes one JSONL line beside the metrics log, so a later session's
// recall can reload an original its own in-memory stash never held.
// Same discipline as the hygiene copy: rotation through the generic helper,
// one append per run, a failed write surfaced as pageStoreWriteError on the
// session's diagnostics without ever blocking the eviction, and both the
// feature switch and a cap of 0 disabling writes entirely.
export const recordPageStoreLines = async (
  options: ResolvedOptions,
  metrics: MetricsStore,
  sessionKey: string,
  entries: PageEntry[],
  pageStoreGuard: PageStoreGuard,
): Promise<void> => {
  if (entries.length === 0) return
  await recordPageStorePayload(options, metrics, sessionKey, pageStoreGuard, (ts) =>
    `${entries
      .map((entry) =>
        JSON.stringify({
          ts,
          schemaVersion: PAGE_STORE_SCHEMA_VERSION,
          session: sessionKey,
          tool: entry.tool,
          subject: entry.subject,
          msgIndex: entry.msgIndex,
          partIndex: entry.partIndex,
          ...(entry.stashSlot === undefined ? {} : { stashSlot: entry.stashSlot }),
          output: entry.output,
          ...(entry.attachments === undefined ? {} : { attachments: entry.attachments }),
        }),
      )
      .join("\n")}\n`,
  )
}

// The v2 summary line writer: each completed summary becomes one JSONL line
// keyed by the same pageKeyOf fields as its page, so the summary persists
// beside the page without rewriting the page's output bytes. It rides the
// identical rotation, downgrade-refusal, and diagnostic machinery as the
// page writer, and the same gates disable it entirely.
export const recordPageStoreSummaryLines = async (
  options: ResolvedOptions,
  metrics: MetricsStore,
  sessionKey: string,
  summaries: PageSummaryRecord[],
  pageStoreGuard: PageStoreGuard,
): Promise<void> => {
  if (summaries.length === 0) return
  await recordPageStorePayload(options, metrics, sessionKey, pageStoreGuard, (ts) =>
    `${summaries
      .map((record) =>
        JSON.stringify({
          ts,
          schemaVersion: PAGE_STORE_SCHEMA_VERSION,
          session: sessionKey,
          kind: PAGE_STORE_SUMMARY_LINE_KIND,
          tool: record.tool,
          subject: record.subject,
          msgIndex: record.msgIndex,
          partIndex: record.partIndex,
          ...(record.stashSlot === undefined ? {} : { stashSlot: record.stashSlot }),
          summary: record.summary,
          summaryModel: record.summaryModel,
          summaryTokens: record.summaryTokens,
        }),
      )
      .join("\n")}\n`,
  )
}
