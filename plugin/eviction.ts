import { appearanceTouches, attachmentPayloadCharsOf, estimateTokens, hotFromIndexOf, nonEmptyAttachmentsOf, stripStateAttachments } from "./messages.ts"
import type { MessageBundle, ToolAppearance } from "./messages.ts"
import { BASH_TOOL_NAME, buildOutputDigest, buildReloadPointer, buildTombstone, DEDUP_MARKER, EVICTION_MARKER, LEGACY_DEDUP_MARKER, LEGACY_EVICTION_MARKER, renderSubject, startsWithEitherGeneration, subjectsOf, UNKNOWN_TARGET_LABEL } from "./vocabulary.ts"
import type { HotSubject, Subject } from "./vocabulary.ts"
import { ADVISORY_SUBJECTS_BOUND, isPatternProtected, isProtectedTool } from "./options.ts"
import type { ResolvedOptions } from "./options.ts"
import { storeEvictedPage } from "./page-store.ts"
import type { PageEntry, SessionPageStore } from "./page-store.ts"
import type { AdvisoryResult, DryRunResult, EvictedEntryInfo, EvictionResult, RetentionBreakdown } from "./state.ts"

// How many messages of eviction deferral one recorded fault buys a subject
// in the candidate sort: a reloaded output is demonstrably needed again, so
// it re-evicts five messages later than its recency alone would place it.
const FAULT_PENALTY_MESSAGES = 5

type EvictableEntry = {
  stateRef: { output: string; attachments?: unknown }
  tool: string
  msgIndex: number
  partIndex: number
  lastTouch: number
  bytes: number
  attachmentBytes: number
  subjects: Subject[]
}

// The effective eviction watermark in tokens: the absolute watermarkTokens
// option wins when set; otherwise the budget times the fractional
// watermark. The budget drives the fractional path only, so an absolute
// watermark can engage even where no budget was captured (unknown-budget
// runs otherwise stand eviction down entirely).
export const effectiveWatermarkTokensOf = (contextLimitTokens: number | null, options: ResolvedOptions): number | null => {
  if (options.watermarkTokens !== undefined) return options.watermarkTokens
  if (contextLimitTokens === null) return null
  return contextLimitTokens * options.watermark
}

const liveSubjectsOf = (entries: EvictableEntry[]): HotSubject[] =>
  entries.flatMap((entry) =>
    startsWithEitherGeneration(entry.stateRef.output, EVICTION_MARKER, LEGACY_EVICTION_MARKER) ||
    startsWithEitherGeneration(entry.stateRef.output, DEDUP_MARKER, LEGACY_DEDUP_MARKER)
      ? []
      : entry.subjects.map((subject) => ({ subject, lastTouch: entry.lastTouch })),
  )

const scanToolOutputs = (
  messages: MessageBundle[],
  options: ResolvedOptions,
): { appearances: ToolAppearance[]; entries: EvictableEntry[] } => {
  const appearances: ToolAppearance[] = []
  const entries: EvictableEntry[] = []

  messages.forEach((message, msgIndex) => {
    for (const [partIndex, part] of message.parts.entries()) {
      if (part["type"] !== "tool") continue
      const state = part["state"]
      if (typeof state !== "object" || state === null) continue
      const typedState = state as Record<string, unknown>
      if (typedState["status"] !== "completed") continue
      const tool = part["tool"]
      if (typeof tool !== "string") continue
      const input = typeof typedState["input"] === "object" && typedState["input"] !== null ? (typedState["input"] as Record<string, unknown>) : {}
      const subjects = subjectsOf(tool, input)
      appearances.push({ msgIndex, tool, subjects })

      if (typeof typedState["output"] !== "string") continue
      const output = typedState["output"]
      if (startsWithEitherGeneration(output, EVICTION_MARKER, LEGACY_EVICTION_MARKER) || startsWithEitherGeneration(output, DEDUP_MARKER, LEGACY_DEDUP_MARKER) || output.length < options.minEvictableBytes) continue
      entries.push({
        stateRef: typedState as { output: string; attachments?: unknown },
        tool,
        msgIndex,
        partIndex,
        lastTouch: msgIndex,
        bytes: output.length,
        attachmentBytes: attachmentPayloadCharsOf(typedState),
        subjects,
      })
    }
  })

  for (const entry of entries) {
    for (const appearance of appearances) {
      if (appearance.msgIndex > entry.lastTouch && appearanceTouches(entry.subjects, appearance, options.minSubstringMatchChars)) {
        entry.lastTouch = appearance.msgIndex
      }
    }
  }

  return { appearances, entries }
}

