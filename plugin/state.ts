import { RAW_COUNTER_KEYS as SCHEMA_RAW_COUNTER_KEYS, TOTALS_KEYS, type DerivedCounterKey as TotalsDerivedKey, type RawCounterKey as SchemaRawCounterKey, type TotalsKey } from "./schema.ts"
import { estimateTokensFromBytes } from "./messages.ts"
import { rememberFaultForSubject, touchMapEntry, trimMapToBound } from "./session-maps.ts"
import type { ContextTokensSource, PersistedContextLimit } from "./context-limits.ts"
import type { HotSubject, Subject } from "./vocabulary.ts"
import { BASH_TOOL_NAME } from "./vocabulary.ts"

const TOUCH_SCAN_INITIAL_WATERMARK = -1
export const DEFAULT_REMEMBERED_REASONING_PARTS = 4096
const DEFAULT_REMEMBERED_DEDUP_PAIRS = 4096
// How many distinct faulted subjects one session's metrics entry remembers
// (LRU, refreshed on every increment): between the evicted-subject cap and
// the reasoning-part cap, sized so a session's reloaded outputs stay
// fault-tracked for the entry's lifetime.
export const DEFAULT_REMEMBERED_FAULT_SUBJECTS = 256

export type ToolAppearance = {
  msgIndex: number
  tool: string
  subjects: Subject[]
}

export type EvictionResult = {
  hotSubjects: HotSubject[]
  appearances: ToolAppearance[]
  estimatedTokens: number
  watermarkTokens: number | null
  deficitTokens: number | null
  evicted: EvictedEntryInfo[]
  pagesDropped: number
}

export type EvictedEntryInfo = {
  tool: string
  subject: string
  subjects: Subject[]
  bytes: number
  attachmentBytes: number
  messagesAgo: number
}

export type LastRunMetrics = { estimatedTokens: number; watermarkTokens: number | null; deficitTokens: number | null }

export type RunOutcome = {
  eviction: EvictionResult
  deduped: number
  dedupedBytesUnique: number
  dedupedUnique: number
  collapsedWindows: number
  collapsedWindowBytes: number
  purged: number
  faults: number
  reasoningExpired: ReasoningExpiry
  fenceEvicted: FenceEviction
  dryRun: DryRunResult | undefined
  advisory: AdvisoryResult | undefined
  composition: RunComposition
}

export type ReasoningExpiry = { parts: number; bytes: number; unique: number; uniqueBytes: number }

