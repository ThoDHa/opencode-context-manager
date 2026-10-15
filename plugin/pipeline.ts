import { CONTEXT_TOKENS_SOURCE_UNKNOWN, type ContextLimitEntry, contextLimitForRun } from "./context-limits.ts"
import { type MessageBundle, nonEmptyAttachmentsOf, runCompositionOf, stripStateAttachments, TEXT_PART_TYPE } from "./messages.ts"
import type { ResolvedOptions } from "./options.ts"
import { sessionKeyFromContext, touchMapEntry } from "./session-maps.ts"
import { countFaults, countUniqueDedupedPairs, metricsForSession, type MetricsHydration, type MetricsStore, type PersistedTotals, type ReasoningExpiry, recordRunOutcome, type RunOutcome, type TailSummariesResult } from "./state.ts"
import { recordMetricsLine, recordSessionCheckpoint, type PruneThrottle } from "./persistence.ts"
import { type PageEntry, type PageSummaryRecord, pageKeyOf, pagesForSession, type PageStoreBySession, type PageStoreGuard, recordPageStoreLines } from "./page-store.ts"
import { deduplicateFileAttachments, deduplicateToolOutputs } from "./dedup.ts"
import { expireAgedReasoning, fireCollapsePass, type HygieneCadenceBySession, purgeErroredToolInputs, REASONING_EXPIRY_NONE, resolveHygieneBatch, stripLegacyHintParts } from "./hygiene.ts"
import { evictLargeUserFences } from "./fences.ts"
import { effectiveWatermarkTokensOf, evictLeastRecentlyUsed, evictionCandidatesOf, measureAdvisory, measureDryRun, measureWithoutEvicting, retentionBreakdownOf } from "./eviction.ts"
import { type HintMembershipBySession, storeHint, storeStableHint } from "./hints.ts"
import type { SummaryCompressor } from "./summaries.ts"
import { buildOutputDigest, buildReloadPointer, buildTailSummaryEntry, buildTombstone, EVICTION_MARKER, LEGACY_EVICTION_MARKER, primarySubjectOf, startsWithEitherGeneration, subjectsOf, TAIL_SUMMARY_TEXT_PREFIX } from "./vocabulary.ts"

// The transform hook's body, extracted so the registration-site boundary
// can wrap it in fault isolation. Everything it needs rides the deps
// object (the plugin instance's per-process stores plus resolved
// options); nothing mutates state outside them.
export type TransformHookDeps = {
  contextLimits: Map<string, ContextLimitEntry>
  modelKeyBySession: Map<string, string | undefined>
  metricsBySession: MetricsStore
  metricsHydrationBySession: MetricsHydration
  persistedTotalsForSession: (sessionKey: string) => Promise<PersistedTotals | undefined>
  pageStoreBySession: PageStoreBySession
  hintBySession: Map<string, string>
  hintMembershipBySession: HintMembershipBySession
  hygieneCadenceBySession: HygieneCadenceBySession
  pruneThrottle: PruneThrottle
  pluginSession: string
  pageStoreGuard: PageStoreGuard
  options: ResolvedOptions
  // The compressor behind the summary gates, built by the entry when
  // either the compression or the tail gate is on and the host provided a
  // client; absent on every other start, which leaves the walk
  // byte-identical to the pre-compression plugin.
  summaryCompressor?: SummaryCompressor
  // The tail projection's persistent source: the session's durable
  // summary records, stored and in-memory alike, wired by the entry to
  // the page-store reader over this instance's summary lines.
  summaryRecordsForSession: (sessionKey: string) => Promise<PageSummaryRecord[]>
  // The compact projection's persistent source: the session's durable
  // compacted keys (page-store compaction lines merged with the
  // per-process mirror), wired by the entry the same way.
  compactedKeysForSession: (sessionKey: string) => Promise<Set<string>>
}

