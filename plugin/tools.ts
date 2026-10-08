import { contextLimitForRun } from "./context-limits.ts"
import type { ContextLimitEntry } from "./context-limits.ts"
import { ATTACHMENT_MIME_KEY, ATTACHMENT_URL_KEY } from "./messages.ts"
import type { ResolvedOptions } from "./options.ts"
import { pageStoreMatchesFor } from "./page-store.ts"
import type { PageEntry, PageStoreBySession, PageStoreGuard, SessionPageStore } from "./page-store.ts"
import { rememberFaultForSubject, sessionIDFromContext, sessionKeyFromContext, touchMapEntry } from "./session-maps.ts"
import { createSessionMetrics, DEFAULT_REMEMBERED_FAULT_SUBJECTS, metricsForSession, totalsOf } from "./state.ts"
import type { MetricsHydration, MetricsStore, PersistedTotals } from "./state.ts"
import { JSON_INDENT_SPACES, RECALL_TOOL_NAME, SUBJECT_SEPARATOR } from "./vocabulary.ts"

export const RECALL_ARG_NAME = "subject"
export const RECALL_PROBE_ARG_NAME = "countsOnly"
const RECALL_PROBE_ARG_SCHEMA_TYPE = "boolean"
const RECALL_PROBE_ARG_DESCRIPTION =
  "Set true to price the reload before paying for it: match counts return instead of any content and nothing is counted"
export const RECALL_TOOL_DESCRIPTION =
  "Return the full original content of anything the Context Manager evicted and stored in the page store: a tool call output or a fenced code block from an old user message. Pass the subject exactly as it appears in the eviction notice. Pass countsOnly true to price the reload first: a counts-only summary (match counts, newest-match bytes, attachments-present flag) returns instead of any content, with no counter or fault side effects."
const RECALL_ARG_DESCRIPTION = "The subject exactly as named in the eviction notice"
const RECALL_ARG_SCHEMA_TYPE = "string"
export const RECALL_ARG_SCHEMA: Record<string, string> = {
  type: RECALL_ARG_SCHEMA_TYPE,
  description: RECALL_ARG_DESCRIPTION,
}
export const RECALL_PROBE_ARG_SCHEMA: Record<string, string> = {
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
export const DESCRIBE_TOOL_NAME = "describe"
export const DESCRIBE_TOOL_DESCRIPTION =
  "Return live metrics for the Context Manager in this session: eviction counters, expired reasoning counts, faults (post-eviction re-references of evicted subjects), session page store occupancy, the effective context limit and its headroom, and the most recent transform run's token estimate; also the newest run's declared omissions (tool evictions, expired reasoning parts, evicted fenced blocks) with the recall reload pointer when one exists, the newest run's retention audit over the live tool-output pool when one exists, the manual-mode dry run when armed, the newest run's advisory pressure-band preview when the estimate enters the band, the newest run's post-transform composition (tool outputs, text, retained reasoning), the echoed option surface including charsPerToken, the remembered-evicted-subjects bound, and the protected tools and patterns, and the last transform error when one occurred."
const OMISSIONS_REPORT_KEY = "omissions"
const OMISSIONS_TOOL_EVICTIONS_FIELD = "toolEvictions"
const OMISSIONS_REASONING_PARTS_FIELD = "reasoningParts"
const OMISSIONS_FENCE_BLOCKS_FIELD = "fenceBlocks"
const OMISSIONS_RELOAD_TOOL_FIELD = "reloadTool"
const RETENTION_REPORT_KEY = "retention"
const RETENTION_POOL_FIELD = "pool"
const RETENTION_REASONS_FIELD = "reasons"
const RETENTION_FAULT_SHIFT_FIELD = "faultShieldedShiftMessages"
const STASH_ATTACHMENTS_LEAD = "attachments evicted with this output"
const STASH_ATTACHMENT_DROPPED_TAIL = "payloads were dropped during eviction; re-run the tool to regenerate them"
const UNKNOWN_ATTACHMENT_MIME_LABEL = "unknown mime"

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

export const executeReadEvicted = async (
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

export const executeStatsTool = (source: StatsSource, toolContext: unknown): string => {
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

// A throwing tool degrades to a structured error string the TUI can
// render, never a raw throw into the host's tool dispatcher.
export const guardTool = (tool: (args: unknown, toolContext: unknown) => Promise<string>) => {
  return async (args: unknown, toolContext: unknown): Promise<string> => {
    try {
      return await tool(args, toolContext)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `${TOOL_ERROR_PREFIX}${message}`
    }
  }
}