export type SessionMetrics = {
  evictions: number
  bytesReclaimed: number
  recallHits: number
  recallMisses: number
  pagesDropped: number
  deduped: number
  dedupedBytesUnique: number
  dedupedUnique: number
  collapsedWindows: number
  collapsedWindowBytes: number
  reasoningExpiredUnique: number
  reasoningBytesExpiredUnique: number
  faults: number
  fenceEvicted: number
  processedContextBytes: number
  evictedSubjects: Subject[]
  faultScanThrough: number
  // Per-entry memory for the unique-event counters: content identities of
  // reasoning parts and dedup pairs already counted. They reset when the
  // metrics store evicts and reseeds the entry, so unique counts are
  // per-entry-lifetime, not per-process; identical content counts once.
  reasoningSeenKeys: string[]
  dedupedPairKeys: string[]
  // Per-entry fault bookkeeping: the rendered primary subject of every
  // reloaded (recall hit) or re-touched (keyed post-eviction
  // appearance) evicted output, mapped to its fault count. Like the
  // seen-key lists it resets when the metrics store evicts and reseeds
  // the entry, so fault memory is per-entry-lifetime and never persisted.
  faultCounts: Map<string, number>
  // The rendered primary subjects of remembered evicted entries, pushed
  // beside evictedSubjects at the same points and trimmed at the same
  // bound: the keyed fault credit matches appearances against these
  // because the fault map's keys live in the rendered subject domain
  // recall matches on.
  evictedRenderedSubjects: string[]
  recallsLoggedThrough: number
  // Per-process bookkeeping for the metrics line coalesce gate: the moment
  // of the session's last flushed line and the budget source it carried.
  // Never persisted; a restart simply writes on its next eventful run.
  lastLineAtMs?: number
  lastLineContextLimitSource?: ContextTokensSource
  // The budget resolved at this session's previous sitting, rehydrated
  // with the counters so a restart does not flicker the budget to
  // unknown; a live chat.params capture always wins over it.
  persistedBudget?: PersistedContextLimit
  // The manual-mode dry run from this session's newest run: run-scoped
  // diagnostic state for describe, never persisted, replaced every run.
  lastDryRun?: DryRunResult
  // The newest run's declared omissions (tool evictions, expired reasoning
  // parts, evicted fenced blocks): run-scoped diagnostic state for describe
  // and the compaction footer, never persisted, replaced every run.
  lastOmissions?: LastOmissions
  // The newest run's advisory band preview: run-scoped diagnostic state
  // for describe, undefined when disarmed, when no effective watermark
  // exists, or when the estimate sits below the band start; persisted
  // only through the session checkpoint's optional advisory field.
  lastAdvisory?: AdvisoryResult
  // The newest run's retention audit (pool size and per-reason protection
  // counts over the unfiltered candidate pool): run-scoped diagnostic
  // state for describe and the panel, replaced every run; persisted only
  // through the session checkpoint's optional retention field.
  lastRetention?: RetentionBreakdown
  // The newest run's composition (toolPoolBytes, textChars,
  // reasoningInWindowBytes): run-scoped diagnostic state for describe,
  // never persisted, replaced every run.
  lastComposition?: RunComposition
  // The newest fault-isolated failure on this session's transform: set by
  // the transform boundary when the body throws, surfaced through
  // describe, never persisted, replaced by the next run's outcome.
  lastError?: LastError
  lastRun?: LastRunMetrics
  logWriteError?: string
  stateWriteError?: string
  hygieneWriteError?: string
  pageStoreWriteError?: string
  // Set when this session observed a page-store line from a newer schema
  // version, or when an eviction ran while the instance guard held: the
  // store's writes and rotation are halted and describe explains why.
  pageStoreSchemaError?: string
}

type LastError = { message: string; atMs: number }

export type MetricsStore = Map<string, SessionMetrics>

// The raw counters a session's persisted totals can seed, declared once in
// schema.ts and anchored to SessionMetrics by the exhaustiveness
// assertion below so a renamed or removed counter fails to compile here
// instead of silently missing its seed. The runtime seeder iterates this
// same list.
export const RAW_COUNTER_KEYS: readonly RawCounterKey[] = Object.freeze(SCHEMA_RAW_COUNTER_KEYS)
export type RawCounterKey = SchemaRawCounterKey

// Two-directional exhaustiveness: every number-valued SessionMetrics key
// other than the per-process cursors must appear in RawCounterKey, so a
// newly added counter fails to compile until it is added to the seeded set.
// Cursor inventory beyond the two number cursors in MetricsCursorKey: the
// optional coalesce-gate fields lastLineAtMs and lastLineContextLimitSource escape
// this check through optionality and are seeded implicitly (undefined means
// never written, so a restart writes on its next eventful run), the
// persistedBudget fallback is seeded from the record's budget fields
// (undefined when the record carries none), and the reasoningSeenKeys and
// dedupedPairKeys lists are seeded empty. A new REQUIRED numeric field must
// land in RAW_COUNTER_KEYS or MetricsCursorKey to compile; a new OPTIONAL
// one must be justified the same way.
type NumberValuedSessionMetricKey = {
  [K in keyof SessionMetrics]-?: SessionMetrics[K] extends number ? K : never
}[keyof SessionMetrics]
export type MetricsCursorKey = "faultScanThrough" | "recallsLoggedThrough"
export const METRICS_CURSOR_KEYS: readonly MetricsCursorKey[] = ["faultScanThrough", "recallsLoggedThrough"]
type UnseededMetricKeys = Exclude<Exclude<NumberValuedSessionMetricKey, MetricsCursorKey>, RawCounterKey>
type AssertEveryMetricSeeded = UnseededMetricKeys extends never ? true : never
const everyMetricIsSeeded: AssertEveryMetricSeeded = true

