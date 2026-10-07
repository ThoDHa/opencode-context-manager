import { randomUUID } from "node:crypto"
import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { PLUGIN_ID } from "./schema.ts"

import type { ChatParamsModel, ContextLimitEntry } from "./context-limits.ts"
import {
  CONTEXT_TOKENS_SOURCE_UNKNOWN,
  chatParamsHookBody,
  contextLimitForRun,
} from "./context-limits.ts"
import type { MessageBundle } from "./messages.ts"
import type { ContextManagerOptions, ResolvedOptions } from "./options.ts"
import type { HotSubject, Subject } from "./vocabulary.ts"
import {
  ATTACHMENT_MIME_KEY,
  ATTACHMENT_URL_KEY,
  attachmentPayloadCharsOf,
  estimateTokens,
  hotFromIndexOf,
  nonEmptyAttachmentsOf,
  runCompositionOf,
  stripStateAttachments,
} from "./messages.ts"
import {
  ADVISORY_SUBJECTS_BOUND,
  isPatternProtected,
  isProtectedTool,
  resolveOptions,
} from "./options.ts"
import {
  FALLBACK_SESSION_KEY,
  rememberFaultForSubject,
  rememberSessionValue,
  sessionIDFromContext,
  sessionKeyFromContext,
  touchMapEntry,
  trimMapToBound,
} from "./session-maps.ts"
import {
  BASH_TOOL_NAME,
  boundedSingleLineOf,
  buildOutputDigest,
  buildReloadPointer,
  buildTombstone,
  DEDUP_MARKER,
  EVICTION_MARKER,
  HINT_LINE_PREFIX,
  JSON_INDENT_SPACES,
  LEGACY_DEDUP_MARKER,
  LEGACY_EVICTION_MARKER,
  LEGACY_HINT_LINE_PREFIX,
  orderedRenderedSubjectsOf,
  RECALL_TOOL_NAME,
  renderSubject,
  startsWithEitherGeneration,
  SUBJECT_SEPARATOR,
  subjectsOf,
  UNKNOWN_TARGET_LABEL,
} from "./vocabulary.ts"
import type {
  AdvisoryResult,
  DryRunResult,
  EvictedEntryInfo,
  EvictionResult,
  MetricsHydration,
  MetricsStore,
  PersistedTotals,
  ReasoningExpiry,
  RetentionBreakdown,
  RunOutcome,
  SessionMetrics,
  ToolAppearance,
} from "./state.ts"
import {
  appearanceTouches,
  countFaults,
  countUniqueDedupedPairs,
  createSessionMetrics,
  DEFAULT_REMEMBERED_FAULT_SUBJECTS,
  metricsForSession,
  recordRunOutcome,
  rememberError,
  totalsOf,
} from "./state.ts"
import type { PruneThrottle } from "./persistence.ts"
import {
  appendHygieneCopy,
  migrateLegacyDefaultPaths,
  newestPersistedTotalsOf,
  PRUNE_SCAN_NEVER,
  recordMetricsLine,
  recordSessionCheckpoint,
} from "./persistence.ts"
import type { PageEntry, PageStoreBySession, PageStoreGuard, SessionPageStore } from "./page-store.ts"
import { pagesForSession, pageStoreMatchesFor, recordPageStoreLines, storeEvictedPage } from "./page-store.ts"
import { deduplicateFileAttachments, deduplicateToolOutputs } from "./dedup.ts"
import type { HygieneCadenceBySession } from "./hygiene.ts"
import { expireAgedReasoning, fireCollapsePass, purgeErroredToolInputs, REASONING_EXPIRY_NONE, resolveHygieneBatch, stripLegacyHintParts, stripTerminalNoiseFrom } from "./hygiene.ts"
import { evictLargeUserFences } from "./fences.ts"

export { ADVISORY_BAND_RATIO_DEFAULT, DEFAULT_INGESTION_HYGIENE_ROTATION_MAX_BYTES, DEFAULT_METRICS_ROTATION_MAX_BYTES, DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES } from "./options.ts"
export { METRIC_NUMBER_KEYS, METRICS_CURSOR_KEYS, RAW_COUNTER_KEYS } from "./state.ts"
export type { MetricsCursorKey } from "./state.ts"
export { PAGE_STORE_SCHEMA_VERSION } from "./page-store.ts"

// Cache-aware hint hysteresis: a subject enters the stable line only after
// HINT_ENTRY_TOUCHES accumulated live touches and leaves only after
// HINT_EXIT_MISSES consecutive runs without one; entry strictly exceeding
// exit keeps a flapping subject from rewriting the line it just left.
const HINT_ENTRY_TOUCHES = 3
const HINT_EXIT_MISSES = 2
const RECALL_ARG_NAME = "subject"
const RECALL_PROBE_ARG_NAME = "countsOnly"
const RECALL_PROBE_ARG_SCHEMA_TYPE = "boolean"
const RECALL_PROBE_ARG_DESCRIPTION =
  "Set true to price the reload before paying for it: match counts return instead of any content and nothing is counted"
const RECALL_TOOL_DESCRIPTION =
  "Return the full original content of anything the Context Manager evicted and stored in the page store: a tool call output or a fenced code block from an old user message. Pass the subject exactly as it appears in the eviction notice. Pass countsOnly true to price the reload first: a counts-only summary (match counts, newest-match bytes, attachments-present flag) returns instead of any content, with no counter or fault side effects."
