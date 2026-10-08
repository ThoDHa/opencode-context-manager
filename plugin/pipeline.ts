import { CONTEXT_TOKENS_SOURCE_UNKNOWN, type ContextLimitEntry, contextLimitForRun } from "./context-limits.ts"
import { type MessageBundle, runCompositionOf } from "./messages.ts"
import type { ResolvedOptions } from "./options.ts"
import { sessionKeyFromContext, touchMapEntry } from "./session-maps.ts"
import { countFaults, countUniqueDedupedPairs, metricsForSession, type MetricsHydration, type MetricsStore, type PersistedTotals, type ReasoningExpiry, recordRunOutcome, type RunOutcome } from "./state.ts"
import { recordMetricsLine, recordSessionCheckpoint, type PruneThrottle } from "./persistence.ts"
import { type PageEntry, pagesForSession, type PageStoreBySession, type PageStoreGuard, recordPageStoreLines } from "./page-store.ts"
import { deduplicateFileAttachments, deduplicateToolOutputs } from "./dedup.ts"
import { expireAgedReasoning, fireCollapsePass, type HygieneCadenceBySession, purgeErroredToolInputs, REASONING_EXPIRY_NONE, resolveHygieneBatch, stripLegacyHintParts } from "./hygiene.ts"
import { evictLargeUserFences } from "./fences.ts"
import { effectiveWatermarkTokensOf, evictLeastRecentlyUsed, evictionCandidatesOf, measureAdvisory, measureDryRun, measureWithoutEvicting, retentionBreakdownOf } from "./eviction.ts"
import { type HintMembershipBySession, storeHint, storeStableHint } from "./hints.ts"
import type { SummaryCompressor } from "./summaries.ts"

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
  // The compressor behind the compression-on-evict gate, built by the
  // entry only when the gate is on and the host provided a client; absent
  // on every other start, which leaves the walk byte-identical to the
  // pre-compression plugin.
  summaryCompressor?: SummaryCompressor
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