// The persisted totals shape, derived from the shared schema key list so a
// key added in schema.ts appears here and in the panel parser without a
// second edit.
export type CumulativeCounters = { [K in TotalsKey]: number }

export type DedupedPairBytes = { key: string; bytes: number }

// Membership test plus bounded remember shared by the unique-event counters:
// returns true the first time a key is seen, false for repeats. The list
// trims to the bound, so an event forgotten after a bound worth of newer
// keys could count once more; the default bounds dwarf real standing sets.
// The linear scan is O(events x bound) per run, capped by the bound at a
// few million short-string compares worst case, which stays well under the
// transform's existing per-run serialization cost; a Set would complicate
// the FIFO trim for no measurable win at real session sizes.
export const rememberUniqueKey = (seenKeys: string[], key: string, rememberedBound: number): boolean => {
  if (seenKeys.includes(key)) return false
  seenKeys.push(key)
  while (seenKeys.length > rememberedBound) seenKeys.shift()
  return true
}

// A pair's key covers tool and input (or mime and url for file parts), the
// same content identity the dedup pass itself keys retained duplicates by,
// so identical-input occurrences count once: a standing duplicate
// re-tombstones every run, but only its first creation counts as unique.
// Like the reasoning seen-set, the key list lives on the session's metrics
// entry and resets if that entry is evicted from the metrics store and
// reseeded within one process.
export const countUniqueDedupedPairs = (metrics: SessionMetrics, pairs: DedupedPairBytes[]): { unique: number; bytes: number } => {
  let unique = 0
  let bytes = 0
  for (const pair of pairs) {
    if (rememberUniqueKey(metrics.dedupedPairKeys, pair.key, DEFAULT_REMEMBERED_DEDUP_PAIRS)) {
      unique += 1
      bytes += pair.bytes
    }
  }
  return { unique, bytes }
}

export type RunComposition = {
  toolPoolBytes: number
  textChars: number
  reasoningInWindowBytes: number
  escapeBytes: number
  attachmentBytes: number
}

// The newest run's declared omissions by category, recorded when the run
// outcome lands: the tombstoned outputs no longer carry their pre-eviction
// shape, so run time is the last point these facts exist whole.
type LastOmissions = {
  toolEvictions: number
  reasoningParts: number
  fenceBlocks: number
}

// The newest run's retention audit, recorded beside the run outcome: the
// live tool-output pool size with per-reason protection counts over the
// unfiltered candidate pool. Reasons are diagnostic, not exclusive: an
// entry matching several counts under each. The fault shift reports the
// largest sort-key lead the recorded faults bought at classify time.
export type RetentionBreakdown = {
  pool: number
  reasons: { inWindow: number; protectedTool: number; patternProtected: number; faultShielded: number; retainedRead: number }
  faultShieldedShiftMessages: number
}

export type FenceEviction = { blocks: number; bytes: number; pagesDropped: number }

// Raw counters start at zero, derived from the shared schema key list so a
// counter added there is initialized here too instead of reading undefined.
// The cast is a type escape: Object.fromEntries types as a string-indexed
// record, so the schema tuple's key coverage is asserted with the cast
// rather than carried by the type.
const zeroedRawCounters = Object.fromEntries(RAW_COUNTER_KEYS.map((key) => [key, 0])) as Record<RawCounterKey, number>