const RECALL_ARG_DESCRIPTION = "The subject exactly as named in the eviction notice"
const RECALL_ARG_SCHEMA_TYPE = "string"
const RECALL_ARG_SCHEMA: Record<string, string> = {
  type: RECALL_ARG_SCHEMA_TYPE,
  description: RECALL_ARG_DESCRIPTION,
}
const RECALL_PROBE_ARG_SCHEMA: Record<string, string> = {
  type: RECALL_PROBE_ARG_SCHEMA_TYPE,
  description: RECALL_PROBE_ARG_DESCRIPTION,
}
const RECALL_PROBE_LEAD = "counts-only probe for"
const RECALL_PROBE_IN_SESSION_LABEL = "in-session matches"
const RECALL_PROBE_PAGE_STORE_LABEL = "page-store matches"
const RECALL_PROBE_NEWEST_LABEL = "newest match"
const RECALL_PROBE_BYTES_UNIT = "bytes"
const RECALL_PROBE_OLDER_LABEL = "older matches"
const RECALL_PROBE_ATTACHMENTS_LABEL = "attachments present"
const STASH_MARKER = "[ctx-stash]"
const STASH_OLDER_LEAD = "older pages in this session for subject"
const STASH_MESSAGE_LABEL = "at message"
const STASH_MATCH_SEPARATOR = "; "
const STASH_MISS_LEAD = "no page in this session for subject"
const STASH_MISS_HINT = "only pages evicted during this session are stored"
const STASH_OCCUPANCY_LEAD = "session page store holds"
const STASH_OCCUPANCY_EMPTY_TAIL = "nothing from this session"
const STASH_OCCUPANCY_ENTRY_LABEL = "entry"
const STASH_OCCUPANCY_ENTRIES_LABEL = "entries"
const STASH_OCCUPANCY_SUBJECT_LABEL = "subject"
const STASH_OCCUPANCY_SUBJECTS_LABEL = "subjects"
const STASH_OCCUPANCY_CATEGORY_SEPARATOR = ", "
const STASH_OCCUPANCY_OVERFLOW_LABEL = "more"
const STASH_OCCUPANCY_RANGE_OLDEST_LABEL = "oldest"
const STASH_OCCUPANCY_RANGE_NEWEST_LABEL = "newest"
const MAX_OCCUPANCY_CATEGORIES = 5
const STASH_INVALID_SUBJECT_LEAD = "requires a non-empty subject string"
const PAGE_STORE_RESTORED_LEAD = "restored from the page store"
const PAGE_STORE_RESTORED_LINE = `${STASH_MARKER} ${PAGE_STORE_RESTORED_LEAD}.`
const PAGE_STORE_OLDER_LEAD = "older pages for subject"
const PAGE_STORE_MISS_LEAD = "no prior-session page for subject"
const RECEIVED_LABEL = "received"
const TOOL_ERROR_PREFIX = "[ctx-error] "
// How many messages of eviction deferral one recorded fault buys a subject
// in the candidate sort: a reloaded output is demonstrably needed again, so
// it re-evicts five messages later than its recency alone would place it.
const FAULT_PENALTY_MESSAGES = 5
const DESCRIBE_TOOL_NAME = "describe"
const DESCRIBE_TOOL_DESCRIPTION =
  "Return live metrics for the Context Manager in this session: eviction counters, expired reasoning counts, faults (post-eviction re-references of evicted subjects), session page store occupancy, the effective context limit and its headroom, and the most recent transform run's token estimate; also the newest run's declared omissions (tool evictions, expired reasoning parts, evicted fenced blocks) with the recall reload pointer when one exists, the newest run's retention audit over the live tool-output pool when one exists, the manual-mode dry run when armed, the newest run's advisory pressure-band preview when the estimate enters the band, the newest run's post-transform composition (tool outputs, text, retained reasoning), the echoed option surface including charsPerToken, the remembered-evicted-subjects bound, and the protected tools and patterns, and the last transform error when one occurred."
const OMISSIONS_REPORT_KEY = "omissions"
const OMISSIONS_TOOL_EVICTIONS_FIELD = "toolEvictions"
const OMISSIONS_REASONING_PARTS_FIELD = "reasoningParts"
const OMISSIONS_FENCE_BLOCKS_FIELD = "fenceBlocks"
const OMISSIONS_RELOAD_TOOL_FIELD = "reloadTool"
const OMISSIONS_LINE_LEAD = "standing omissions: "
const RETENTION_REPORT_KEY = "retention"
const RETENTION_POOL_FIELD = "pool"
const RETENTION_REASONS_FIELD = "reasons"
const RETENTION_FAULT_SHIFT_FIELD = "faultShieldedShiftMessages"
const OMISSIONS_TOOL_OUTPUTS_LABEL = "tool outputs"
const OMISSIONS_REASONING_BLOCKS_LABEL = "reasoning blocks"
const OMISSIONS_FENCED_BLOCKS_LABEL = "fenced blocks"
const OMISSIONS_RELOAD_LEAD = "; reload via "
const STASH_ATTACHMENTS_LEAD = "attachments evicted with this output"
const STASH_ATTACHMENT_DROPPED_TAIL = "payloads were dropped during eviction; re-run the tool to regenerate them"
const UNKNOWN_ATTACHMENT_MIME_LABEL = "unknown mime"

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

type StatsSource = {
  options: ResolvedOptions
  limits: Map<string, ContextLimitEntry>
  modelKeys: Map<string, string | undefined>
  pageStores: PageStoreBySession
  metrics: MetricsStore
}

const pageMissTextFor = (subject: string): string =>
  `${STASH_MARKER} ${STASH_MISS_LEAD} "${subject}"; ${STASH_MISS_HINT}.`