export const transformHookBody = async (messages: MessageBundle[], deps: TransformHookDeps): Promise<void> => {
  const { options } = deps
  const info = messages[0]?.info
  const sessionKey = sessionKeyFromContext(info)
  const sessionID = info?.sessionID
  // The budget fallback rides the session metrics, so hydration must
  // land before resolution: a restart resolves the persisted budget
  // instead of flickering to unknown, and a live chat.params capture
  // still wins because the fallback fills only the unknown state.
  const sessionMetrics = await metricsForSession(deps.metricsBySession, deps.metricsHydrationBySession, deps.persistedTotalsForSession, sessionKey, options.metricsSessions)
  const sessionLimit = sessionID !== undefined ? touchMapEntry(deps.contextLimits, sessionID) : undefined
  const sittingModelKey = sessionID === undefined ? undefined : deps.modelKeyBySession.get(sessionID)
  const { contextLimit, fallbackSuppressed } = contextLimitForRun(sessionLimit, sessionMetrics.persistedBudget, sittingModelKey, options)
  if (fallbackSuppressed) sessionMetrics.persistedBudget = undefined
  else if (contextLimit.source !== CONTEXT_TOKENS_SOURCE_UNKNOWN) sessionMetrics.persistedBudget = { tokens: contextLimit.tokens, source: contextLimit.source, modelKey: contextLimit.modelKey }
  const sessionPageStore = pagesForSession(deps.pageStoreBySession, sessionKey, options.stashSessions)
  // The run's stashed entries, gathered at the two stash sites so the write
  // below lands them eagerly in the same run as the eviction that built them.
  const pageStoreEntries: PageEntry[] = []
  stripLegacyHintParts(messages)
  const toolDedup = deduplicateToolOutputs(messages, options)
  const fileDedup = deduplicateFileAttachments(messages, options)
  // The batched-cadence decision sits where the collapse pass used to fire:
  // its plan phase is the collapse pass's detection, and the purge and
  // expiry trigger scans read the same pre-hygiene state their passes
  // would, so the deferral decision cannot disagree with a fire.
  const hygieneBatch = resolveHygieneBatch(messages, options, deps.hygieneCadenceBySession, sessionKey)
  const rangeCollapse = fireCollapsePass(messages, hygieneBatch)
  const dedupedThisRun = toolDedup.tombstones + fileDedup.tombstones
  // The lifetime unique credit gates count and bytes alike on the pair
  // identity: a standing duplicate re-tombstones every run, but only its
  // first creation credits the pair's superseded bytes.
  const { unique: dedupedUniqueThisRun, bytes: dedupedBytesUniqueThisRun } = countUniqueDedupedPairs(sessionMetrics, [
    ...toolDedup.tombstonedPairs,
    ...fileDedup.tombstonedPairs,
  ])
  let reasoningExpiredThisRun: ReasoningExpiry = REASONING_EXPIRY_NONE
  let purgedThisRun = 0
  if (hygieneBatch.fire) {
    purgedThisRun = purgeErroredToolInputs(messages, options)
    reasoningExpiredThisRun = expireAgedReasoning(sessionMetrics, messages, options)
  }
  const fenceEvictedThisRun = evictLargeUserFences(messages, options, sessionPageStore, pageStoreEntries)
  // The compression sink closes over this run's session key so the
  // compressor stamps each summary line with the evicting session; the
  // enqueue is fire-and-forget, so handing the sink to the walk below
  // never delays the transform.
  const { summaryCompressor } = deps
  const summarizeEvicted =
    summaryCompressor === undefined ? undefined : (page: PageEntry): void => { summaryCompressor.enqueue({ sessionKey, page }) }
  const effectiveWatermarkTokens = effectiveWatermarkTokensOf(contextLimit.tokens, options)
  // One scan and one candidate walk feed whichever path runs: the
  // stand-downs (manual mode, or no watermark with the aged read tier
  // disarmed) share this candidates computation with the real evictor.
  // The aged read tier arms the evictor even without a budget, since its
  // evictions are budget-independent; with the tier unset the old
  // stand-down holds and an unknown budget still suspends eviction.
  const candidates = evictionCandidatesOf(messages, options, sessionMetrics.faultCounts)
  const standDown = options.manualMode || (effectiveWatermarkTokens === null && options.agedReadEvictionMessages === undefined)
  const eviction = standDown
    ? measureWithoutEvicting(candidates, effectiveWatermarkTokens)
    : evictLeastRecentlyUsed(messages, candidates, options, effectiveWatermarkTokens, sessionPageStore, pageStoreEntries, summarizeEvicted)
  // The manual-mode dry run: with an effective watermark set, report
  // what the evictor would reclaim (the combined watermark and aged
  // read policy) so a staged watermark or staged age threshold can be
  // evaluated before manual mode is ever turned off. Never mutates
  // the message list.
  const dryRun =
    options.manualMode && effectiveWatermarkTokens !== null
      ? measureDryRun(messages, candidates, options, effectiveWatermarkTokens)
      : undefined
  // The advisory pressure band: computed for every run (manual mode
  // included, alongside the dry run) from the same pre-eviction
  // candidates the evictor and the dry run consume. Eviction itself
  // still fires only at the effective watermark.
  const advisory = measureAdvisory(candidates, effectiveWatermarkTokens, options)
  const faultsThisRun = countFaults(sessionMetrics, eviction.appearances, options.minSubstringMatchChars)
  // The tail-side durable summary block: after every mutating pass above,
  // so projected entries land at the transform-time END of the final list
  // and the prefix in front of them is byte-stable this run. The tail is
  // a per-request projection over the persistent summary records, re-derived
  // on every transform.
  const tailSummaries = await applyTailSummaries(messages, sessionKey, sessionID, deps)
  // The compact tool's per-request projection: the executor recorded the
  // batch durably at accept time; every transform after it applies the
  // seat mechanics to the transform-view parts whose keys the record
  // holds, so the tombstones survive restarts and the host's dropped
  // mutations by construction. Runs after the tail pass so both read the
  // same post-hygiene list.
  await applyCompactedSeats(messages, sessionKey, deps)
  // Composition reads the final post-transform list: every pass above has
  // applied its edits, so the sums are what this request carries.
  const composition = runCompositionOf(messages, options)
  const runOutcome: RunOutcome = {
    eviction,
    deduped: dedupedThisRun,
    dedupedBytesUnique: dedupedBytesUniqueThisRun,
    dedupedUnique: dedupedUniqueThisRun,
    collapsedWindows: rangeCollapse.collapsed,
    collapsedWindowBytes: rangeCollapse.collapsedBytes,
    purged: purgedThisRun,
    faults: faultsThisRun,
    reasoningExpired: reasoningExpiredThisRun,
    fenceEvicted: fenceEvictedThisRun,
    ...(tailSummaries === undefined ? {} : { tailSummaries }),
    dryRun,
    advisory,
    composition,
  }
  recordRunOutcome(sessionMetrics, runOutcome, options.rememberedEvictedSubjects)
  sessionMetrics.lastDryRun = runOutcome.dryRun
  sessionMetrics.lastAdvisory = runOutcome.advisory
  sessionMetrics.lastComposition = runOutcome.composition
  sessionMetrics.lastOmissions = {
    toolEvictions: runOutcome.eviction.evicted.length,
    reasoningParts: runOutcome.reasoningExpired.parts,
    fenceBlocks: runOutcome.fenceEvicted.blocks,
  }
  sessionMetrics.lastRetention = retentionBreakdownOf(candidates, messages, options, sessionMetrics.faultCounts)
  // WHY cache-aware: the hint line rides the system array, seat ~0 of the
  // request, so rewriting it every run (touch-recency reordering, fresh
  // range numerals) invalidates the provider's cached prefix from that
  // seat onward and re-prices the whole request at the uncached rate. The
  // gated rendering is byte-stable: identifiers sorted, no live numerals,
  // membership moving only through entry/exit hysteresis, so the seat
  // rewrites only on a genuine membership change.
  if (options.cacheAwareHints) {
    storeStableHint(deps.hintBySession, deps.hintMembershipBySession, sessionKey, eviction.hotSubjects, options.hintSubjects, options.hintSessions)
  } else {
    storeHint(deps.hintBySession, sessionKey, eviction.hotSubjects, options.hintSubjects, options.hintSessions)
  }
  await recordPageStoreLines(options, deps.metricsBySession, sessionKey, pageStoreEntries, deps.pageStoreGuard)
  await recordMetricsLine(options, sessionMetrics, sessionKey, deps.pluginSession, contextLimit, runOutcome)
  await recordSessionCheckpoint(options, sessionKey, contextLimit, sessionMetrics, sessionPageStore, eviction.hotSubjects, deps.pruneThrottle)
}

