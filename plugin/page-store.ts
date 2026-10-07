import { appendFile, readFile } from "node:fs/promises"
import type { ResolvedOptions } from "./options.ts"
import { touchMapEntry, trimMapToBound } from "./session-maps.ts"
import { isRecord, logRotationIsDue, METRICS_ROTATION_DISABLED_MAX_BYTES, rotateMetricsLogPastCap } from "./persistence.ts"
import type { MetricsStore } from "./state.ts"
import { withSessionMetricsEntry } from "./state.ts"

// The page-store line contract's own version, stamped on every new line so
// mixed-version stores classify line by line: a legacy unstamped line reads
// as this version (v1 is the unstamped shape plus the field), a strictly
// newer version is refused rather than interpreted, and refusal halts this
// process's appends and rotation so it cannot bury a newer build's pages.
export const PAGE_STORE_SCHEMA_VERSION = 1

export type PageEntry = {
  output: string
  tool: string
  subject: string
  msgIndex: number
  partIndex: number
  attachments?: unknown[]
  stashSlot?: number
}

export type SessionPageStore = Map<string, PageEntry>

// The instance-level downgrade-refusal fact, the PruneThrottle pattern: one
// flag per plugin process, set the first time any walk of the store (the
// recall walk or the writer's pre-rename walk) classifies a line whose
// schema version is newer than this build's, and never cleared, so the
// process stops managing the store for its remaining lifetime.
export type PageStoreGuard = { newerSchemaObserved: boolean }

// One parsed store line's relation to this build's schema version: absent
// or equal admits the line under the current shape, strictly greater is a
// newer writer's line this build must never interpret, and anything else is
// corruption the existing invalid-line skip covers.
type PageStoreSchemaVerdict =
  | { kind: "admissible" }
  | { kind: "invalid" }
  | { kind: "newer"; observed: number }

export type PageStoreBySession = Map<string, SessionPageStore>

const pageKeyOf = (tool: string, subject: string, msgIndex: number, partIndex: number, stashSlot?: number): string =>
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

const pageStoreSchemaVerdictOf = (parsed: unknown): PageStoreSchemaVerdict => {
  const schemaVersion = isRecord(parsed) ? parsed["schemaVersion"] : undefined
  if (schemaVersion === undefined) return { kind: "admissible" }
  if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) return { kind: "invalid" }
  if (schemaVersion > PAGE_STORE_SCHEMA_VERSION) return { kind: "newer", observed: schemaVersion }
  if (schemaVersion === PAGE_STORE_SCHEMA_VERSION) return { kind: "admissible" }
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
// bury them.
export const pageStoreMatchesFor = async (
  options: ResolvedOptions,
  subject: string,
  guard: PageStoreGuard,
  metrics: MetricsStore,
  sessionKey: string,
): Promise<PageEntry[]> => {
  if (options.pageStore === false) return []
  const matches: PageEntry[] = []
  await pageStoreParsedLines(options, (parsed) => {
    const verdict = pageStoreSchemaVerdictOf(parsed)
    observePageStoreSchemaVerdict(verdict, guard, metrics, sessionKey, options.metricsSessions)
    if (verdict.kind !== "admissible") return
    const entry = pageStoreLineOf(parsed)
    if (entry !== undefined && entry.subject === subject) matches.push(entry)
  })
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
  if (options.pageStore === false || entries.length === 0) return
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
  // One clock read per run: the lines a single eviction produced share one
  // timestamp instead of drifting across the walk.
  const ts = new Date(options.now()).toISOString()
  try {
    const pageStoreJsonLine = `${entries
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
      .join("\n")}\n`
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