// One scan and one candidate computation shared by the real evictor, the
// manual-mode dry run, and the no-eviction measurement, so the mirror is
// structural: the dry run walks exactly the ordered, filtered candidate
// list the evictor walks.
type EvictionCandidates = { appearances: ToolAppearance[]; entries: EvictableEntry[]; evictable: EvictableEntry[]; estimatedTokens: number }

const primaryRenderedSubjectOf = (entry: EvictableEntry): string =>
  entry.subjects.length > 0 ? renderSubject(entry.subjects[0]) : UNKNOWN_TARGET_LABEL

// The sort key fault feedback adjusts: each recorded fault pushes the
// entry's effective recency FAULT_PENALTY_MESSAGES newer, so faulted
// subjects evict later under equal pressure while remaining evictable
// (pressure still wins). Unfaulted entries keep their exact lastTouch, so
// their ordering is byte-identical to the unadjusted sort.
const faultAdjustedLastTouchOf = (entry: EvictableEntry, faultCounts: Map<string, number>): number =>
  entry.lastTouch + (faultCounts.get(primaryRenderedSubjectOf(entry)) ?? 0) * FAULT_PENALTY_MESSAGES

export const evictionCandidatesOf = (messages: MessageBundle[], options: ResolvedOptions, faultCounts: Map<string, number>): EvictionCandidates => {
  const { appearances, entries } = scanToolOutputs(messages, options)
  const hotFromIndex = hotFromIndexOf(messages, options)
  const evictable = entries
    .filter((entry) => !isProtectedTool(entry.tool, options))
    .filter((entry) => entry.lastTouch < hotFromIndex)
    .filter((entry) => !isPatternProtected(entry.subjects, options))
    .map((entry) => ({ entry, sortKey: faultAdjustedLastTouchOf(entry, faultCounts) }))
    .sort((a, b) => a.sortKey - b.sortKey || b.entry.bytes - a.entry.bytes)
    .map((decorated) => decorated.entry)
  return { appearances, entries, evictable, estimatedTokens: estimateTokens(messages, options.charsPerToken) }
}

// Retention audit beside the candidates computation: classify every live
// tool output the evictor could see (candidates.entries, the unfiltered
// scanToolOutputs pool) against the same predicates the filter chain
// applies, so the audit cannot disagree with the mechanism it audits.
// Reasons are not exclusive: an entry matching several counts under each,
// so the sums read as diagnostic, never as a total. Fault-shielded
// reports the sort-key shift the recorded faults bought at classify time,
// taken from the fault adjustment itself so the magnitude cannot drift
// from the mechanism, not a survival guarantee
// (pressure still evicts a faulted entry); zero when no entry is faulted.
// A pool of zero is the caller's absence signal: describe and the panel
// render no retention surface for a run that scanned no live outputs.
export const retentionBreakdownOf = (candidates: EvictionCandidates, messages: MessageBundle[], options: ResolvedOptions, faultCounts: Map<string, number>): RetentionBreakdown => {
  const hotFromIndex = hotFromIndexOf(messages, options)
  let maxFaultShieldedShift = 0
  const reasons = { inWindow: 0, protectedTool: 0, patternProtected: 0, faultShielded: 0, retainedRead: 0 }
  for (const entry of candidates.entries) {
    if (entry.msgIndex >= hotFromIndex) reasons.inWindow += 1
    else if (entry.lastTouch >= hotFromIndex) reasons.retainedRead += 1
    if (isProtectedTool(entry.tool, options)) reasons.protectedTool += 1
    if (isPatternProtected(entry.subjects, options)) reasons.patternProtected += 1
    const faulted = faultCounts.get(primaryRenderedSubjectOf(entry)) ?? 0
    if (faulted > 0) {
      reasons.faultShielded += 1
      maxFaultShieldedShift = Math.max(maxFaultShieldedShift, faultAdjustedLastTouchOf(entry, faultCounts) - entry.lastTouch)
    }
  }
  return { pool: candidates.entries.length, reasons, faultShieldedShiftMessages: maxFaultShieldedShift }
}