// WHY cache-aware: the lever5 series lost because the compression rewrite
// lands mid-history (the tombstone seat), breaking every downstream
// provider cache hit for more tokens than the summary reclaimed. The tail
// placement keeps those tombstone bytes frozen and lands each completed
// summary as a user-role text part at the list END instead: the tail seat
// is the only new bytes, so only it prices at the uncached rate, and the
// pre-tail history stays byte-stable.
// PER-REQUEST PROJECTION: the host drops transform-time message-list
// appends between requests (the F4 probe's finding), so the tail is not
// persisted state. Every transform re-derives it from the session's
// persistent summary records, the same source recall's summary-first
// serve consults: oldest-first (insertion order), bounded by
// tailSummaryMaxTokens at projection time, entries beyond the cap
// reported as dropped. The cost profile is a bounded per-request tail
// re-read, at most the cap's tokens. Entries the list already carries
// (the same-list re-transform case) are skipped, never deleted: the pass
// appends, it does not own or rewrite history.
const applyTailSummaries = async (messages: MessageBundle[], sessionKey: string, sessionID: string | undefined, deps: TransformHookDeps): Promise<TailSummariesResult | undefined> => {
  const { options, summaryRecordsForSession } = deps
  if (!options.tailSummaryBlocks) return undefined
  const records = await summaryRecordsForSession(sessionKey)
  // The cap pass: oldest-first, an entry fits only while the sum stays
  // under the cap, and everything beyond it counts as dropped.
  const projectedTexts: string[] = []
  let liveChars = 0
  let dropped = 0
  for (const record of records) {
    const entryText = buildTailSummaryEntry(record.tool, record.subject, record.summary)
    if (Math.ceil((liveChars + entryText.length) / options.charsPerToken) > options.tailSummaryMaxTokens) {
      dropped += 1
      continue
    }
    projectedTexts.push(entryText)
    liveChars += entryText.length
  }
  // Append the fitted entries the list does not already carry, oldest
  // first, so the projection is idempotent over one list. The appended
  // message self-attributes like every sibling message the host
  // persisted: an undefined session id stays undefined, but a known one
  // rides the entry so session-scoped host code reads the tail region as
  // this session's own.
  const existingTexts = new Set(existingTailTextsOf(messages))
  for (const entryText of projectedTexts) {
    if (existingTexts.has(entryText)) continue
    messages.push({
      info: sessionID === undefined ? { role: "user" } : { role: "user", sessionID },
      parts: [{ type: TEXT_PART_TYPE, text: entryText }],
    })
  }
  // liveEntries is the projected set plus pre-existing tail-prefixed
  // parts the projection does not carry (a changed record's stale entry,
  // a quoted entry): counted, never trimmed.
  let stale = 0
  for (const text of existingTexts) {
    if (!projectedTexts.includes(text)) stale += 1
  }
  return {
    projected: projectedTexts.length,
    dropped,
    liveEntries: projectedTexts.length + stale,
    liveTokens: Math.ceil(liveChars / options.charsPerToken),
  }
}