const pageStoreOccupancyLineFor = (pageStore: SessionPageStore): string => {
  if (pageStore.size === 0) return `${STASH_MARKER} ${STASH_OCCUPANCY_LEAD} ${STASH_OCCUPANCY_EMPTY_TAIL}.`
  const categoryCounts = new Map<string, number>()
  const subjects = new Set<string>()
  let oldest = Number.POSITIVE_INFINITY
  let newest = Number.NEGATIVE_INFINITY
  for (const entry of pageStore.values()) {
    categoryCounts.set(entry.tool, (categoryCounts.get(entry.tool) ?? 0) + 1)
    subjects.add(entry.subject)
    oldest = Math.min(oldest, entry.msgIndex)
    newest = Math.max(newest, entry.msgIndex)
  }
  const categories = [...categoryCounts.keys()].sort()
  const shown = categories.slice(0, MAX_OCCUPANCY_CATEGORIES)
  const overflowCount = categories.length - shown.length
  const categoryList = shown
    .map((tool) => `${tool} ${categoryCounts.get(tool)}`)
    .concat(overflowCount > 0 ? `+${overflowCount} ${STASH_OCCUPANCY_OVERFLOW_LABEL}` : [])
    .join(STASH_OCCUPANCY_CATEGORY_SEPARATOR)
  const range =
    pageStore.size === 1
      ? `${STASH_MESSAGE_LABEL} ${oldest}`
      : `${STASH_OCCUPANCY_RANGE_OLDEST_LABEL} ${STASH_MESSAGE_LABEL} ${oldest}, ${STASH_OCCUPANCY_RANGE_NEWEST_LABEL} ${STASH_MESSAGE_LABEL} ${newest}`
  const entryNoun = pageStore.size === 1 ? STASH_OCCUPANCY_ENTRY_LABEL : STASH_OCCUPANCY_ENTRIES_LABEL
  const subjectNoun = subjects.size === 1 ? STASH_OCCUPANCY_SUBJECT_LABEL : STASH_OCCUPANCY_SUBJECTS_LABEL
  return `${STASH_MARKER} ${STASH_OCCUPANCY_LEAD} ${pageStore.size} ${entryNoun} across ${subjects.size} ${subjectNoun}: ${categoryList}; ${range}.`
}

const invalidSubjectTextFor = (received: string): string =>
  `${STASH_MARKER} ${RECALL_TOOL_NAME} ${STASH_INVALID_SUBJECT_LEAD} (${RECEIVED_LABEL} ${received}).`

const olderMatchesLineFor = (subject: string, older: PageEntry[]): string =>
  `${STASH_MARKER} ${STASH_OLDER_LEAD} "${subject}": ${older
    .map((entry) => `${entry.tool} ${STASH_MESSAGE_LABEL} ${entry.msgIndex}`)
    .join(STASH_MATCH_SEPARATOR)}`

const pageMatchesFor = (pageStore: SessionPageStore, subject: string): PageEntry[] => {
  const matches: PageEntry[] = []
  for (const entry of pageStore.values()) {
    if (entry.subject === subject) matches.push(entry)
  }
  return matches
}

const attachmentSummaryOf = (attachment: unknown): string => {
  const fields = typeof attachment === "object" && attachment !== null ? (attachment as Record<string, unknown>) : {}
  const mime = fields[ATTACHMENT_MIME_KEY]
  const url = fields[ATTACHMENT_URL_KEY]
  const mimeLabel = typeof mime === "string" && mime.length > 0 ? mime : UNKNOWN_ATTACHMENT_MIME_LABEL
  const uriChars = typeof url === "string" ? url.length : 0
  return `${mimeLabel} data URI ${uriChars} chars`
}

const pageAttachmentsLineFor = (attachments: unknown[]): string =>
  `${STASH_MARKER} ${STASH_ATTACHMENTS_LEAD}: ${attachments.map(attachmentSummaryOf).join(SUBJECT_SEPARATOR)}; ${STASH_ATTACHMENT_DROPPED_TAIL}.`

const pageStoreOlderLineFor = (subject: string, count: number): string =>
  `${STASH_MARKER} ${PAGE_STORE_OLDER_LEAD} "${subject}": ${count}.`

const pageStoreMissLineFor = (subject: string): string => `${STASH_MARKER} ${PAGE_STORE_MISS_LEAD} "${subject}".`

const missResponseFor = (subject: string, pageStore: SessionPageStore | undefined): string =>
  `${pageMissTextFor(subject)}\n${pageStoreOccupancyLineFor(pageStore ?? new Map())}\n${pageStoreMissLineFor(subject)}`

// The counts-only summary a probe hit returns: match counts and sizes read
// straight off the matches the full reload would walk, no content copied.
const probeCountsLineFor = (subject: string, inSessionMatches: number, pageStoreMatches: number, matches: PageEntry[]): string => {
  const newest = matches[matches.length - 1]
  return `${STASH_MARKER} ${RECALL_PROBE_LEAD} "${subject}": ${RECALL_PROBE_IN_SESSION_LABEL} ${inSessionMatches}, ${RECALL_PROBE_PAGE_STORE_LABEL} ${pageStoreMatches}, ${RECALL_PROBE_NEWEST_LABEL} ${newest.output.length} ${RECALL_PROBE_BYTES_UNIT}, ${RECALL_PROBE_OLDER_LABEL} ${matches.length - 1}, ${RECALL_PROBE_ATTACHMENTS_LABEL}: ${newest.attachments !== undefined}.`
}