// The aged read tier (agedReadEvictionMessages): read-family outputs,
// defined as the tools whose subjects the touch tracker refreshes by
// exact path equality (every non-bash tool carrying a path or pattern
// subject; bash is the substring-refresh command channel and is
// excluded), whose birth position sits strictly older than the threshold
// from the list tail. Birth position, not lastTouch: a re-touched read
// is protected by the recent-window filter upstream of the tier, so a
// re-read keeps its output however ancient its original message is. The
// age compares against the list tail, so it is a deterministic function
// of the message list and the per-request view stays stable under the
// re-run-per-request contract. The tier adds no candidate of its own: it
// arms a second disposition inside the single shared walk (below), so
// aged entries ride the same tombstone, stash, and counter machinery as
// budget-driven evictions.
const isAgedReadEntry = (entry: EvictableEntry, listLength: number, options: ResolvedOptions): boolean =>
  options.agedReadEvictionMessages !== undefined &&
  entry.tool !== BASH_TOOL_NAME &&
  entry.subjects.length > 0 &&
  listLength - entry.msgIndex > options.agedReadEvictionMessages

// The deficit the evictor and the stand-down share, so the two sites
// cannot drift: the estimate over the effective watermark, disarmed to
// null when no effective watermark exists. The dry run does not use this
// guard because its contract hands it a non-null watermark.
const deficitTokensOf = (estimatedTokens: number, watermarkTokens: number | null): number | null =>
  watermarkTokens === null ? null : estimatedTokens - watermarkTokens

// The one-disposition decision the evictor walk and the dry-run walk
// share, so the two sites cannot drift: an entry is evicted when the aged
// read tier claims it, or when the watermark tier still has ground left
// to cover. A null deficit (no effective watermark) disarms the watermark
// tier entirely and leaves the aged tier unaffected. The tier boundary
// itself is untouched by the batch multiplier: the aged tier's dispositions
// and the protected-path filters upstream of the walk are identical at
// every multiplier value, and the reported deficit stays the true
// estimate-minus-watermark figure.
//
// WHY cache-aware: the watermark tier's stop target is the deficit times
// evictionBatchMultiplier. Each firing cuts history and re-prices the
// request tail from the cut point at the uncached rate, so N small
// reset events cost N re-priced tails; clearing N x the deficit per
// firing amortizes those re-pricings into one rarer, larger cut. At the
// default 1 the target is the deficit itself and the walk is byte-identical
// to the ungated evictor.
const isEvictedByWalkPolicy = (
  entry: EvictableEntry,
  listLength: number,
  options: ResolvedOptions,
  deficitTokens: number | null,
  reclaimedTokens: number,
): boolean =>
  isAgedReadEntry(entry, listLength, options) ||
  (deficitTokens !== null && reclaimedTokens < deficitTokens * options.evictionBatchMultiplier)

// The stand-down measurement: the run record of a transform that evicted
// nothing. The watermark and deficit ride through when an effective
// watermark exists (armed manual mode with a captured budget or a set
// watermarkTokens), so the sidebar and describe show the real
// figures the dry run acts on; a null watermark (either mode) keeps both
// null, matching a session that genuinely has no watermark. The deficit
// is the shared estimate-minus-watermark arithmetic over the shared
// candidates' estimate.
export const measureWithoutEvicting = (candidates: EvictionCandidates, watermarkTokens: number | null): EvictionResult => {
  return {
    hotSubjects: liveSubjectsOf(candidates.entries),
    appearances: candidates.appearances,
    estimatedTokens: candidates.estimatedTokens,
    watermarkTokens,
    deficitTokens: deficitTokensOf(candidates.estimatedTokens, watermarkTokens),
    evicted: [],
    pagesDropped: 0,
  }
}

// The advisory pressure band below the effective watermark: the newest
// run's preview of how close the session sits to eviction. The band start
// is ratio x effective watermark and the estimate tested is the shared
// candidates' pre-eviction figure, the same one the dry run prices, so
// the preview and the evictor can never disagree about the session's size.
// Returns undefined when disarmed, when no effective watermark exists, or
// when the estimate sits below the band start; never mutates anything.
export const measureAdvisory = (candidates: EvictionCandidates, effectiveWatermarkTokens: number | null, options: ResolvedOptions): AdvisoryResult | undefined => {
  if (!options.advisoryBand || effectiveWatermarkTokens === null) return undefined
  const bandStartTokens = options.advisoryBandRatio * effectiveWatermarkTokens
  const estimatedTokens = candidates.estimatedTokens
  if (estimatedTokens < bandStartTokens) return undefined
  return {
    ratio: options.advisoryBandRatio,
    bandStartTokens,
    estimatedTokens,
    deficitTokens: estimatedTokens - effectiveWatermarkTokens,
    subjects: candidates.evictable.slice(0, ADVISORY_SUBJECTS_BOUND).map((entry) => primaryRenderedSubjectOf(entry)),
  }
}