// The texts of the tail-prefixed text parts already riding the list, so
// the projection can skip them instead of duplicating them.
const existingTailTextsOf = (messages: MessageBundle[]): string[] => {
  const texts: string[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      const text = part["text"]
      if (part["type"] === TEXT_PART_TYPE && typeof text === "string" && text.startsWith(TAIL_SUMMARY_TEXT_PREFIX)) texts.push(text)
    }
  }
  return texts
}

// The compact tool's per-request projection: the accept path records the
// batch's page keys durably (the page store's compaction lines plus the
// per-process mirror); every transform after it re-derives the seat
// replacements from that record. For each list seat whose pageKeyOf
// matches a recorded key and whose output is not already an eviction
// marker, the seat mechanics apply exactly as the evictor writes them:
// tombstone with digest and reload pointer built from the seat's current
// output bytes, the attachment trio (payloads into the seat's stored
// page, the dropped flag in the tombstone, stripped from the live state),
// attachments strip included. Deterministic per request: the same list
// and the same record project the same edits, and a seat already carrying
// its tombstone (the same-list re-transform, a host that did keep the
// mutation) is skipped, never rewritten.
const applyCompactedSeats = async (messages: MessageBundle[], sessionKey: string, deps: TransformHookDeps): Promise<void> => {
  const { options, compactedKeysForSession } = deps
  if (!options.compactTool) return
  const compactedKeys = await compactedKeysForSession(sessionKey)
  if (compactedKeys.size === 0) return
  messages.forEach((message, msgIndex) => {
    for (const [partIndex, part] of message.parts.entries()) {
      if (part["type"] !== "tool") continue
      const state = part["state"]
      if (typeof state !== "object" || state === null) continue
      const typedState = state as Record<string, unknown>
      if (typedState["status"] !== "completed") continue
      const tool = part["tool"]
      if (typeof tool !== "string") continue
      if (typeof typedState["output"] !== "string") continue
      const output = typedState["output"]
      if (startsWithEitherGeneration(output, EVICTION_MARKER, LEGACY_EVICTION_MARKER)) continue
      const input = typeof typedState["input"] === "object" && typedState["input"] !== null ? (typedState["input"] as Record<string, unknown>) : {}
      const primary = primarySubjectOf(subjectsOf(tool, input))
      const seatKey = pageKeyOf(tool, primary, msgIndex, partIndex)
      if (!compactedKeys.has(seatKey)) continue
      const attachments = nonEmptyAttachmentsOf(typedState)
      const digest = buildOutputDigest(tool, primary, output)
      const tombstone = buildTombstone(tool, primary, output.length, messages.length - msgIndex, attachments !== undefined, digest)
      stripStateAttachments(typedState)
      typedState["output"] = `${tombstone}${buildReloadPointer(primary)}`
    }
  })
}