const executeReadEvicted = async (
  pageStores: PageStoreBySession,
  metrics: MetricsStore,
  hydrations: MetricsHydration,
  persistedTotalsForSession: (sessionKey: string) => Promise<PersistedTotals | undefined>,
  metricsSessionBound: number,
  options: ResolvedOptions,
  args: unknown,
  toolContext: unknown,
  pageStoreGuard: PageStoreGuard,
): Promise<string> => {
  const source = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : undefined
  const subject = source?.[RECALL_ARG_NAME]
  if (typeof subject !== "string" || subject.length === 0) return invalidSubjectTextFor(typeof subject)
  const countsOnly = source?.[RECALL_PROBE_ARG_NAME] === true
  const sessionKey = sessionKeyFromContext(toolContext)
  const pageStore = pageStores.get(sessionKey)
  const matches = pageStore === undefined ? [] : pageMatchesFor(pageStore, subject)
  if (matches.length === 0) {
    const pages = await pageStoreMatchesFor(options, subject, pageStoreGuard, metrics, sessionKey)
    if (pages.length === 0) {
      // The probe's miss answers exactly today's miss text without the
      // hydration await or the recallMisses increment, so counters and
      // hydration stay untouched; the walk above can still observe a
      // newer-schema line, which is the refusal contract firing, not a
      // probe leak into eviction ordering.
      if (countsOnly) return missResponseFor(subject, pageStore)
      // A first-touch hydration may still be seeding this session: await it
      // so the miss lands on the settled entry instead of vanishing with the
      // entry the seed replaces.
      const inFlight = hydrations.get(sessionKey)
      if (inFlight !== undefined) await inFlight.promise
      const existing = metrics.get(sessionKey)
      if (existing !== undefined) existing.recallMisses += 1
      return missResponseFor(subject, pageStore)
    }
    // The probe returns before the recall hit increment and the fault
    // record: fault counts feed the eviction sort key through
    // faultAdjustedLastTouchOf, so probe side effects would leak into
    // eviction ordering.
    if (countsOnly) return probeCountsLineFor(subject, 0, pages.length, pages)
    // A page-store hit counts and fault-protects exactly like an in-session
    // hit: the reload is the same event to the eviction policy.
    const sessionMetrics = await metricsForSession(metrics, hydrations, persistedTotalsForSession, sessionKey, metricsSessionBound)
    sessionMetrics.recallHits += 1
    rememberFaultForSubject(sessionMetrics.faultCounts, subject, DEFAULT_REMEMBERED_FAULT_SUBJECTS)
    const newest = pages[pages.length - 1]
    const olderCount = pages.length - 1
    const restored = `${newest.output}\n${PAGE_STORE_RESTORED_LINE}`
    const withOlder = olderCount === 0 ? restored : `${restored}\n${pageStoreOlderLineFor(subject, olderCount)}`
    return newest.attachments === undefined ? withOlder : `${withOlder}\n${pageAttachmentsLineFor(newest.attachments)}`
  }
  if (countsOnly) return probeCountsLineFor(subject, matches.length, 0, matches)
  // Refreshed before the await so the hit counts even if stash churn during
  // the hydration read evicts this session's stash entry.
  touchMapEntry(pageStores, sessionKey)
  const sessionMetrics = await metricsForSession(metrics, hydrations, persistedTotalsForSession, sessionKey, metricsSessionBound)
  sessionMetrics.recallHits += 1
  rememberFaultForSubject(sessionMetrics.faultCounts, subject, DEFAULT_REMEMBERED_FAULT_SUBJECTS)
  const newest = matches[matches.length - 1]
  const older = matches.slice(0, -1)
  const output = older.length === 0 ? newest.output : `${newest.output}\n${olderMatchesLineFor(subject, older)}`
  return newest.attachments === undefined ? output : `${output}\n${pageAttachmentsLineFor(newest.attachments)}`
}

// The effective eviction watermark in tokens: the absolute watermarkTokens
// option wins when set; otherwise the budget times the fractional
// watermark. The budget drives the fractional path only, so an absolute
// watermark can engage even where no budget was captured (unknown-budget
// runs otherwise stand eviction down entirely).
const effectiveWatermarkTokensOf = (contextLimitTokens: number | null, options: ResolvedOptions): number | null => {
  if (options.watermarkTokens !== undefined) return options.watermarkTokens
  if (contextLimitTokens === null) return null
  return contextLimitTokens * options.watermark
}