export const createSessionMetrics = (): SessionMetrics => ({
  ...zeroedRawCounters,
  evictedSubjects: [],
  faultScanThrough: TOUCH_SCAN_INITIAL_WATERMARK,
  reasoningSeenKeys: [],
  dedupedPairKeys: [],
  faultCounts: new Map(),
  evictedRenderedSubjects: [],
  recallsLoggedThrough: 0,
})

// Runtime inventory of SessionMetrics's numeric keys, derived from a real
// seeded entry: the runtime artifact the schema-lockstep pin asserts
// against (raw counters plus the two cursors), since type stripping makes
// the compile-time exhaustiveness assertion inert. The cursors are
// required numeric fields on SessionMetrics, so the seeded entry already
// carries them.
const seededMetrics = createSessionMetrics()
// Type escape, same justification as zeroedRawCounters: SessionMetrics's
// key set is asserted against the schema list at authoring time, but the
// type system cannot express that structural overlap for keyed access.
export const METRIC_NUMBER_KEYS: readonly string[] = Object.freeze(
  Object.keys(seededMetrics)
    .filter((key) => typeof (seededMetrics as Record<string, unknown>)[key] === "number")
    .sort(),
)

export type PersistedCounters = Pick<SessionMetrics, RawCounterKey>

export type PersistedContextLimitSeed = { budget: PersistedContextLimit | undefined }

export type PersistedTotals = { tsMs: number; counters: PersistedCounters; budget: PersistedContextLimit | undefined }

const seedSessionCounters = (metrics: SessionMetrics, persisted: PersistedTotals): void => {
  Object.assign(metrics, persisted.counters)
  metrics.persistedBudget = persisted.budget
  // Raised with the seeded reads: without it the first post-restart run
  // would count every pre-restart stash read as read-since-last-line and
  // write a spurious eventful line.
  metrics.recallsLoggedThrough = persisted.counters.recallHits + persisted.counters.recallMisses
}

type MetricsHydrationEntry = { promise: Promise<void>; settled: boolean }

export type MetricsHydration = Map<string, MetricsHydrationEntry>

// One hydration per session key while it is in flight, and one seed per
// entry lifetime: the settled guard is replaced only when a freshly
// re-created entry asks for a reseed (the metrics store evicted the key and
// this call created it again), and that replacement loads from disk again
// rather than from the first-touch record, which this process's own later
// runs have already superseded. An entry still in the map is never
// re-seeded. Read or parse failures resolve to no seed, never an error.
const startMetricsHydration = (
  metrics: MetricsStore,
  hydrations: MetricsHydration,
  persistedTotalsForSession: (sessionKey: string) => Promise<PersistedTotals | undefined>,
  sessionKey: string,
  reseed: boolean,
): Promise<void> => {
  const guard = hydrations.get(sessionKey)
  if (guard !== undefined && (guard.settled === false || reseed === false)) return guard.promise
  const promise = persistedTotalsForSession(sessionKey)
    .then((persisted) => {
      if (persisted === undefined) return
      const current = metrics.get(sessionKey)
      if (current !== undefined) seedSessionCounters(current, persisted)
    })
    .catch(() => {})
  const next: MetricsHydrationEntry = { promise, settled: false }
  hydrations.set(sessionKey, next)
  void promise.then(() => {
    next.settled = true
  })
  return promise
}

export const metricsForSession = async (
  metrics: MetricsStore,
  hydrations: MetricsHydration,
  persistedTotalsForSession: (sessionKey: string) => Promise<PersistedTotals | undefined>,
  sessionKey: string,
  sessionBound: number,
): Promise<SessionMetrics> => {
  // An eventful run on a zeroed entry (freshly created because the metrics
  // store evicted this key, or created while its seed was still loading)
  // would persist a regressed newest record and poison later rehydration,
  // so loop until the entry survives the hydration await; the settled
  // guard makes retries microtask-cheap. A re-created entry reseeds.
  for (;;) {
    const existing = touchMapEntry(metrics, sessionKey)
    const reseed = existing === undefined
    if (reseed) {
      trimMapToBound(metrics, sessionBound)
      metrics.set(sessionKey, createSessionMetrics())
    }
    await startMetricsHydration(metrics, hydrations, persistedTotalsForSession, sessionKey, reseed)
    const settled = touchMapEntry(metrics, sessionKey)
    if (settled !== undefined) return settled
  }
}