// Manual-mode dry run: with an effective watermark in hand, compute what
// the evictor WOULD reclaim (the shared candidate list, the same
// reclaim-until-deficit walk with the aged read tier's dispositions
// included) without touching any output. Consumes the already-computed
// candidates, so the message list is unchanged when it returns and no
// second scan runs.
export const measureDryRun = (
  messages: MessageBundle[],
  candidates: EvictionCandidates,
  options: ResolvedOptions,
  watermarkTokens: number,
): DryRunResult => {
  const deficitTokens = candidates.estimatedTokens - watermarkTokens
  const subjects: string[] = []
  let wouldEvictBytes = 0
  let reclaimedTokens = 0
  for (const entry of candidates.evictable) {
    if (!isEvictedByWalkPolicy(entry, messages.length, options, deficitTokens, reclaimedTokens)) continue
    reclaimedTokens += entry.bytes / options.charsPerToken
    wouldEvictBytes += entry.bytes
    subjects.push(primaryRenderedSubjectOf(entry))
  }
  return { deficitTokens, wouldEvictCount: subjects.length, wouldEvictBytes, wouldEvictSubjects: subjects }
}

// The narrow compression sink the pipeline hands in when the feature is
// gated on and a client exists: invoked once per evicted entry at the one
// store-and-push block, so both walk dispositions (watermark and aged
// read) enqueue and fence entries, evicted by their own pass before the
// walk, are unreachable by construction. The sink is fire-and-forget and
// caller-owned; the walk never sees the compressor or the client.
export const evictLeastRecentlyUsed = (
  messages: MessageBundle[],
  candidates: EvictionCandidates,
  options: ResolvedOptions,
  watermarkTokens: number | null,
  pageStore: SessionPageStore,
  pageStoreEntries: PageEntry[],
  summarizeEvicted?: (page: PageEntry) => void,
): EvictionResult => {
  const { evictable } = candidates

  const deficitTokens = deficitTokensOf(candidates.estimatedTokens, watermarkTokens)
  const evicted: EvictedEntryInfo[] = []
  let pagesDropped = 0
  let reclaimedTokens = 0
  // One walk, one disposition per candidate: the aged read tier evicts
  // its entries whatever the budget says, and the watermark tier evicts
  // the rest only while the deficit is unmet, so no entry is touched
  // twice and the aged tier cannot double-count against the budget pass.
  for (const entry of evictable) {
    if (!isEvictedByWalkPolicy(entry, messages.length, options, deficitTokens, reclaimedTokens)) continue
    const subject = primaryRenderedSubjectOf(entry)
    const messagesAgo = messages.length - entry.lastTouch
    const droppedAttachments = nonEmptyAttachmentsOf(entry.stateRef)
    const digest = buildOutputDigest(entry.tool, subject, entry.stateRef.output)
    const tombstone = buildTombstone(entry.tool, subject, entry.bytes, messagesAgo, droppedAttachments !== undefined, digest)
    const stored: PageEntry = {
      output: entry.stateRef.output,
      tool: entry.tool,
      subject,
      msgIndex: entry.msgIndex,
      partIndex: entry.partIndex,
    }
    if (droppedAttachments !== undefined) stored.attachments = droppedAttachments
    pagesDropped += storeEvictedPage(pageStore, stored, options.stashLimit)
    pageStoreEntries.push(stored)
    summarizeEvicted?.(stored)
    stripStateAttachments(entry.stateRef)
    entry.stateRef.output = `${tombstone}${buildReloadPointer(subject)}`
    reclaimedTokens += entry.bytes / options.charsPerToken
    evicted.push({
      tool: entry.tool,
      subject,
      subjects: entry.subjects,
      bytes: entry.bytes,
      attachmentBytes: entry.attachmentBytes,
      messagesAgo,
    })
  }
  return {
    hotSubjects: liveSubjectsOf(candidates.entries),
    appearances: candidates.appearances,
    estimatedTokens: candidates.estimatedTokens,
    watermarkTokens,
    deficitTokens,
    evicted,
    pagesDropped,
  }
}