const executeStatsTool = (source: StatsSource, toolContext: unknown): string => {
  const sessionKey = sessionKeyFromContext(toolContext)
  const sessionID = sessionIDFromContext(toolContext)
  const sessionLimit = sessionID === undefined ? undefined : touchMapEntry(source.limits, sessionID)
  const metrics = touchMapEntry(source.metrics, sessionKey) ?? createSessionMetrics()
  const { contextLimit } = contextLimitForRun(sessionLimit, metrics.persistedBudget, sessionID === undefined ? undefined : source.modelKeys.get(sessionID), source.options)
  const pageStore = source.pageStores.get(sessionKey)
  const report = {
    session: sessionKey,
    options: {
      watermark: source.options.watermark,
      watermarkTokens: source.options.watermarkTokens ?? null,
      recentWindow: source.options.recentWindow,
      reasoningRetentionMessages: source.options.reasoningRetentionMessages,
      minEvictableBytes: source.options.minEvictableBytes,
      defaultContextTokens: source.options.defaultContextTokens ?? null,
      agedReadEvictionMessages: source.options.agedReadEvictionMessages ?? null,
      modelContextTokens: source.options.modelContextTokens,
      metricsLog: source.options.metricsLog,
      metricsPath: source.options.metricsPath,
      metricsRotationMaxBytes: source.options.metricsRotationMaxBytes,
      metricsMinLineIntervalMs: source.options.metricsMinLineIntervalMs,
      ingestionHygiene: source.options.ingestionHygiene,
      ingestionHygieneCopy: source.options.ingestionHygieneCopy,
      ingestionHygienePath: source.options.ingestionHygienePath,
      ingestionHygieneRotationMaxBytes: source.options.ingestionHygieneRotationMaxBytes,
      pageStore: source.options.pageStore,
      pageStorePath: source.options.pageStorePath,
      pageStoreRotationMaxBytes: source.options.pageStoreRotationMaxBytes,
      liveStateLog: source.options.liveStateLog,
      liveStatePath: source.options.liveStatePath,
      liveStatePruneMaxAgeMs: source.options.liveStatePruneMaxAgeMs,
      liveStatePruneMinIntervalMs: source.options.liveStatePruneMinIntervalMs,
      userFenceEviction: {
        enabled: source.options.userFenceEviction.enabled,
        minBlockLines: source.options.userFenceEviction.minBlockLines,
      },
      manualMode: source.options.manualMode,
      advisoryBand: source.options.advisoryBand,
      advisoryBandRatio: source.options.advisoryBandRatio,
      charsPerToken: source.options.charsPerToken,
      rememberedEvictedSubjects: source.options.rememberedEvictedSubjects,
      protectedTools: source.options.protectedTools,
      protectedPatterns: source.options.protectedPatternSources,
    },
    contextLimit: contextLimit.tokens,
    contextLimitSource: contextLimit.source,
    headroomTokens: contextLimit.tokens !== null && metrics.lastRun !== undefined ? contextLimit.tokens - metrics.lastRun.estimatedTokens : null,
    pageStore: { entries: pageStore === undefined ? 0 : pageStore.size, capacity: source.options.stashLimit },
    counters: totalsOf(metrics, source.options.charsPerToken),
    lastRun: metrics.lastRun ?? null,
    ...(metrics.lastOmissions === undefined
      ? {}
      : {
          [OMISSIONS_REPORT_KEY]: {
            [OMISSIONS_TOOL_EVICTIONS_FIELD]: metrics.lastOmissions.toolEvictions,
            [OMISSIONS_REASONING_PARTS_FIELD]: metrics.lastOmissions.reasoningParts,
            [OMISSIONS_FENCE_BLOCKS_FIELD]: metrics.lastOmissions.fenceBlocks,
            [OMISSIONS_RELOAD_TOOL_FIELD]: RECALL_TOOL_NAME,
          },
        }),
    ...(metrics.lastRetention === undefined || metrics.lastRetention.pool === 0
      ? {}
      : {
          [RETENTION_REPORT_KEY]: {
            [RETENTION_POOL_FIELD]: metrics.lastRetention.pool,
            [RETENTION_REASONS_FIELD]: metrics.lastRetention.reasons,
            [RETENTION_FAULT_SHIFT_FIELD]: metrics.lastRetention.faultShieldedShiftMessages,
          },
        }),
    ...(metrics.lastDryRun === undefined
      ? {}
      : {
          dryRun: {
            deficitTokens: metrics.lastDryRun.deficitTokens,
            wouldEvictCount: metrics.lastDryRun.wouldEvictCount,
            wouldEvictBytes: metrics.lastDryRun.wouldEvictBytes,
            wouldEvictSubjects: metrics.lastDryRun.wouldEvictSubjects.slice(0, source.options.rememberedEvictedSubjects),
          },
        }),
    ...(metrics.lastAdvisory === undefined ? {} : { advisory: metrics.lastAdvisory }),
    ...(metrics.lastComposition === undefined
      ? {}
      : {
          composition: {
            toolPoolBytes: metrics.lastComposition.toolPoolBytes,
            textChars: metrics.lastComposition.textChars,
            reasoningInWindowBytes: metrics.lastComposition.reasoningInWindowBytes,
            escapeBytes: metrics.lastComposition.escapeBytes,
            attachmentBytes: metrics.lastComposition.attachmentBytes,
          },
        }),
    ...(metrics.lastError === undefined
      ? {}
      : { lastError: { message: metrics.lastError.message, at: new Date(metrics.lastError.atMs).toISOString() } }),
    ...(metrics.logWriteError === undefined ? {} : { logWriteError: metrics.logWriteError }),
    ...(metrics.stateWriteError === undefined ? {} : { stateWriteError: metrics.stateWriteError }),
    ...(metrics.hygieneWriteError === undefined ? {} : { hygieneWriteError: metrics.hygieneWriteError }),
    ...(metrics.pageStoreWriteError === undefined ? {} : { pageStoreWriteError: metrics.pageStoreWriteError }),
    ...(metrics.pageStoreSchemaError === undefined ? {} : { pageStoreSchemaError: metrics.pageStoreSchemaError }),
  }
  return JSON.stringify(report, null, JSON_INDENT_SPACES)
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

const evictionCandidatesOf = (messages: MessageBundle[], options: ResolvedOptions, faultCounts: Map<string, number>): EvictionCandidates => {
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
const retentionBreakdownOf = (candidates: EvictionCandidates, messages: MessageBundle[], options: ResolvedOptions, faultCounts: Map<string, number>): RetentionBreakdown => {
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
const measureWithoutEvicting = (candidates: EvictionCandidates, watermarkTokens: number | null): EvictionResult => {
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
const measureAdvisory = (candidates: EvictionCandidates, effectiveWatermarkTokens: number | null, options: ResolvedOptions): AdvisoryResult | undefined => {
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
const measureDryRun = (
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

const evictLeastRecentlyUsed = (
  messages: MessageBundle[],
  candidates: EvictionCandidates,
  options: ResolvedOptions,
  watermarkTokens: number | null,
  pageStore: SessionPageStore,
  pageStoreEntries: PageEntry[],
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

const buildHintLine = (hotSubjects: HotSubject[], limit: number): string | undefined => {
  const rendered = orderedRenderedSubjectsOf(hotSubjects, limit)
  if (rendered.length === 0) return undefined
  return `${HINT_LINE_PREFIX} ${rendered.join(SUBJECT_SEPARATOR)}`
}

const storeHint = (hintBySession: Map<string, string>, sessionKey: string, hotSubjects: HotSubject[], limit: number, sessionBound: number): void => {
  if (limit <= 0) return
  const hintLine = buildHintLine(hotSubjects, limit)
  if (hintLine !== undefined) rememberSessionValue(hintBySession, sessionKey, hintLine, sessionBound)
}

// One subject identifier's stable-membership state for the cache-aware
// hint line: accumulated live touches, consecutive runs without a live
// entry, and whether the identifier currently renders.
type HintMembershipState = { touches: number; missRun: number; member: boolean }

type HintMembershipBySession = Map<string, Map<string, HintMembershipState>>

// The stable line's subject identity: the bounded path alone, so the
// per-read range numerals never enter the rendered bytes and two reads of
// one file at different ranges hold one seat.
const stableHintIdentifierOf = (subject: Subject): string => boundedSingleLineOf(subject.path)

const hintMembershipFor = (membershipBySession: HintMembershipBySession, sessionKey: string, sessionBound: number): Map<string, HintMembershipState> => {
  const touched = touchMapEntry(membershipBySession, sessionKey)
  if (touched !== undefined) return touched
  trimMapToBound(membershipBySession, sessionBound)
  const created: Map<string, HintMembershipState> = new Map()
  membershipBySession.set(sessionKey, created)
  return created
}

// One transform run's membership movement: live touches accumulate and
// clear the miss run, absent runs accrue misses and drop a member only at
// the exit bound, and an identifier that has left (or never entered and
// gone stale) releases its state so the map holds only members and entry
// candidates.
const updateHintMembership = (membership: Map<string, HintMembershipState>, hotSubjects: HotSubject[]): void => {
  const touchesByIdentifier = new Map<string, number>()
  for (const { subject } of hotSubjects) {
    const identifier = stableHintIdentifierOf(subject)
    touchesByIdentifier.set(identifier, (touchesByIdentifier.get(identifier) ?? 0) + 1)
  }
  for (const [identifier, state] of membership) {
    const touches = touchesByIdentifier.get(identifier) ?? 0
    if (touches > 0) {
      state.touches += touches
      state.missRun = 0
      if (!state.member && state.touches >= HINT_ENTRY_TOUCHES) state.member = true
    } else {
      state.missRun += 1
      if (state.member && state.missRun >= HINT_EXIT_MISSES) state.member = false
    }
    if (!state.member && state.missRun >= HINT_EXIT_MISSES) membership.delete(identifier)
  }
  for (const [identifier, touches] of touchesByIdentifier) {
    if (membership.has(identifier)) continue
    membership.set(identifier, { touches, missRun: 0, member: touches >= HINT_ENTRY_TOUCHES })
  }
}

// Members in code-unit order, not locale order and not touch recency, so
// the rendered bytes are a pure function of membership.
const buildStableHintLine = (membership: Map<string, HintMembershipState>, limit: number): string | undefined => {
  if (limit <= 0) return undefined
  const members = [...membership].filter(([, state]) => state.member).map(([identifier]) => identifier)
  if (members.length === 0) return undefined
  members.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return `${HINT_LINE_PREFIX} ${members.slice(0, limit).join(SUBJECT_SEPARATOR)}`
}

const storeStableHint = (
  hintBySession: Map<string, string>,
  membershipBySession: HintMembershipBySession,
  sessionKey: string,
  hotSubjects: HotSubject[],
  limit: number,
  sessionBound: number,
): void => {
  if (limit <= 0) return
  const membership = hintMembershipFor(membershipBySession, sessionKey, sessionBound)
  updateHintMembership(membership, hotSubjects)
  const hintLine = buildStableHintLine(membership, limit)
  if (hintLine !== undefined) rememberSessionValue(hintBySession, sessionKey, hintLine, sessionBound)
}

// The compaction-prompt enrichment: when the host's native compaction
// fires, append a compact block carrying the session's remembered evicted
// subjects (sharing the hint line's newest-first order and hintSubjects
// bound, not its membership: the hint renders live subjects, this renders
// remembered evicted subjects) and, when the session stash holds
// reloadable outputs, a one-line note naming the newest stashed subjects
// through recall. Appends context strings only; the native prompt
// is never replaced, and an unknown session attaches nothing.
const COMPACTION_BLOCK_MARKER = "[ctx]"
const compactionContextFor = (metricsEntry: SessionMetrics | undefined, pageStore: SessionPageStore | undefined, limit: number): string[] => {
  if (metricsEntry === undefined) return []
  const hotSubjects = orderedRenderedSubjectsOf(metricsEntry.evictedSubjects.map((subject, index) => ({ subject, lastTouch: index })), limit)
  const context: string[] = []
  if (hotSubjects.length > 0) context.push(`${HINT_LINE_PREFIX} ${hotSubjects.join(SUBJECT_SEPARATOR)}`)
  // slice(-0) is slice(0), the whole store, so the bound must be checked
  // here instead of trusted to slice; 0 disables subject rendering for the
  // hint line and disables the store note with it.
  if (limit > 0 && pageStore !== undefined && pageStore.size > 0) {
    const entries = [...pageStore.values()]
    const newestSubjects: string[] = []
    const seenSubjects = new Set<string>()
    for (let index = entries.length - 1; index >= 0 && newestSubjects.length < limit; index -= 1) {
      const subject = entries[index].subject
      if (seenSubjects.has(subject)) continue
      seenSubjects.add(subject)
      newestSubjects.push(subject)
    }
    context.push(`${COMPACTION_BLOCK_MARKER} tombstoned outputs remain reloadable via the ${RECALL_TOOL_NAME} tool; newest subjects: ${newestSubjects.join(SUBJECT_SEPARATOR)}`)
  }
  const omissions = metricsEntry.lastOmissions
  if (omissions !== undefined && (omissions.toolEvictions > 0 || omissions.reasoningParts > 0 || omissions.fenceBlocks > 0)) {
    context.push(
      `${COMPACTION_BLOCK_MARKER} ${OMISSIONS_LINE_LEAD}${omissions.toolEvictions} ${OMISSIONS_TOOL_OUTPUTS_LABEL}, ${omissions.reasoningParts} ${OMISSIONS_REASONING_BLOCKS_LABEL}, ${omissions.fenceBlocks} ${OMISSIONS_FENCED_BLOCKS_LABEL}${OMISSIONS_RELOAD_LEAD}${RECALL_TOOL_NAME}`,
    )
  }
  return context
}

const deliverHint = (hintBySession: Map<string, string>, input: unknown, output: { system: string[] }): void => {
  if (!Array.isArray(output.system)) return
  const sessionKey = sessionKeyFromContext(input)
  const hintLine = touchMapEntry(hintBySession, sessionKey)
  if (hintLine === undefined) return
  const existingIndex = output.system.findIndex((block) => typeof block === "string" && startsWithEitherGeneration(block, HINT_LINE_PREFIX, LEGACY_HINT_LINE_PREFIX))
  if (existingIndex === -1) output.system.push(hintLine)
  else output.system[existingIndex] = hintLine
}

// The transform hook's body, extracted so the registration-site boundary
// can wrap it in fault isolation. Everything it needs rides the deps
// object (the plugin instance's per-process stores plus resolved
// options); nothing mutates state outside them.
type TransformHookDeps = {
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
}

const transformHookBody = async (messages: MessageBundle[], deps: TransformHookDeps): Promise<void> => {
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
    : evictLeastRecentlyUsed(messages, candidates, options, effectiveWatermarkTokens, sessionPageStore, pageStoreEntries)
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

// A throwing tool degrades to a structured error string the TUI can
// render, never a raw throw into the host's tool dispatcher.
const guardTool = (tool: (args: unknown, toolContext: unknown) => Promise<string>) => {
  return async (args: unknown, toolContext: unknown): Promise<string> => {
    try {
      return await tool(args, toolContext)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `${TOOL_ERROR_PREFIX}${message}`
    }
  }
}

const server = (async (_input, rawOptions) => {
  const raw = (rawOptions ?? {}) as ContextManagerOptions
  await migrateLegacyDefaultPaths(raw)
  const options = resolveOptions(raw)
  const contextLimits = new Map<string, ContextLimitEntry>()
  const modelKeyBySession = new Map<string, string | undefined>()
  const pageStoreBySession = new Map<string, SessionPageStore>()
  const hintBySession = new Map<string, string>()
  const hintMembershipBySession: HintMembershipBySession = new Map()
  const hygieneCadenceBySession: HygieneCadenceBySession = new Map()
  const metricsBySession: MetricsStore = new Map()
  const metricsHydrationBySession: MetricsHydration = new Map()
  const pruneThrottle: PruneThrottle = { lastScanMs: PRUNE_SCAN_NEVER }
  const pluginSession = randomUUID()
  const pageStoreGuard: PageStoreGuard = { newerSchemaObserved: false }
  const persistedTotalsForSession = (sessionKey: string): Promise<PersistedTotals | undefined> =>
    newestPersistedTotalsOf(options, sessionKey)
  // Hoisted per plugin instance: every run passes the same deps object to
  // the extracted transform body instead of rebuilding the literal per run.
  const transformHookDeps: TransformHookDeps = {
    contextLimits,
    modelKeyBySession,
    metricsBySession,
    metricsHydrationBySession,
    persistedTotalsForSession,
    pageStoreBySession,
    hintBySession,
    hintMembershipBySession,
    hygieneCadenceBySession,
    pruneThrottle,
    pluginSession,
    pageStoreGuard,
    options,
  }

  // Workaround: recall and describe are registered as plain
  // { description, args, execute } definitions instead of calling tool() from
  // @opencode-ai/plugin. The package only resolves inside the opencode runtime
   // (Bun follows the deployment symlink to this repository's real path, where
   // no node_modules exists up-tree; the runtime's own copy at
   // ~/.config/opencode/node_modules is off that resolution path), so importing
   // it throws here. The runtime's tool
  // registry (packages/opencode/src/tool/registry.ts, fromPlugin) consumes
  // definition objects directly and derives the JSON schema itself: args values
  // that are not zod schemas take its legacyJsonSchema path, so the plain
  // { type: "string" } schema below is sufficient. If this file ever ships
  // somewhere @opencode-ai/plugin resolves, switch back to tool().
  const recallTool = async (args: unknown, toolContext: unknown): Promise<string> =>
    executeReadEvicted(pageStoreBySession, metricsBySession, metricsHydrationBySession, persistedTotalsForSession, options.metricsSessions, options, args, toolContext, pageStoreGuard)

  const describeTool = async (_args: unknown, toolContext: unknown): Promise<string> =>
    executeStatsTool({ options, limits: contextLimits, modelKeys: modelKeyBySession, pageStores: pageStoreBySession, metrics: metricsBySession }, toolContext)

  return {
    "chat.params": async (input: { sessionID: string; model?: ChatParamsModel }) => {
      try {
        chatParamsHookBody(input, contextLimits, modelKeyBySession, metricsBySession, options)
      } catch {
        // A malformed or hostile chat.params payload degrades to no-op:
        // the session keeps whatever budget state it already had.
      }
    },
    "experimental.chat.messages.transform": async (_input: unknown, output: { messages: MessageBundle[] }) => {
      const messages = output.messages
      if (!Array.isArray(messages) || messages.length === 0) return
      // Resolved inside the try: a hostile messages[0].info accessor is
      // itself a fault on the highest-likelihood path and must hit the
      // boundary, not escape ahead of it. The fallback key names the
      // shared no-session entry for the fault record.
      let sessionKey = FALLBACK_SESSION_KEY
      try {
        sessionKey = sessionKeyFromContext(messages[0]?.info)
        const injectedError = options.errorTransform?.()
        if (typeof injectedError === "string") throw new Error(injectedError)
        await transformHookBody(messages, transformHookDeps)
      } catch (error) {
        // Fault isolation: a plugin bug must never corrupt or block the
        // session. A fault before the body starts leaves the list
        // untouched; a mid-body fault returns the partially applied
        // normal edits (same references, subset of healthy edits) —
        // either way never a corrupted structure — and the failure
        // surfaces through describe.
        const lastError = { message: error instanceof Error ? error.message : String(error), atMs: options.now() }
        rememberError(metricsBySession, sessionKey, lastError, options.metricsSessions)
      }
    },
    "experimental.session.compacting": async (input: { sessionID?: string }, output: { context?: string[] }) => {
      let sessionKey = FALLBACK_SESSION_KEY
      try {
        if (!Array.isArray(output.context)) return
        sessionKey = sessionKeyFromContext(input)
        if (options.errorCompaction !== undefined) options.errorCompaction()
        const context = compactionContextFor(
          touchMapEntry(metricsBySession, sessionKey),
          pageStoreBySession.get(sessionKey),
          options.hintSubjects,
        )
        if (context.length === 0) return
        output.context.push(...context)
      } catch (error) {
        // Fault isolation: compaction proceeds with the native prompt
        // unmodified and the failure surfaces through the diagnostics
        // channel.
        const lastError = { message: error instanceof Error ? error.message : String(error), atMs: options.now() }
        rememberError(metricsBySession, sessionKey, lastError, options.metricsSessions)
      }
    },
    "experimental.chat.system.transform": async (input: { sessionID?: string }, output: { system: string[] }) => {
      try {
        deliverHint(hintBySession, input, output)
      } catch {
        // A hint failure degrades to returning the prompt unchanged: the
        // hint is advisory, never worth blocking a model call over.
      }
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID?: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      let sessionKey = FALLBACK_SESSION_KEY
      try {
        if (!options.ingestionHygiene) return
        if (typeof output.output !== "string") return
        sessionKey = sessionKeyFromContext(input)
        if (options.errorHygiene !== undefined) options.errorHygiene()
        const original = output.output
        const stripped = stripTerminalNoiseFrom(original)
        if (stripped === original) return
        // The copy precedes the rewrite: if the copy path ever threw, the
        // output would reach the boundary untouched instead of half-applied.
        if (options.ingestionHygieneCopy) {
          await appendHygieneCopy(options, metricsBySession, sessionKey, {
            tool: input.tool,
            title: typeof output.title === "string" ? output.title : undefined,
            original,
            stripped,
          })
        }
        output.output = stripped
      } catch (error) {
        // Fault isolation: the tool result proceeds with its original text
        // and the failure surfaces through the diagnostics channel.
        const lastError = { message: error instanceof Error ? error.message : String(error), atMs: options.now() }
        rememberError(metricsBySession, sessionKey, lastError, options.metricsSessions)
      }
    },
    tool: {
      [RECALL_TOOL_NAME]: {
        description: RECALL_TOOL_DESCRIPTION,
        args: { [RECALL_ARG_NAME]: RECALL_ARG_SCHEMA, [RECALL_PROBE_ARG_NAME]: RECALL_PROBE_ARG_SCHEMA },
        execute: guardTool(recallTool),
      },
      [DESCRIBE_TOOL_NAME]: {
        description: DESCRIBE_TOOL_DESCRIPTION,
        args: {},
        execute: guardTool(describeTool),
      },
    },
  }
}) satisfies Plugin

// The v1 object entrypoint: opencode's plugin loader (1.18.29+) reads
// `mod.default` and, on an object carrying `id`/`server`, skips the legacy
// scan that demands every runtime export be a function. The named constant
// exports above are never scanned on this path.
export default { id: PLUGIN_ID, server } satisfies PluginModule