export const appearanceTouches = (entrySubjects: Subject[], appearance: ToolAppearance, minSubstringChars: number): boolean =>
  appearance.subjects.some((appearanceSubject) =>
    entrySubjects.some(
      (entrySubject) =>
        entrySubject.path === appearanceSubject.path ||
        (appearance.tool === BASH_TOOL_NAME &&
          entrySubject.path.length > minSubstringChars &&
          appearanceSubject.path.includes(entrySubject.path)),
    ),
  )

// Keyed fault credit for one unseen appearance: every remembered rendered
// subject the appearance touches (same path-equality and bash-substring
// discipline as the aggregate scan, with the rendered string wrapped as a
// path subject) gains one fault, credited once per appearance even when
// several remembered entries share the subject.
const creditKeyedFaults = (metrics: SessionMetrics, appearance: ToolAppearance, minSubstringChars: number): void => {
  const credited = new Set<string>()
  for (const rendered of metrics.evictedRenderedSubjects) {
    if (credited.has(rendered)) continue
    if (appearanceTouches([{ path: rendered }], appearance, minSubstringChars)) {
      credited.add(rendered)
      rememberFaultForSubject(metrics.faultCounts, rendered, DEFAULT_REMEMBERED_FAULT_SUBJECTS)
    }
  }
}

export const countFaults = (metrics: SessionMetrics, appearances: ToolAppearance[], minSubstringChars: number): number => {
  let faults = 0
  let latestIndex = metrics.faultScanThrough
  for (const appearance of appearances) {
    if (appearance.msgIndex <= metrics.faultScanThrough) continue
    if (appearanceTouches(metrics.evictedSubjects, appearance, minSubstringChars)) faults += 1
    creditKeyedFaults(metrics, appearance, minSubstringChars)
    latestIndex = appearance.msgIndex
  }
  metrics.faultScanThrough = latestIndex
  return faults
}

const lastRunMetricsOf = (eviction: EvictionResult): LastRunMetrics => ({
  estimatedTokens: eviction.estimatedTokens,
  watermarkTokens: eviction.watermarkTokens,
  deficitTokens: eviction.deficitTokens,
})

export const recordRunOutcome = (metrics: SessionMetrics, run: RunOutcome, rememberedSubjectsBound: number): void => {
  const { eviction, deduped: dedupedThisRun, dedupedBytesUnique: dedupedBytesThisRun, dedupedUnique: dedupedUniqueThisRun, collapsedWindows: collapsedWindowsThisRun, collapsedWindowBytes: collapsedWindowBytesThisRun, faults: faultsThisRun, reasoningExpired: reasoningExpiredThisRun, fenceEvicted: fenceEvictedThisRun } = run
  metrics.lastRun = lastRunMetricsOf(eviction)
  metrics.evictions += eviction.evicted.length
  metrics.pagesDropped += eviction.pagesDropped
  for (const entry of eviction.evicted) {
    metrics.bytesReclaimed += entry.bytes + entry.attachmentBytes
    metrics.evictedSubjects.push(...entry.subjects)
    metrics.evictedRenderedSubjects.push(entry.subject)
  }
  while (metrics.evictedSubjects.length > rememberedSubjectsBound) metrics.evictedSubjects.shift()
  while (metrics.evictedRenderedSubjects.length > rememberedSubjectsBound) metrics.evictedRenderedSubjects.shift()
  metrics.deduped += dedupedThisRun
  metrics.dedupedBytesUnique += dedupedBytesThisRun
  metrics.dedupedUnique += dedupedUniqueThisRun
  metrics.collapsedWindows += collapsedWindowsThisRun
  metrics.collapsedWindowBytes += collapsedWindowBytesThisRun
  // Lifetime totals credit only the unique pair: the standing aged set is
  // re-expired on every request, so accumulating the per-run parts and
  // bytes would multiply both by the request count. The per-request truth
  // stays on the line's reasoningExpiredThisRun fields and in
  // expireAgedReasoning's return value.
  metrics.reasoningExpiredUnique += reasoningExpiredThisRun.unique
  metrics.reasoningBytesExpiredUnique += reasoningExpiredThisRun.uniqueBytes
  metrics.faults += faultsThisRun
  metrics.fenceEvicted += fenceEvictedThisRun.blocks
  metrics.bytesReclaimed += fenceEvictedThisRun.bytes
  metrics.pagesDropped += fenceEvictedThisRun.pagesDropped
  // The processed-context total rides the post-transform composition: the
  // request the provider bills carries this list, so the running byte sum
  // is what the derived token total divides (sum-of-chars, one ceil at
  // read, never a sum of per-run ceils).
  metrics.processedContextBytes += run.composition.toolPoolBytes + run.composition.textChars
}

// Derived counters are computed from the raw counters over the
// charsPerToken factor (the byte keys they divide are named per entry);
// everything else copies the same-named SessionMetrics field. Keyed by the
// schema's derived-counter list, so a new estimate lands here once.
const DERIVED_TOTAL_SOURCES: { [K in TotalsDerivedKey]: RawCounterKey } = {
  evictionTokensSaved: "bytesReclaimed",
  dedupTokensSaved: "dedupedBytesUnique",
  collapsedWindowTokensSaved: "collapsedWindowBytes",
  reasoningTokensSaved: "reasoningBytesExpiredUnique",
  processedContextTokens: "processedContextBytes",
}

export const totalsOf = (metrics: SessionMetrics, charsPerToken: number): CumulativeCounters => {
  const metricsAsCounters = metrics as unknown as Record<TotalsKey, number>
  const totals = {} as CumulativeCounters
  for (const key of TOTALS_KEYS) {
    const bytesKey = DERIVED_TOTAL_SOURCES[key as TotalsDerivedKey]
    totals[key] = bytesKey === undefined ? metricsAsCounters[key] : estimateTokensFromBytes(metricsAsCounters[bytesKey], charsPerToken)
  }
  return totals
}

export type DryRunResult = { deficitTokens: number; wouldEvictCount: number; wouldEvictBytes: number; wouldEvictSubjects: string[] }

export type AdvisoryResult = {
  ratio: number
  bandStartTokens: number
  estimatedTokens: number
  deficitTokens: number
  subjects: string[]
}

// Create-or-update on the session metrics store: the shared shape behind
// rememberError and the hygiene copy's error surfacing, so a diagnostic
// recorded for a session with no entry yet (a fault, compaction event, or
// hygiene write error before the first transform) still lands on a
// created entry that respects the session bound. An existing entry is
// refreshed to most-recent recency: a session emitting diagnostics is an
// active session. The fresh entry is keyed by the diagnostic's session,
// not seeded from any persisted record, so a later reseed overwriting it
// is accepted (faults and write errors are run-scoped diagnostics).
export const withSessionMetricsEntry = (
  metrics: MetricsStore,
  sessionKey: string,
  sessionBound: number,
  apply: (entry: SessionMetrics) => void,
): void => {
  const existing = touchMapEntry(metrics, sessionKey)
  if (existing !== undefined) {
    apply(existing)
    return
  }
  trimMapToBound(metrics, sessionBound)
  const entry = createSessionMetrics()
  apply(entry)
  metrics.set(sessionKey, entry)
}

export const rememberError = (metrics: MetricsStore, sessionKey: string, lastError: LastError, sessionBound: number): void =>
  withSessionMetricsEntry(metrics, sessionKey, sessionBound, (entry) => {
    entry.lastError = lastError
  })
