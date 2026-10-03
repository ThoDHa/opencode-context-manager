import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import {
  DEFAULT_LIVE_STATE_DIR_BASENAME,
  DEFAULT_METRICS_DIR_SEGMENTS,
  DEFAULT_METRICS_FILE_BASENAME,
  PLUGIN_ID,
  RAW_COUNTER_KEYS as SCHEMA_RAW_COUNTER_KEYS,
  TOTALS_KEYS,
  type DerivedCounterKey as TotalsDerivedKey,
  type RawCounterKey as SchemaRawCounterKey,
  type TotalsKey,
} from "./schema.ts"

const EVICTION_MARKER = "[ctx-evicted]"
const HINT_MARKER = "[ctx-hot]"
const HINT_LABEL = "recently active:"
const HINT_LINE_PREFIX = `${HINT_MARKER} ${HINT_LABEL}`
// Tombstones, purged-input markers, and hint lines live permanently in
// users' stored session history, so every detector recognizes the
// previous marker generation next to the current one; only emissions use
// the current markers.
const LEGACY_EVICTION_MARKER = "[lru-evicted]"
const LEGACY_DEDUP_MARKER = "[lru-deduped]"
const LEGACY_PURGED_INPUT_MARKER = "[lru-purged-input]"
const LEGACY_HINT_LINE_PREFIX = `[lru-hot] ${HINT_LABEL}`
const startsWithEitherGeneration = (text: string, current: string, legacy: string): boolean =>
  text.startsWith(current) || text.startsWith(legacy)
const SUBJECT_SEPARATOR = ", "
const MAX_RENDERED_SUBJECT_CHARS = 160
const ELLIPSIS_MARKER = "…"
const READ_TOOL_NAME = "read"
const MAX_DIGEST_CHARS = 200
const DIGEST_PIECE_SEPARATOR = " | "
const DIGEST_FIRST_PREVIEW_LABEL = "first"
const DIGEST_LAST_PREVIEW_LABEL = "last"
const DIGEST_HEAD_PREVIEW_LABEL = "head"
const DIGEST_TAIL_PREVIEW_LABEL = "tail"
const NEWLINE_SPLIT_PATTERN = /\r\n|\r|\n/
const DEFAULT_CHARS_PER_TOKEN = 4
const DEFAULT_WATERMARK_RATIO = 0.5
const DEFAULT_RECENT_WINDOW_MESSAGES = 4
const DEFAULT_MIN_EVICTABLE_BYTES = 2048
const DEFAULT_HINT_SUBJECTS = 10
const DEFAULT_PROTECTED_TOOLS = ["task", "todowrite"]
const DEFAULT_PROTECTED_PATTERNS: string[] = []
const PATH_INPUT_KEYS = ["filePath", "path", "file", "directory"]
const GLOB_DOUBLESTAR_TRAILING_SLASH = "**/"
const GLOB_DOUBLESTAR = "**"
const GLOB_SINGLE_STAR = "*"
const GLOB_QUESTION_MARK = "?"
const REGEX_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g
const PATH_SEGMENT_SEPARATOR = "/"
const BASH_TOOL_NAME = "bash"
const COMMAND_INPUT_KEY = "command"
const OFFSET_INPUT_KEY = "offset"
const LIMIT_INPUT_KEY = "limit"
const PATTERN_INPUT_KEY = "pattern"
const DEFAULT_MIN_SUBSTRING_MATCH_CHARS = 3
const UNKNOWN_TARGET_LABEL = "unknown target"
const PATH_RANGE_SEPARATOR = ":"
const RANGE_SEPARATOR = "-"
const DEFAULT_STASH_LIMIT = 50
const DEFAULT_STASH_SESSIONS = 8
const DEFAULT_LIMIT_SESSIONS = 8
const DEFAULT_HINT_SESSIONS = 8
const RECALL_TOOL_NAME = "recall"
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
const RECALL_POINTER_LEAD = " Evicted output stored in the page store; recall it with"
const DIGEST_POINTER_LEAD = " Output digest: "
const DIGEST_POINTER_TAIL = "."
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
const FALLBACK_SESSION_KEY = "no-session"
const DEDUP_MARKER = "[ctx-deduped]"
const TOOL_ERROR_PREFIX = "[ctx-error] "
const DEDUP_SUPERSEDED_LEAD = "identical call superseded by the newer output at message"
const DEDUP_RANGE_SUPERSEDED_LEAD = "range read superseded by the retained range at message"
const DEDUP_FILE_SUPERSEDED_LEAD = "identical attachment superseded by the newer attachment at message"
const FILE_PART_TYPE = "file"
const FILE_FILENAME_KEY = "filename"
const TEXT_PART_TYPE = "text"
const PURGED_INPUT_MARKER = "[ctx-purged-input]"
const REASONING_PART_TYPE = "reasoning"
const REASONING_TEXT_KEY = "text"
const REASONING_METADATA_KEY = "metadata"
const DEFAULT_METRICS_SESSIONS = 8
const DEFAULT_REMEMBERED_EVICTED_SUBJECTS = 100
const TOUCH_SCAN_INITIAL_WATERMARK = -1
const DEFAULT_REMEMBERED_REASONING_PARTS = 4096
const DEFAULT_REMEMBERED_DEDUP_PAIRS = 4096
// How many distinct faulted subjects one session's metrics entry remembers
// (LRU, refreshed on every increment): between the evicted-subject cap and
// the reasoning-part cap, sized so a session's reloaded outputs stay
// fault-tracked for the entry's lifetime.
const DEFAULT_REMEMBERED_FAULT_SUBJECTS = 256
// How many messages of eviction deferral one recorded fault buys a subject
// in the candidate sort: a reloaded output is demonstrably needed again, so
// it re-evicts five messages later than its recency alone would place it.
const FAULT_PENALTY_MESSAGES = 5
const DEFAULT_METRICS_LOG_ENABLED = true
// The default locations derive per resolution instead of once at module
// load, so the migration below and the resolved options always agree on
// where the default paths are even if the process home is relocated.
const defaultMetricsPath = (): string => join(homedir(), ...DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_METRICS_FILE_BASENAME)
const DEFAULT_LIVE_STATE_LOG_ENABLED = true
const defaultLiveStateDir = (): string => join(homedir(), ...DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_LIVE_STATE_DIR_BASENAME)
const DEFAULT_INGESTION_HYGIENE = true
const DEFAULT_INGESTION_HYGIENE_COPY = true
const DEFAULT_INGESTION_HYGIENE_FILE_BASENAME = "context-hygiene.jsonl"
const defaultIngestionHygienePath = (): string => join(homedir(), ...DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_INGESTION_HYGIENE_FILE_BASENAME)
// 5 MiB: hygiene lines carry the full original output, the fattest lines
// the plugin writes, and the copy is a paranoid escape hatch rather than
// a standing record, so its cap sits well under the metrics log's 20 MiB.
export const DEFAULT_INGESTION_HYGIENE_ROTATION_MAX_BYTES = 5 * 1024 * 1024
const HYGIENE_COPY_DISABLED_MAX_BYTES = 0
const DEFAULT_PAGE_STORE_ENABLED = true
const DEFAULT_PAGE_STORE_FILE_BASENAME = "context-pages.jsonl"
const defaultPageStorePath = (): string => join(homedir(), ...DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_PAGE_STORE_FILE_BASENAME)
// 20 MiB: metrics parity rather than the hygiene copy's smaller cap, because
// page lines carry the same fat verbatim-output content class the metrics
// log's cap was sized for, and the store is a standing record, not an
// escape hatch.
export const DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES = 20 * 1024 * 1024
const LIVE_STATE_FILE_SUFFIX = ".json"
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_PRUNE_INTERVAL = 7
const DEFAULT_LIVE_STATE_PRUNE_MAX_AGE_MS =
  DAYS_PER_PRUNE_INTERVAL * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND
const LIVE_STATE_TEMP_FILE_SUFFIX = ".tmp"
const MIN_MS_BETWEEN_PRUNE_SCANS = 60 * MS_PER_SECOND
const PRUNE_SCAN_NEVER = -1
const PRUNE_SCAN_THROTTLE_DISABLED = 0
// 20 MiB: at the observed pre-coalescing rate of about 1.45 MB/day the
// previous 5 MiB cap kept only about 7 days across its two generations and
// older lines rotated out permanently within days; coalescing cut that
// rate by an estimated 70-85 percent, so two generations now hold roughly
// three weeks at the old rate and several times that at the current one.
export const DEFAULT_METRICS_ROTATION_MAX_BYTES = 20 * 1024 * 1024
const METRICS_ROTATION_DISABLED_MAX_BYTES = 0
const METRICS_ROTATION_SUFFIX = ".1"
const DEFAULT_METRICS_MIN_LINE_INTERVAL_MS = SECONDS_PER_MINUTE * MS_PER_SECOND
const METRICS_COALESCING_DISABLED_MS = 0
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
const JSON_INDENT_SPACES = 2
const CONTEXT_TOKENS_SOURCE_OVERRIDE = "override"
const CONTEXT_TOKENS_SOURCE_MODEL = "model"
const CONTEXT_TOKENS_SOURCE_DEFAULT = "default"
const CONTEXT_TOKENS_SOURCE_UNKNOWN = "unknown"
const MODEL_KEY_SEPARATOR = "/"
const ATTACHMENTS_STATE_KEY = "attachments"
const ATTACHMENT_URL_KEY = "url"
const ATTACHMENT_MIME_KEY = "mime"
const TOMBSTONE_ATTACHMENTS_NOTICE = "attachments dropped"
const STASH_ATTACHMENTS_LEAD = "attachments evicted with this output"
const STASH_ATTACHMENT_DROPPED_TAIL = "payloads were dropped during eviction; re-run the tool to regenerate them"
const UNKNOWN_ATTACHMENT_MIME_LABEL = "unknown mime"
const DEFAULT_FENCE_EVICTABLE_LINES = 40
const DEFAULT_USER_FENCE_EVICTION_ENABLED = false
const DEFAULT_MANUAL_MODE = false
const DEFAULT_ADVISORY_BAND_ENABLED = true
export const ADVISORY_BAND_RATIO_DEFAULT = 0.85
const ADVISORY_SUBJECTS_BOUND = 3
const DEFAULT_NOW = (): number => Date.now()
const FENCE_EVICTION_MARKER = "[ctx-evicted-fence]"
const FENCE_BLOCK_NOUN = "code block"
const FENCE_STASH_TOOL_LABEL = "fence"
const FENCE_BACKTICK = "`"
const MIN_FENCE_MARKER_TICKS = 3
// CommonMark: a line indented four or more spaces is indented code, never a fence.
const MAX_FENCE_INDENT_SPACES = 3
const FENCE_INDENT_SPACE = " "
const FENCE_INFO_SEPARATOR = /\s+/
const FENCE_LINE_COUNT_LABEL = "lines"
const FENCE_FIRST_LINE_LABEL = "first line"
const FENCE_EVICTED_NOTICE = "was evicted to reclaim context."
const USER_MESSAGE_ROLE = "user"

type UserFenceEvictionOptions = { enabled: boolean; minBlockLines: number }

type ContextManagerOptions = {
  watermark?: number
  watermarkTokens?: number
  agedReadEvictionMessages?: number
  reasoningRetentionMessages?: number
  recentWindow?: number
  minEvictableBytes?: number
  defaultContextTokens?: number
  modelContextTokens?: Record<string, number>
  hintSubjects?: number
  protectedTools?: string[]
  protectedPatterns?: string[]
  stashLimit?: number
  stashSessions?: number
  limitSessions?: number
  hintSessions?: number
  metricsSessions?: number
  rememberedEvictedSubjects?: number
  charsPerToken?: number
  minSubstringMatchChars?: number
  metricsLog?: boolean
  metricsPath?: string
  metricsRotationMaxBytes?: number
  metricsMinLineIntervalMs?: number
  ingestionHygiene?: boolean
  ingestionHygieneCopy?: boolean
  ingestionHygienePath?: string
  ingestionHygieneRotationMaxBytes?: number
  pageStore?: boolean
  pageStorePath?: string
  pageStoreRotationMaxBytes?: number
  liveStateLog?: boolean
  liveStatePath?: string
  liveStatePruneMaxAgeMs?: number
  liveStatePruneMinIntervalMs?: number
  manualMode?: boolean
  advisoryBand?: boolean
  advisoryBandRatio?: number
  userFenceEviction?: { enabled?: boolean; minBlockLines?: number }
  now?: () => number
  // Test-only fault injection for the compaction hook: when the injected
  // function throws, the compacting hook's fault boundary exercises its
  // degradation path. Never documented as a user option.
  errorCompaction?: () => never
  // Test-only fault injection for the hygiene hook: when the injected
  // function throws, the tool.execute.after fault boundary exercises its
  // degradation path. Never documented as a user option.
  errorHygiene?: () => never
  // Test-only fault injection: when the injected function returns a
  // message, the transform hook's fault boundary treats the run as if the
  // body threw that message (identity behavior plus lastError). Never
  // documented as a user option; exists so the fault path is testable
  // without monkey-patching internals.
  errorTransform?: () => string | undefined
}

type CompiledGlob = { regexp: RegExp; matchesSegments: boolean }

type ResolvedOptions = Omit<
  Required<ContextManagerOptions>,
  "defaultContextTokens" | "agedReadEvictionMessages" | "reasoningRetentionMessages" | "modelContextTokens" | "protectedPatterns" | "userFenceEviction" | "watermarkTokens"
> & {
  defaultContextTokens?: number
  agedReadEvictionMessages?: number
  reasoningRetentionMessages: number
  watermarkTokens?: number
  modelContextTokens: Record<string, number>
  protectedPatterns: CompiledGlob[]
  protectedPatternSources: string[]
  userFenceEviction: UserFenceEvictionOptions
}

type SubjectRange = { start: number; end: number }

type Subject = {
  path: string
  range?: SubjectRange
}

type ToolAppearance = {
  msgIndex: number
  tool: string
  subjects: Subject[]
}

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

type HotSubject = { subject: Subject; lastTouch: number }

type EvictionResult = {
  hotSubjects: HotSubject[]
  appearances: ToolAppearance[]
  estimatedTokens: number
  watermarkTokens: number | null
  deficitTokens: number | null
  evicted: EvictedEntryInfo[]
  pagesDropped: number
}

type EvictedEntryInfo = {
  tool: string
  subject: string
  subjects: Subject[]
  bytes: number
  attachmentBytes: number
  messagesAgo: number
}

type LastRunMetrics = { estimatedTokens: number; watermarkTokens: number | null; deficitTokens: number | null }

type RunOutcome = {
  eviction: EvictionResult
  deduped: number
  dedupedBytesUnique: number
  dedupedUnique: number
  collapsedWindows: number
  collapsedWindowBytes: number
  faults: number
  reasoningExpired: ReasoningExpiry
  fenceEvicted: FenceEviction
  dryRun: DryRunResult | undefined
  advisory: AdvisoryResult | undefined
  composition: RunComposition
}

type ReasoningExpiry = { parts: number; bytes: number; unique: number; uniqueBytes: number }

type ContextTokensSource =
  | typeof CONTEXT_TOKENS_SOURCE_OVERRIDE
  | typeof CONTEXT_TOKENS_SOURCE_MODEL
  | typeof CONTEXT_TOKENS_SOURCE_DEFAULT
  | typeof CONTEXT_TOKENS_SOURCE_UNKNOWN

type ContextLimitEntry = { tokens: number; source: ContextTokensSource; modelKey: string | undefined }

type ContextLimit = { tokens: number | null; source: ContextTokensSource; modelKey: string | undefined }

type PruneThrottle = { lastScanMs: number }

type ChatParamsModel = { providerID?: string; modelID?: string; limit?: { context?: number } }

type SessionMetrics = {
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
}

type LastError = { message: string; atMs: number }

type MetricsStore = Map<string, SessionMetrics>

// The raw counters a session's persisted totals can seed, declared once in
// schema.ts and anchored to SessionMetrics by the exhaustiveness
// assertion below so a renamed or removed counter fails to compile here
// instead of silently missing its seed. The runtime seeder iterates this
// same list.
export const RAW_COUNTER_KEYS: readonly RawCounterKey[] = Object.freeze(SCHEMA_RAW_COUNTER_KEYS)
type RawCounterKey = SchemaRawCounterKey

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
type CumulativeCounters = { [K in TotalsKey]: number }

type SessionCheckpoint = {
  ts: string
  session: string
  manualMode: boolean
  contextLimit: number | null
  contextLimitSource: ContextTokensSource
  contextLimitModelKey: number | null | string
  lastRun: LastRunMetrics
  advisory?: AdvisoryResult
  retention?: RetentionBreakdown
  totals: CumulativeCounters
  pageStore: { entries: number; capacity: number }
  hotSubjects: string[]
}

type StatsSource = {
  options: ResolvedOptions
  limits: Map<string, ContextLimitEntry>
  modelKeys: Map<string, string | undefined>
  pageStores: PageStoreBySession
  metrics: MetricsStore
}

type RetainedDuplicate = { msgIndex: number; tool: string; supersedes: boolean }

type FilePartFields = { mime: string; url: string; filename: string }

type RetainedFileDuplicate = { msgIndex: number; label: string }

type DedupTarget = { stateRef: { output: string; attachments?: unknown }; tool: string; input: Record<string, unknown> }

type DedupedPairBytes = { key: string; bytes: number }
type DedupOutcome = { tombstones: number; tombstonedPairs: DedupedPairBytes[] }

type MessageBundle = {
  info: { sessionID?: string; role?: unknown }
  parts: Array<Record<string, unknown>>
}

type PageEntry = {
  output: string
  tool: string
  subject: string
  msgIndex: number
  partIndex: number
  attachments?: unknown[]
  stashSlot?: number
}

type SessionPageStore = Map<string, PageEntry>

type PageStoreBySession = Map<string, SessionPageStore>

const modelContextTokensOf = (raw: Record<string, number> | undefined): Record<string, number> => {
  if (typeof raw !== "object" || raw === null) return {}
  const resolved: Record<string, number> = {}
  for (const [key, tokens] of Object.entries(raw)) {
    if (typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0) resolved[key] = tokens
  }
  return resolved
}

const userFenceEvictionOf = (raw: ContextManagerOptions["userFenceEviction"]): UserFenceEvictionOptions => {
  const source = typeof raw === "object" && raw !== null ? raw : {}
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_USER_FENCE_EVICTION_ENABLED,
    minBlockLines:
      typeof source.minBlockLines === "number" && Number.isInteger(source.minBlockLines) && source.minBlockLines >= 0
        ? source.minBlockLines
        : DEFAULT_FENCE_EVICTABLE_LINES,
  }
}

const boundedIntegerOr = (value: number | undefined, fallback: number, min: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= min ? value : fallback

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0

const resolveOptions = (raw: ContextManagerOptions = {}): ResolvedOptions => {
  const protectedPatterns =
    Array.isArray(raw.protectedPatterns) && raw.protectedPatterns.every(isNonEmptyString)
      ? raw.protectedPatterns
      : DEFAULT_PROTECTED_PATTERNS
  const recentWindow = typeof raw.recentWindow === "number" && raw.recentWindow >= 0 ? Math.floor(raw.recentWindow) : DEFAULT_RECENT_WINDOW_MESSAGES
  return {
    watermark: typeof raw.watermark === "number" && raw.watermark > 0 && raw.watermark < 1 ? raw.watermark : DEFAULT_WATERMARK_RATIO,
    // Absolute watermark, the staged-eviction lever: when set it wins over
    // the fractional watermark (budget x watermark), so a user can engage
    // only sessions above, say, 250k tokens without touching the fraction.
    // Same numeric discipline as the rotation cap: finite, above 0,
    // drop-on-invalid.
    watermarkTokens:
      typeof raw.watermarkTokens === "number" && Number.isFinite(raw.watermarkTokens) && raw.watermarkTokens > 0
        ? raw.watermarkTokens
        : undefined,
    // The aged read tier's age threshold in messages from the list tail.
    // Unset disables the tier entirely; a set value must be a positive
    // integer, anything else falling back to unset (the same
    // drop-on-invalid discipline as the other staged levers).
    agedReadEvictionMessages:
      typeof raw.agedReadEvictionMessages === "number" && Number.isInteger(raw.agedReadEvictionMessages) && raw.agedReadEvictionMessages > 0
        ? raw.agedReadEvictionMessages
        : undefined,
    // The reasoning expiry boundary's message age from the list tail,
    // clamped from below at recentWindow: a value below the window would
    // expire the pending tool-use continuation's signature-carrying
    // thinking block mid-turn, so the window is a floor, not a peer.
    reasoningRetentionMessages: Math.max(
      recentWindow,
      typeof raw.reasoningRetentionMessages === "number" && Number.isInteger(raw.reasoningRetentionMessages) && raw.reasoningRetentionMessages > 0
        ? raw.reasoningRetentionMessages
        : recentWindow,
    ),
    recentWindow,
    minEvictableBytes: typeof raw.minEvictableBytes === "number" && raw.minEvictableBytes >= 0 ? raw.minEvictableBytes : DEFAULT_MIN_EVICTABLE_BYTES,
    defaultContextTokens:
      typeof raw.defaultContextTokens === "number" && Number.isFinite(raw.defaultContextTokens) && raw.defaultContextTokens > 0
        ? raw.defaultContextTokens
        : undefined,
    modelContextTokens: modelContextTokensOf(raw.modelContextTokens),
    hintSubjects:
      typeof raw.hintSubjects === "number" && Number.isInteger(raw.hintSubjects) && raw.hintSubjects >= 0
        ? raw.hintSubjects
        : DEFAULT_HINT_SUBJECTS,
    protectedTools: Array.isArray(raw.protectedTools) && raw.protectedTools.every(isNonEmptyString) ? raw.protectedTools : DEFAULT_PROTECTED_TOOLS,
    protectedPatterns: protectedPatterns.flatMap((pattern) => {
      const compiled = compiledGlobOf(pattern)
      return compiled === undefined ? [] : [compiled]
    }),
    protectedPatternSources: protectedPatterns,
    stashLimit: boundedIntegerOr(raw.stashLimit, DEFAULT_STASH_LIMIT, 0),
    stashSessions: boundedIntegerOr(raw.stashSessions, DEFAULT_STASH_SESSIONS, 1),
    limitSessions: boundedIntegerOr(raw.limitSessions, DEFAULT_LIMIT_SESSIONS, 1),
    hintSessions: boundedIntegerOr(raw.hintSessions, DEFAULT_HINT_SESSIONS, 1),
    metricsSessions: boundedIntegerOr(raw.metricsSessions, DEFAULT_METRICS_SESSIONS, 1),
    rememberedEvictedSubjects: boundedIntegerOr(raw.rememberedEvictedSubjects, DEFAULT_REMEMBERED_EVICTED_SUBJECTS, 0),
    charsPerToken:
      typeof raw.charsPerToken === "number" && Number.isFinite(raw.charsPerToken) && raw.charsPerToken > 0
        ? raw.charsPerToken
        : DEFAULT_CHARS_PER_TOKEN,
    minSubstringMatchChars: boundedIntegerOr(raw.minSubstringMatchChars, DEFAULT_MIN_SUBSTRING_MATCH_CHARS, 0),
    metricsLog: typeof raw.metricsLog === "boolean" ? raw.metricsLog : DEFAULT_METRICS_LOG_ENABLED,
    metricsPath: isNonEmptyString(raw.metricsPath) ? raw.metricsPath : defaultMetricsPath(),
    metricsRotationMaxBytes:
      typeof raw.metricsRotationMaxBytes === "number" && Number.isFinite(raw.metricsRotationMaxBytes) && raw.metricsRotationMaxBytes >= 0
        ? raw.metricsRotationMaxBytes
        : DEFAULT_METRICS_ROTATION_MAX_BYTES,
    metricsMinLineIntervalMs:
      typeof raw.metricsMinLineIntervalMs === "number" && Number.isFinite(raw.metricsMinLineIntervalMs) && raw.metricsMinLineIntervalMs >= 0
        ? raw.metricsMinLineIntervalMs
        : DEFAULT_METRICS_MIN_LINE_INTERVAL_MS,
    ingestionHygiene: typeof raw.ingestionHygiene === "boolean" ? raw.ingestionHygiene : DEFAULT_INGESTION_HYGIENE,
    ingestionHygieneCopy: typeof raw.ingestionHygieneCopy === "boolean" ? raw.ingestionHygieneCopy : DEFAULT_INGESTION_HYGIENE_COPY,
    ingestionHygienePath: isNonEmptyString(raw.ingestionHygienePath) ? raw.ingestionHygienePath : defaultIngestionHygienePath(),
    ingestionHygieneRotationMaxBytes:
      typeof raw.ingestionHygieneRotationMaxBytes === "number" &&
      Number.isFinite(raw.ingestionHygieneRotationMaxBytes) &&
      raw.ingestionHygieneRotationMaxBytes >= 0
        ? raw.ingestionHygieneRotationMaxBytes
        : DEFAULT_INGESTION_HYGIENE_ROTATION_MAX_BYTES,
    pageStore: typeof raw.pageStore === "boolean" ? raw.pageStore : DEFAULT_PAGE_STORE_ENABLED,
    pageStorePath: isNonEmptyString(raw.pageStorePath) ? raw.pageStorePath : defaultPageStorePath(),
    pageStoreRotationMaxBytes:
      typeof raw.pageStoreRotationMaxBytes === "number" &&
      Number.isFinite(raw.pageStoreRotationMaxBytes) &&
      raw.pageStoreRotationMaxBytes >= 0
        ? raw.pageStoreRotationMaxBytes
        : DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES,
    liveStateLog: typeof raw.liveStateLog === "boolean" ? raw.liveStateLog : DEFAULT_LIVE_STATE_LOG_ENABLED,
    liveStatePath: isNonEmptyString(raw.liveStatePath) ? raw.liveStatePath : defaultLiveStateDir(),
    liveStatePruneMaxAgeMs:
      typeof raw.liveStatePruneMaxAgeMs === "number" && Number.isFinite(raw.liveStatePruneMaxAgeMs) && raw.liveStatePruneMaxAgeMs >= 0
        ? raw.liveStatePruneMaxAgeMs
        : DEFAULT_LIVE_STATE_PRUNE_MAX_AGE_MS,
    liveStatePruneMinIntervalMs:
      typeof raw.liveStatePruneMinIntervalMs === "number" &&
      Number.isFinite(raw.liveStatePruneMinIntervalMs) &&
      raw.liveStatePruneMinIntervalMs >= 0
        ? raw.liveStatePruneMinIntervalMs
        : MIN_MS_BETWEEN_PRUNE_SCANS,
    manualMode: typeof raw.manualMode === "boolean" ? raw.manualMode : DEFAULT_MANUAL_MODE,
    // The advisory pressure band below the effective watermark: a boolean
    // switch per the boolean-option discipline, and a ratio with the
    // watermark's numeric discipline narrowed to (0, 1), since a ratio
    // outside that open interval either sits at or beyond the watermark
    // itself (the critical zone) or at non-positive pressure.
    advisoryBand: typeof raw.advisoryBand === "boolean" ? raw.advisoryBand : DEFAULT_ADVISORY_BAND_ENABLED,
    advisoryBandRatio:
      typeof raw.advisoryBandRatio === "number" && Number.isFinite(raw.advisoryBandRatio) && raw.advisoryBandRatio > 0 && raw.advisoryBandRatio < 1
        ? raw.advisoryBandRatio
        : ADVISORY_BAND_RATIO_DEFAULT,
    userFenceEviction: userFenceEvictionOf(raw.userFenceEviction),
    // Test-injection seam for wall-clock time: the coalesce window, the
    // prune throttle, and the metrics-line timestamp all read this one
    // source. The default is real time; only tests override it, so it is
    // deliberately absent from the README's option surface and describe.
    now: typeof raw.now === "function" ? raw.now : DEFAULT_NOW,
    errorTransform: typeof raw.errorTransform === "function" ? raw.errorTransform : undefined,
    errorCompaction: typeof raw.errorCompaction === "function" ? raw.errorCompaction : undefined,
    errorHygiene: typeof raw.errorHygiene === "function" ? raw.errorHygiene : undefined,
  }
}

const isProtectedTool = (tool: string, options: ResolvedOptions): boolean => options.protectedTools.includes(tool)

const globSourceOf = (pattern: string): string => {
  let source = ""
  let index = 0
  while (index < pattern.length) {
    if (pattern.startsWith(GLOB_DOUBLESTAR_TRAILING_SLASH, index)) {
      source += "(?:.*/)?"
      index += GLOB_DOUBLESTAR_TRAILING_SLASH.length
    } else if (pattern.startsWith(GLOB_DOUBLESTAR, index)) {
      source += ".*"
      index += GLOB_DOUBLESTAR.length
    } else if (pattern.startsWith(GLOB_SINGLE_STAR, index)) {
      source += "[^/]*"
      index += GLOB_SINGLE_STAR.length
    } else if (pattern.startsWith(GLOB_QUESTION_MARK, index)) {
      source += "[^/]"
      index += GLOB_QUESTION_MARK.length
    } else {
      source += pattern.charAt(index).replace(REGEX_SPECIAL_CHARACTERS, "\\$&")
      index += 1
    }
  }
  return source
}

const compiledGlobOf = (pattern: string): CompiledGlob | undefined => {
  try {
    return { regexp: new RegExp(`^${globSourceOf(pattern)}$`), matchesSegments: !pattern.includes(PATH_SEGMENT_SEPARATOR) }
  } catch {
    // An uncompilable pattern protects nothing instead of breaking option
    // resolution: invalid patterns keep their skip-silently semantics.
    return undefined
  }
}

const globMatches = (compiled: CompiledGlob, value: string): boolean => {
  if (compiled.regexp.test(value)) return true
  if (compiled.matchesSegments === false) return false
  return value.split(PATH_SEGMENT_SEPARATOR).some((segment) => segment.length > 0 && compiled.regexp.test(segment))
}

const isPatternProtected = (subjects: Subject[], options: ResolvedOptions): boolean =>
  options.protectedPatterns.some((compiled) => subjects.some((subject) => globMatches(compiled, subject.path)))

const hotFromIndexOf = (messages: MessageBundle[], options: ResolvedOptions): number =>
  messages.length - options.recentWindow

const retentionFromIndexOf = (messages: MessageBundle[], options: ResolvedOptions): number =>
  messages.length - options.reasoningRetentionMessages

const rangeOf = (input: Record<string, unknown>): SubjectRange | undefined => {
  const offset = input[OFFSET_INPUT_KEY]
  const limit = input[LIMIT_INPUT_KEY]
  if (typeof offset !== "number" || typeof limit !== "number") return undefined
  return { start: offset, end: offset + limit }
}

const patternSubjectOf = (input: Record<string, unknown>): Subject | undefined => {
  const pattern = input[PATTERN_INPUT_KEY]
  if (typeof pattern !== "string" || pattern.length === 0) return undefined
  return { path: pattern }
}

const subjectsOf = (tool: string, input: Record<string, unknown>): Subject[] => {
  const range = rangeOf(input)
  const subjects: Subject[] = []
  for (const key of PATH_INPUT_KEYS) {
    const value = input[key]
    if (typeof value === "string" && value.length > 0) subjects.push(range ? { path: value, range } : { path: value })
  }
  const patternSubject = patternSubjectOf(input)
  if (patternSubject) subjects.push(patternSubject)
  const command = input[COMMAND_INPUT_KEY]
  if (tool === BASH_TOOL_NAME && typeof command === "string" && command.length > 0) subjects.push({ path: command })
  return subjects
}

const boundedSingleLineOf = (text: string): string => {
  const singleLine = text.replaceAll("\n", " ")
  return singleLine.length > MAX_RENDERED_SUBJECT_CHARS
    ? `${singleLine.slice(0, MAX_RENDERED_SUBJECT_CHARS - ELLIPSIS_MARKER.length)}${ELLIPSIS_MARKER}`
    : singleLine
}

const renderSubject = (subject: Subject): string => {
  const rendered = subject.range
    ? `${subject.path}${PATH_RANGE_SEPARATOR}${subject.range.start}${RANGE_SEPARATOR}${subject.range.end}`
    : subject.path
  return boundedSingleLineOf(rendered)
}

const appearanceTouches = (entrySubjects: Subject[], appearance: ToolAppearance, minSubstringChars: number): boolean =>
  appearance.subjects.some((appearanceSubject) =>
    entrySubjects.some(
      (entrySubject) =>
        entrySubject.path === appearanceSubject.path ||
        (appearance.tool === BASH_TOOL_NAME &&
          entrySubject.path.length > minSubstringChars &&
          appearanceSubject.path.includes(entrySubject.path)),
    ),
  )

const completedOutputOf = (part: Record<string, unknown>): { output: string; attachments?: unknown } | undefined => {
  if (part["type"] !== "tool") return undefined
  const state = part["state"]
  if (typeof state !== "object" || state === null) return undefined
  const typedState = state as Record<string, unknown>
  if (typedState["status"] !== "completed" || typeof typedState["output"] !== "string") return undefined
  return typedState as { output: string; attachments?: unknown }
}

const attachmentPayloadCharsOf = (state: Record<string, unknown>): number => {
  const attachments = state[ATTACHMENTS_STATE_KEY]
  if (!Array.isArray(attachments)) return 0
  let chars = 0
  for (const attachment of attachments) {
    const url =
      typeof attachment === "object" && attachment !== null ? (attachment as Record<string, unknown>)[ATTACHMENT_URL_KEY] : undefined
    if (typeof url === "string") chars += url.length
  }
  return chars
}

const nonEmptyAttachmentsOf = (state: { attachments?: unknown }): unknown[] | undefined => {
  const attachments = state[ATTACHMENTS_STATE_KEY]
  return Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined
}

const stripStateAttachments = (state: { attachments?: unknown }): void => {
  if (!Array.isArray(state[ATTACHMENTS_STATE_KEY])) return
  delete state[ATTACHMENTS_STATE_KEY]
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((element) => stableStringify(element)).join(",")}]`
  if (typeof value !== "object" || value === null) return JSON.stringify(value)
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`
}

const dedupKeyOf = (tool: string, input: Record<string, unknown>): string => JSON.stringify([tool, stableStringify(input)])

// A reasoning part's stable identity: its own text and metadata, keyed the
// same way the dedup pass keys tool inputs, so identity survives the
// transform's repeated passes over the stored message list.
const reasoningIdentityOf = (text: unknown, metadata: unknown): string =>
  JSON.stringify([stableStringify(text), stableStringify(metadata)])

const buildDedupTombstone = (tool: string, msgIndex: number): string =>
  `${DEDUP_MARKER} ${tool} ${DEDUP_SUPERSEDED_LEAD} ${msgIndex}`

const dedupTargetOf = (part: Record<string, unknown>): DedupTarget | undefined => {
  const outputRef = completedOutputOf(part)
  if (outputRef === undefined) return undefined
  if (startsWithEitherGeneration(outputRef.output, EVICTION_MARKER, LEGACY_EVICTION_MARKER) || startsWithEitherGeneration(outputRef.output, DEDUP_MARKER, LEGACY_DEDUP_MARKER)) return undefined
  const tool = part["tool"]
  if (typeof tool !== "string") return undefined
  const typedState = part["state"] as Record<string, unknown>
  const input = typeof typedState["input"] === "object" && typedState["input"] !== null ? (typedState["input"] as Record<string, unknown>) : {}
  return { stateRef: outputRef, tool, input }
}

const deduplicateToolOutputs = (messages: MessageBundle[], options: ResolvedOptions): DedupOutcome => {
  const retainedByKey = new Map<string, RetainedDuplicate>()
  let tombstones = 0
  const tombstonedPairs: DedupedPairBytes[] = []
  for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex -= 1) {
    for (const part of messages[msgIndex].parts) {
      const target = dedupTargetOf(part)
      if (target === undefined) continue
      const key = dedupKeyOf(target.tool, target.input)
      const retained = retainedByKey.get(key)
      if (retained === undefined) {
        retainedByKey.set(key, {
          msgIndex,
          tool: target.tool,
          supersedes: target.stateRef.output.length >= options.minEvictableBytes,
        })
        continue
      }
      if (retained.supersedes) {
        const supersededBytes = target.stateRef.output.length + attachmentPayloadCharsOf(target.stateRef)
        target.stateRef.output = buildDedupTombstone(retained.tool, retained.msgIndex)
        stripStateAttachments(target.stateRef)
        tombstones += 1
        tombstonedPairs.push({ key, bytes: supersededBytes })
      }
    }
  }
  return { tombstones, tombstonedPairs }
}

const filePartOf = (part: Record<string, unknown>): FilePartFields | undefined => {
  if (part["type"] !== FILE_PART_TYPE) return undefined
  const mime = part[ATTACHMENT_MIME_KEY]
  const url = part[ATTACHMENT_URL_KEY]
  if (typeof mime !== "string" || typeof url !== "string") return undefined
  const filename = part[FILE_FILENAME_KEY]
  return { mime, url, filename: typeof filename === "string" ? filename : "" }
}

const fileDedupKeyOf = (file: FilePartFields): string => JSON.stringify([file.mime, file.url])

const fileDedupLabelOf = (file: FilePartFields): string => (file.filename.length > 0 ? file.filename : file.mime)

const buildFileDedupTombstone = (label: string, msgIndex: number): string =>
  `${DEDUP_MARKER} ${label} ${DEDUP_FILE_SUPERSEDED_LEAD} ${msgIndex}`

const deduplicateFileAttachments = (messages: MessageBundle[], options: ResolvedOptions): DedupOutcome => {
  const retainedByKey = new Map<string, RetainedFileDuplicate>()
  const hotFromIndex = hotFromIndexOf(messages, options)
  let tombstones = 0
  const tombstonedPairs: DedupedPairBytes[] = []
  for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex -= 1) {
    const messageParts = messages[msgIndex].parts
    for (let partIndex = messageParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const file = filePartOf(messageParts[partIndex])
      if (file === undefined) continue
      const key = fileDedupKeyOf(file)
      const retained = retainedByKey.get(key)
      if (retained === undefined) {
        retainedByKey.set(key, { msgIndex, label: fileDedupLabelOf(file) })
        continue
      }
      if (msgIndex >= hotFromIndex) continue
      messageParts[partIndex] = { type: TEXT_PART_TYPE, text: buildFileDedupTombstone(retained.label, retained.msgIndex) }
      tombstones += 1
      tombstonedPairs.push({ key, bytes: 0 })
    }
  }
  // A file part's payload size is not observable from its url, so file dedup
  // contributes tombstones whose pairs carry no bytes to the unique estimate.
  return { tombstones, tombstonedPairs }
}

type RangeReadWindow = { msgIndex: number; stateRef: { output: string }; range: SubjectRange }

type RangeCollapseOutcome = { collapsed: number; collapsedBytes: number }

const rangeContains = (outer: SubjectRange, inner: SubjectRange): boolean =>
  outer.start <= inner.start && outer.end >= inner.end

// The window a read carried is recoverable from its input's offset and
// limit; a read without both is not a range read and never collapses.
const rangeWindowOf = (part: Record<string, unknown>): { range: SubjectRange; stateRef: { output: string }; path: string | undefined } | undefined => {
  if (part["type"] !== "tool" || part["tool"] !== READ_TOOL_NAME) return undefined
  const state = part["state"]
  if (typeof state !== "object" || state === null) return undefined
  const typedState = state as Record<string, unknown>
  if (typedState["status"] !== "completed" || typeof typedState["output"] !== "string") return undefined
  if (startsWithEitherGeneration(typedState["output"], EVICTION_MARKER, LEGACY_EVICTION_MARKER) || startsWithEitherGeneration(typedState["output"], DEDUP_MARKER, LEGACY_DEDUP_MARKER)) return undefined
  const input = typeof typedState["input"] === "object" && typedState["input"] !== null ? (typedState["input"] as Record<string, unknown>) : {}
  // Malformed ranges never become windows: a non-integer, negative, or
  // empty range cannot be compared for containment meaningfully. The guards
  // live here, not in rangeOf, which subjectsOf shares and whose subject
  // rendering tolerates odd values.
  const range = rangeOf(input)
  if (range === undefined) return undefined
  if (Number.isInteger(range.start) === false || Number.isInteger(range.end) === false) return undefined
  if (range.start < 0 || range.end <= range.start) return undefined
  const path = PATH_INPUT_KEYS.map((key) => input[key]).find((value) => typeof value === "string" && value.length > 0)
  return { range, stateRef: typedState as { output: string }, path: typeof path === "string" ? path : undefined }
}

// Range reads of one file fragment its content into standing windows dedup
// cannot see: every distinct offset/limit pair is a distinct key, so the
// same file is paid for once per window on every request. This pass
// tombstones a contained window exactly the way file-part dedup tombstones
// a superseded part: walking newest first, a read whose [start, end) range
// is fully contained in a strictly newer retained read's range of the same
// path becomes a text tombstone naming the retained read's message.
// Containment only: merely overlapping or merely contiguous windows are
// left alone because a contained window provably adds no unique lines,
// while an overlap may carry lines the retained window lacks, so
// collapsing it would drop context the model paid for and received. The
// discipline mirrors dedup: reads inside the recent window never
// collapse, outputs under minEvictableBytes never collapse, and
// already-tombstoned outputs never collapse.
const collapseRangeReads = (messages: MessageBundle[], options: ResolvedOptions): RangeCollapseOutcome => {
  const hotFromIndex = hotFromIndexOf(messages, options)
  const retainedByPath = new Map<string, RangeReadWindow>()
  let collapsed = 0
  let collapsedBytes = 0
  for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex -= 1) {
    const messageParts = messages[msgIndex].parts
    for (let partIndex = messageParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const window = rangeWindowOf(messageParts[partIndex])
      if (window === undefined || window.path === undefined) continue
      const retained = retainedByPath.get(window.path)
      if (retained === undefined) {
        retainedByPath.set(window.path, { msgIndex, stateRef: window.stateRef, range: window.range })
        continue
      }
      if (rangeContains(retained.range, window.range) === false) continue
      if (msgIndex >= hotFromIndex) continue
      if (window.stateRef.output.length < options.minEvictableBytes) continue
      collapsedBytes += window.stateRef.output.length
      messageParts[partIndex] = {
        type: TEXT_PART_TYPE,
        text: `${DEDUP_MARKER} ${READ_TOOL_NAME} ${renderSubject({ path: window.path, range: window.range })} ${DEDUP_RANGE_SUPERSEDED_LEAD} ${retained.msgIndex} (${renderSubject({ path: window.path, range: retained.range })})`,
      }
      collapsed += 1
    }
  }
  return { collapsed, collapsedBytes }
}

// Membership test plus bounded remember shared by the unique-event counters:
// returns true the first time a key is seen, false for repeats. The list
// trims to the bound, so an event forgotten after a bound worth of newer
// keys could count once more; the default bounds dwarf real standing sets.
// The linear scan is O(events x bound) per run, capped by the bound at a
// few million short-string compares worst case, which stays well under the
// transform's existing per-run serialization cost; a Set would complicate
// the FIFO trim for no measurable win at real session sizes.
const rememberUniqueKey = (seenKeys: string[], key: string, rememberedBound: number): boolean => {
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
const countUniqueDedupedPairs = (metrics: SessionMetrics, pairs: DedupedPairBytes[]): { unique: number; bytes: number } => {
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

const estimateTokensFromBytes = (bytes: number, charsPerToken: number): number => Math.ceil(bytes / charsPerToken)

const estimateTokens = (messages: MessageBundle[], charsPerToken: number): number => {
  let chars = 0
  for (const message of messages) {
    for (const part of message.parts) {
      if (part["type"] === TEXT_PART_TYPE && typeof part["text"] === "string") {
        chars += part["text"].length
      } else {
        const outputRef = completedOutputOf(part)
        if (outputRef) chars += outputRef.output.length
      }
    }
  }
  return estimateTokensFromBytes(chars, charsPerToken)
}

type RunComposition = {
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
type RetentionBreakdown = {
  pool: number
  reasons: { inWindow: number; protectedTool: number; patternProtected: number; faultShielded: number; retainedRead: number }
  faultShieldedShiftMessages: number
}

// Terminal escape sequences counted for escapeBytes and stripped by
// ingestion hygiene: CSI sequences (ESC [ ... final byte) and OSC
// sequences (ESC ] ... BEL or ST terminator). Matched spans count their
// whole length; a truncated CSI without a final byte, an unterminated
// OSC, and a lone ESC without an introducer are not counted. The OSC
// payload is non-greedy, so consecutive OSC spans each end at their own
// terminator instead of swallowing the text between them. Deterministic
// single pass.
const ESCAPE_SPAN_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*?(?:\x07|\x1b\\)/g

const escapeBytesOf = (output: string): number => {
  let bytes = 0
  for (const span of output.match(ESCAPE_SPAN_PATTERN) ?? []) bytes += span.length
  return bytes
}

// At-birth tool-output hygiene, applied by tool.execute.after so the
// rewrite persists into session storage: strips the same CSI/OSC spans
// the composition walk counts (the shared ESCAPE_SPAN_PATTERN), collapses
// carriage-return progress lines to their final segment within each
// newline-delimited line (a \r that closes a line as CRLF, or sits at end
// of output, is a line ending and is carried through untouched), and
// trims trailing whitespace runs per line (leading whitespace stays). The
// candidate scan over-approximates what the three passes can change (any
// escape introducer, any carriage return, any trimmable line-ending
// whitespace), so nothing strippable is missed; a clean output costs one
// scan and zero writes, and the original string reference passes through
// when the pipeline would be a no-op.
const HYGIENE_CANDIDATE_PATTERN = /\x1b|\r|[ \t](?=\n|$)/
const TRAILING_WHITESPACE_RUN_PATTERN = /[ \t]+$/
const stripTerminalNoiseFrom = (output: string): string => {
  if (HYGIENE_CANDIDATE_PATTERN.test(output) === false) return output
  const lines = output.replace(ESCAPE_SPAN_PATTERN, "").split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    // A trailing \r on a split line was followed by \n (a CRLF terminator)
    // or sat at end of output; both are line endings rather than progress
    // markers, so they are carried through untouched. Splitting on \n
    // erases the lookahead that would distinguish them, hence the
    // endswith check.
    let line = lines[index]
    let carriageReturnTerminator = ""
    if (line.endsWith("\r")) {
      carriageReturnTerminator = "\r"
      line = line.slice(0, -1)
    }
    const latestCarriageReturn = line.lastIndexOf("\r")
    const collapsed = latestCarriageReturn === -1 ? line : line.slice(latestCarriageReturn + 1)
    lines[index] = collapsed.replace(TRAILING_WHITESPACE_RUN_PATTERN, "") + carriageReturnTerminator
  }
  const stripped = lines.join("\n")
  return stripped === output ? output : stripped
}

// The post-transform composition of one run's message list: live tool
// outputs, text parts, and the reasoning still inside the retention age.
// Called after every pass has edited the list, so the three sums are the
// view the model actually receives. The estimate relation is exact for
// the two sums the estimate counts: estimatedTokens equals
// ceil((toolPoolBytes + textChars) / charsPerToken) over this same list,
// while reasoningInWindowBytes and attachmentBytes are bill components
// the estimate omits. reasoningInWindowBytes keeps its key while meaning
// retained bytes: the sum runs over the reasoningRetentionMessages
// boundary, not the hot window, so it covers the reasoning the request
// actually carries for any retention setting. attachmentBytes reuses the
// evictor's own attachment accounting (tool-state attachment url payloads
// via attachmentPayloadCharsOf) — a superset of eviction's tool-state
// attachment accounting, extended with file-part url lengths; embedded
// images inside file parts, data-URI text outputs, and non-attachment
// host content are the known gaps, not a second measure.
const runCompositionOf = (messages: MessageBundle[], options: ResolvedOptions): RunComposition => {
  const retentionFromIndex = retentionFromIndexOf(messages, options)
  let toolPoolBytes = 0
  let textChars = 0
  let reasoningInWindowBytes = 0
  let escapeBytes = 0
  let attachmentBytes = 0
  for (let msgIndex = 0; msgIndex < messages.length; msgIndex += 1) {
    const inRetainedWindow = msgIndex >= retentionFromIndex
    for (const part of messages[msgIndex].parts) {
      if (part["type"] === TEXT_PART_TYPE) {
        const text = part["text"]
        if (typeof text === "string") textChars += text.length
        continue
      }
      if (part["type"] === REASONING_PART_TYPE) {
        const text = part[REASONING_TEXT_KEY]
        if (inRetainedWindow && typeof text === "string") reasoningInWindowBytes += text.length
        continue
      }
      if (part["type"] === FILE_PART_TYPE) {
        const file = filePartOf(part)
        if (file !== undefined) attachmentBytes += file.url.length
        continue
      }
      const outputRef = completedOutputOf(part)
      if (outputRef) {
        toolPoolBytes += outputRef.output.length
        escapeBytes += escapeBytesOf(outputRef.output)
        attachmentBytes += attachmentPayloadCharsOf(outputRef)
      }
    }
  }
  return { toolPoolBytes, textChars, reasoningInWindowBytes, escapeBytes, attachmentBytes }
}

const purgeErroredToolInputs = (messages: MessageBundle[], options: ResolvedOptions): void => {
  const hotFromIndex = hotFromIndexOf(messages, options)
  for (let msgIndex = 0; msgIndex < hotFromIndex; msgIndex += 1) {
    for (const part of messages[msgIndex].parts) {
      if (part["type"] !== "tool") continue
      const state = part["state"]
      if (typeof state !== "object" || state === null) continue
      const typedState = state as Record<string, unknown>
      if (typedState["status"] !== "error") continue
      if (typedState["input"] === PURGED_INPUT_MARKER || typedState["input"] === LEGACY_PURGED_INPUT_MARKER) continue
      typedState["input"] = PURGED_INPUT_MARKER
    }
  }
}

// Message indices are unstable across runs: opencode trims stored messages,
// and the recent window rides the tail, so a part is identified by its own
// content (text plus metadata, stringified with the same stable stringify
// the dedup pass keys inputs by) rather than by a msgIndex cursor like the
// touch watermark. A part counts unique the first run its identity is seen
// outside the retention age, and identical-content occurrences count once.
// The seen-set lives on the session's metrics entry, whose lifetime bounds
// the memory: the entry can be evicted from the metrics store and reseeded
// within one process, re-counting that session's standing set once per
// entry lifetime; unique can therefore exceed the entry's own cumulative
// count after a reseed but never the session's true unique total. The
// seen-set is also bounded, so only a same-content reappearance after a
// full bound worth of newer parts could count once more.
const expireAgedReasoning = (metrics: SessionMetrics, messages: MessageBundle[], options: ResolvedOptions): ReasoningExpiry => {
  const retentionFromIndex = retentionFromIndexOf(messages, options)
  let parts = 0
  let bytes = 0
  let unique = 0
  let uniqueBytes = 0
  for (let msgIndex = 0; msgIndex < retentionFromIndex; msgIndex += 1) {
    const messageParts = messages[msgIndex].parts
    for (let partIndex = messageParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = messageParts[partIndex]
      if (part["type"] !== REASONING_PART_TYPE) continue
      const text = part[REASONING_TEXT_KEY]
      const textChars = typeof text === "string" ? text.length : 0
      bytes += textChars
      const identity = reasoningIdentityOf(text, part[REASONING_METADATA_KEY])
      if (rememberUniqueKey(metrics.reasoningSeenKeys, identity, DEFAULT_REMEMBERED_REASONING_PARTS)) {
        unique += 1
        uniqueBytes += textChars
      }
      messageParts.splice(partIndex, 1)
      parts += 1
    }
  }
  return { parts, bytes, unique, uniqueBytes }
}

const stripLegacyHintParts = (messages: MessageBundle[]): void => {
  for (const message of messages) {
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      const text = part["text"]
      if (part["type"] === TEXT_PART_TYPE && typeof text === "string" && startsWithEitherGeneration(text, HINT_LINE_PREFIX, LEGACY_HINT_LINE_PREFIX)) {
        message.parts.splice(partIndex, 1)
      }
    }
  }
}

type FenceSpan = { startLine: number; endLine: number; language: string | undefined }

type FenceReplacement = { startOffset: number; endOffset: number; replacement: string; bytes: number }

type FenceEviction = { blocks: number; bytes: number; pagesDropped: number }

const leadingBackticksOf = (line: string): number => {
  let ticks = 0
  while (line.charAt(ticks) === FENCE_BACKTICK) ticks += 1
  return ticks
}

const fenceLineWithinIndentOf = (rawLine: string): string | undefined => {
  let spaces = 0
  while (rawLine.charAt(spaces) === FENCE_INDENT_SPACE) spaces += 1
  if (spaces > MAX_FENCE_INDENT_SPACES) return undefined
  return rawLine.slice(spaces)
}

const fenceLanguageOf = (info: string): string => info.split(FENCE_INFO_SEPARATOR)[0]

const fenceOpenerOf = (rawLine: string): { ticks: number; language: string | undefined } | undefined => {
  const line = fenceLineWithinIndentOf(rawLine)
  if (line === undefined) return undefined
  const ticks = leadingBackticksOf(line)
  if (ticks < MIN_FENCE_MARKER_TICKS) return undefined
  const info = line.slice(ticks).trim()
  // CommonMark: an info string holding a backtick never opens a fence, so
  // the line is content and can neither start a block nor be evicted as one.
  if (info.includes(FENCE_BACKTICK)) return undefined
  return { ticks, language: info.length > 0 ? fenceLanguageOf(info) : undefined }
}

const isFenceCloser = (rawLine: string, openerTicks: number): boolean => {
  const line = fenceLineWithinIndentOf(rawLine)
  if (line === undefined) return false
  const ticks = leadingBackticksOf(line)
  return ticks >= openerTicks && line.slice(ticks).trim().length === 0
}

const fenceSpansIn = (lines: string[]): FenceSpan[] => {
  const spans: FenceSpan[] = []
  let openLine = -1
  let openTicks = 0
  let language: string | undefined
  for (let index = 0; index < lines.length; index += 1) {
    if (openLine === -1) {
      const opener = fenceOpenerOf(lines[index])
      if (opener === undefined) continue
      openLine = index
      openTicks = opener.ticks
      language = opener.language
      continue
    }
    if (isFenceCloser(lines[index], openTicks)) {
      spans.push({ startLine: openLine, endLine: index, language })
      openLine = -1
    }
  }
  return spans
}

const lineStartsOf = (text: string): number[] => {
  const starts = [0]
  let index = text.indexOf("\n")
  while (index !== -1) {
    starts.push(index + 1)
    index = text.indexOf("\n", index + 1)
  }
  return starts
}

const fenceFirstNonEmptyLineOf = (lines: string[], startLine: number, endLine: number): string | undefined => {
  for (let index = startLine + 1; index < endLine; index += 1) {
    const trimmed = lines[index].trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

const evictLargeUserFences = (messages: MessageBundle[], options: ResolvedOptions, pageStore: SessionPageStore, pageStoreEntries: PageEntry[]): FenceEviction => {
  if (options.userFenceEviction.enabled === false) return { blocks: 0, bytes: 0, pagesDropped: 0 }
  const hotFromIndex = hotFromIndexOf(messages, options)
  const { minBlockLines } = options.userFenceEviction
  let blocks = 0
  let bytes = 0
  let pagesDropped = 0
  for (let msgIndex = 0; msgIndex < hotFromIndex; msgIndex += 1) {
    const message = messages[msgIndex]
    if (message.info.role !== USER_MESSAGE_ROLE) continue
    for (let partIndex = 0; partIndex < message.parts.length; partIndex += 1) {
      const part = message.parts[partIndex]
      if (part["type"] !== TEXT_PART_TYPE) continue
      const text = part["text"]
      if (typeof text !== "string") continue
      const lines = text.split("\n")
      let lineStarts: number[] | undefined
      const plans: FenceReplacement[] = []
      for (const span of fenceSpansIn(lines)) {
        const contentLines = span.endLine - span.startLine - 1
        if (contentLines <= minBlockLines) continue
        const firstLine = fenceFirstNonEmptyLineOf(lines, span.startLine, span.endLine)
        if (firstLine === undefined) continue
        if (lineStarts === undefined) lineStarts = lineStartsOf(text)
        const startOffset = lineStarts[span.startLine]
        const endOffset = span.endLine + 1 < lineStarts.length ? lineStarts[span.endLine + 1] : text.length
        const blockText = text.slice(startOffset, endOffset)
        const subject = boundedSingleLineOf(firstLine)
        const tombstone = buildFenceTombstone(span.language, contentLines, subject)
        const stored: PageEntry = {
          output: blockText,
          tool: FENCE_STASH_TOOL_LABEL,
          subject,
          msgIndex,
          partIndex,
          stashSlot: span.startLine,
        }
        pagesDropped += storeEvictedPage(pageStore, stored, options.stashLimit)
        pageStoreEntries.push(stored)
        plans.push({
          startOffset,
          endOffset,
          replacement: blockText.endsWith("\n") ? `${tombstone}\n` : tombstone,
          bytes: blockText.length,
        })
        blocks += 1
      }
      if (plans.length === 0) continue
      let updated = text
      for (let index = plans.length - 1; index >= 0; index -= 1) {
        const plan = plans[index]
        updated = `${updated.slice(0, plan.startOffset)}${plan.replacement}${updated.slice(plan.endOffset)}`
        bytes += plan.bytes
      }
      part["text"] = updated
    }
  }
  return { blocks, bytes, pagesDropped }
}

const boundedDigestOf = (text: string): string =>
  text.length > MAX_DIGEST_CHARS ? `${text.slice(0, MAX_DIGEST_CHARS - ELLIPSIS_MARKER.length)}${ELLIPSIS_MARKER}` : text

const digestPreviewOf = (label: string, line: string): string => `${label} "${line}"`

const buildOutputDigest = (tool: string, subject: string, output: string): string => {
  const lines = output.split(NEWLINE_SPLIT_PATTERN)
  const headLine = lines[0]
  const tailLine = lines[lines.length - 1]
  if (tool === READ_TOOL_NAME) {
    return boundedDigestOf(
      [subject, digestPreviewOf(DIGEST_FIRST_PREVIEW_LABEL, headLine), digestPreviewOf(DIGEST_LAST_PREVIEW_LABEL, tailLine)].join(DIGEST_PIECE_SEPARATOR),
    )
  }
  if (tool === BASH_TOOL_NAME) {
    return boundedDigestOf(
      [subject, digestPreviewOf(DIGEST_HEAD_PREVIEW_LABEL, headLine), digestPreviewOf(DIGEST_TAIL_PREVIEW_LABEL, tailLine)].join(DIGEST_PIECE_SEPARATOR),
    )
  }
  return boundedDigestOf(lines.join(" "))
}

const buildTombstone = (tool: string, subject: string, bytes: number, messagesAgo: number, attachmentsDropped: boolean, digest: string): string =>
  `${EVICTION_MARKER} ${tool} ${subject} (${bytes} bytes${attachmentsDropped ? `, ${TOMBSTONE_ATTACHMENTS_NOTICE}` : ""}, ~${messagesAgo} messages ago) was evicted to reclaim context; re-run the tool to reload its output.${DIGEST_POINTER_LEAD}${digest}${DIGEST_POINTER_TAIL}`

const buildReloadPointer = (subject: string): string =>
  `${RECALL_POINTER_LEAD} ${RECALL_TOOL_NAME} (subject "${subject}").`

const buildFenceTombstone = (language: string | undefined, contentLines: number, subject: string): string =>
  `${FENCE_EVICTION_MARKER} ${language === undefined ? FENCE_BLOCK_NOUN : `${language} ${FENCE_BLOCK_NOUN}`} (${contentLines} ${FENCE_LINE_COUNT_LABEL}, ${FENCE_FIRST_LINE_LABEL} "${subject}") ${FENCE_EVICTED_NOTICE}${buildReloadPointer(subject)}`

const pageKeyOf = (tool: string, subject: string, msgIndex: number, partIndex: number, stashSlot?: number): string =>
  `${tool}:${subject}:${msgIndex}:${partIndex}${stashSlot === undefined ? "" : `:${stashSlot}`}`

const touchMapEntry = <T>(map: Map<string, T>, key: string): T | undefined => {
  const existing = map.get(key)
  if (existing === undefined) return undefined
  map.delete(key)
  map.set(key, existing)
  return existing
}

const trimMapToBound = <T>(map: Map<string, T>, bound: number): void => {
  while (map.size >= bound) {
    const leastRecentlyActive = map.keys().next()
    if (leastRecentlyActive.done === true) break
    map.delete(leastRecentlyActive.value)
  }
}

const rememberSessionValue = <T>(map: Map<string, T>, key: string, value: T, bound: number): void => {
  map.delete(key)
  trimMapToBound(map, bound)
  map.set(key, value)
}

// One fault on a subject: the increment refreshes its recency so a hot
// subject survives at the map's bound, and the map is trimmed before the
// write so a brand-new subject never overflows the bound.
const rememberFaultForSubject = (faultCounts: Map<string, number>, subject: string, bound: number): void => {
  const existing = faultCounts.get(subject)
  rememberSessionValue(faultCounts, subject, (existing ?? 0) + 1, bound)
}

const pagesForSession = (pageStores: PageStoreBySession, sessionKey: string, sessionBound: number): SessionPageStore => {
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

const storeEvictedPage = (pageStore: SessionPageStore, entry: PageEntry, limit: number): number => {
  pageStore.set(pageKeyOf(entry.tool, entry.subject, entry.msgIndex, entry.partIndex, entry.stashSlot), entry)
  return trimPages(pageStore, limit)
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

const sessionIDFromContext = (source: unknown): string | undefined => {
  const sessionID =
    typeof source === "object" && source !== null ? (source as { sessionID?: unknown }).sessionID : undefined
  return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : undefined
}

const sessionKeyFromContext = (source: unknown): string => sessionIDFromContext(source) ?? FALLBACK_SESSION_KEY

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

// Cross-session pages for one subject, read fresh per miss (misses are the
// rare path) in file order, so the last matching line is the newest page.
// Any read or parse failure degrades to no pages: a corrupt or unreadable
// store is a clean miss, never a thrown tool error.
const pageStoreMatchesFor = async (options: ResolvedOptions, subject: string): Promise<PageEntry[]> => {
  if (options.pageStore === false) return []
  let content: string
  try {
    content = await readFile(options.pageStorePath, "utf8")
  } catch {
    return []
  }
  const matches: PageEntry[] = []
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const entry = pageStoreLineOf(parsed)
    if (entry !== undefined && entry.subject === subject) matches.push(entry)
  }
  return matches
}

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
): Promise<string> => {
  const source = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : undefined
  const subject = source?.[RECALL_ARG_NAME]
  if (typeof subject !== "string" || subject.length === 0) return invalidSubjectTextFor(typeof subject)
  const countsOnly = source?.[RECALL_PROBE_ARG_NAME] === true
  const sessionKey = sessionKeyFromContext(toolContext)
  const pageStore = pageStores.get(sessionKey)
  const matches = pageStore === undefined ? [] : pageMatchesFor(pageStore, subject)
  if (matches.length === 0) {
    const pages = await pageStoreMatchesFor(options, subject)
    if (pages.length === 0) {
      // The probe's miss answers exactly today's miss text without the
      // hydration await or the recallMisses increment: zero side effects.
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

// Raw counters start at zero, derived from the shared schema key list so a
// counter added there is initialized here too instead of reading undefined.
// The cast is a type escape: Object.fromEntries types as a string-indexed
// record, so the schema tuple's key coverage is asserted with the cast
// rather than carried by the type.
const zeroedRawCounters = Object.fromEntries(RAW_COUNTER_KEYS.map((key) => [key, 0])) as Record<RawCounterKey, number>

const createSessionMetrics = (): SessionMetrics => ({
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const persistedMsOf = (value: unknown): number | undefined => {
  if (typeof value !== "string") return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

// Absent keys default to 0 (records written before a counter existed),
// while a present-but-non-finite value rejects the whole record: a corrupt
// raw counter means the record cannot be trusted, so the seeder refuses it
// and falls through to the next-newest record. Absence marks the upgrade
// boundaries instead: a totals block missing the first-crossing
// reasoning-bytes key predates the 2026-09 reasoning reset, and a block
// missing any of the 2026-10-02 renamed keys (recallHits, recallMisses,
// pagesDropped, faults, dedupedBytesUnique) predates that reset, so its
// totals were accumulated under spellings and semantics the current schema
// cannot mean; the seeder rejects such records wholesale and the session
// restarts at zero rather than rehydrating figures the new schema cannot
// mean.
const UPGRADE_REQUIRED_COUNTER_KEYS: readonly RawCounterKey[] = [
  "reasoningBytesExpiredUnique",
  "recallHits",
  "recallMisses",
  "pagesDropped",
  "faults",
  "dedupedBytesUnique",
]

const persistedCounterOf = (totals: Record<string, unknown>, key: RawCounterKey): number | undefined => {
  const value = totals[key]
  if (value === undefined) return UPGRADE_REQUIRED_COUNTER_KEYS.includes(key) ? undefined : 0
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

type PersistedCounters = Pick<SessionMetrics, RawCounterKey>

type PersistedContextLimit = { tokens: number; source: ContextTokensSource; modelKey: string | undefined }

type PersistedContextLimitSeed = { budget: PersistedContextLimit | undefined }

type PersistedTotals = { tsMs: number; counters: PersistedCounters; budget: PersistedContextLimit | undefined }

const CONTEXT_TOKENS_SOURCES: readonly ContextTokensSource[] = [
  CONTEXT_TOKENS_SOURCE_OVERRIDE,
  CONTEXT_TOKENS_SOURCE_MODEL,
  CONTEXT_TOKENS_SOURCE_DEFAULT,
  CONTEXT_TOKENS_SOURCE_UNKNOWN,
]

const isContextTokensSource = (value: unknown): value is ContextTokensSource =>
  (CONTEXT_TOKENS_SOURCES as readonly unknown[]).includes(value)

// Absent or null budget fields mean the record predates budget
// persistence or the session genuinely had no budget (both rehydrate to
// unknown, exactly the pre-persistence behavior), while a
// present-but-invalid pair rejects the whole record under the same
// discipline as a corrupt raw counter: the record cannot be trusted.
// The persisted model key is optional metadata: absent or null
// rehydrates to no model identity (an untracked or option-sourced
// budget), while a blank or non-string value rejects the record. Undefined return
// rejects the seed; a defined one carries the budget or unknown.
const persistedContextLimitSeedOf = (parsed: Record<string, unknown>): PersistedContextLimitSeed | undefined => {
  const tokens = parsed["contextLimit"]
  if (tokens === undefined || tokens === null) return { budget: undefined }
  if (typeof tokens !== "number" || Number.isFinite(tokens) === false || tokens <= 0) return undefined
  const source = parsed["contextLimitSource"]
  if (isContextTokensSource(source) === false) return undefined
  const rawModelKey = parsed["contextLimitModelKey"]
  if (rawModelKey !== undefined && rawModelKey !== null && (typeof rawModelKey !== "string" || rawModelKey.length === 0)) return undefined
  return { budget: { tokens, source, modelKey: typeof rawModelKey === "string" ? rawModelKey : undefined } }
}

const persistedCountersOf = (value: unknown): PersistedCounters | undefined => {
  if (!isRecord(value)) return undefined
  const counters = {} as PersistedCounters
  for (const key of RAW_COUNTER_KEYS) {
    const seeded = persistedCounterOf(value, key)
    if (seeded === undefined) return undefined
    counters[key] = seeded
  }
  return counters
}

const checkpointTotalsSeedOf = async (options: ResolvedOptions, sessionKey: string): Promise<PersistedTotals | undefined> => {
  if (options.liveStateLog === false) return undefined
  if (!isSafeSessionFileStem(sessionKey)) return undefined
  let content: string
  try {
    content = await readFile(join(options.liveStatePath, `${sessionKey}${LIVE_STATE_FILE_SUFFIX}`), "utf8")
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed["session"] !== sessionKey) return undefined
  const tsMs = persistedMsOf(parsed["ts"])
  const counters = persistedCountersOf(parsed["totals"])
  const budgetSeed = persistedContextLimitSeedOf(parsed)
  if (tsMs === undefined || counters === undefined || budgetSeed === undefined) return undefined
  return { tsMs, counters, budget: budgetSeed.budget }
}

const logTotalsSeedOf = async (options: ResolvedOptions, sessionKey: string): Promise<PersistedTotals | undefined> => {
  if (options.metricsLog === false) return undefined
  let content: string
  try {
    content = await readFile(options.metricsPath, "utf8")
  } catch {
    return undefined
  }
  // Newest line first: the last match for the session wins, matching the
  // panel's newest-line preference including equal timestamps.
  const lines = content.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim()
    if (trimmed.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(parsed) || parsed["session"] !== sessionKey) continue
    const tsMs = persistedMsOf(parsed["ts"])
    const counters = persistedCountersOf(parsed["totals"])
    const budgetSeed = persistedContextLimitSeedOf(parsed)
    if (tsMs === undefined || counters === undefined || budgetSeed === undefined) continue
    return { tsMs, counters, budget: budgetSeed.budget }
  }
  return undefined
}

// The newest record wins, mirroring the panel's snapshot-versus-log
// preference: the snapshot covers quiet runs, while a strictly newer log
// line means another writer landed after the last snapshot.
const newestPersistedTotalsOf = async (options: ResolvedOptions, sessionKey: string): Promise<PersistedTotals | undefined> => {
  const [snapshotSeed, logSeed] = await Promise.all([checkpointTotalsSeedOf(options, sessionKey), logTotalsSeedOf(options, sessionKey)])
  if (snapshotSeed === undefined) return logSeed
  if (logSeed === undefined) return snapshotSeed
  return logSeed.tsMs > snapshotSeed.tsMs ? logSeed : snapshotSeed
}

const seedSessionCounters = (metrics: SessionMetrics, persisted: PersistedTotals): void => {
  Object.assign(metrics, persisted.counters)
  metrics.persistedBudget = persisted.budget
  // Raised with the seeded reads: without it the first post-restart run
  // would count every pre-restart stash read as read-since-last-line and
  // write a spurious eventful line.
  metrics.recallsLoggedThrough = persisted.counters.recallHits + persisted.counters.recallMisses
}

type MetricsHydrationEntry = { promise: Promise<void>; settled: boolean }

type MetricsHydration = Map<string, MetricsHydrationEntry>

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

const metricsForSession = async (
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

const countFaults = (metrics: SessionMetrics, appearances: ToolAppearance[], minSubstringChars: number): number => {
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

const recordRunOutcome = (metrics: SessionMetrics, run: RunOutcome, rememberedSubjectsBound: number): void => {
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

const rotateMetricsLogPastCap = async (path: string, incomingBytes: number, capBytes: number): Promise<void> => {
  if (capBytes === METRICS_ROTATION_DISABLED_MAX_BYTES) return
  let currentBytes: number
  try {
    currentBytes = (await stat(path)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return
    throw error
  }
  if (currentBytes + incomingBytes <= capBytes) return
  await rename(path, `${path}${METRICS_ROTATION_SUFFIX}`)
}

// The disk-copy escape hatch for ingestion hygiene: before a rewritten
// output lands, one JSONL line carries the tool name, the title when
// available, both lengths, and the full original, mirroring the host's
// own full-text-to-disk discipline. A cap of 0 disables the copy entirely
// (the strip still applies); a failed write degrades to hygieneWriteError
// on the session's diagnostics and never blocks the tool result.
const appendHygieneCopy = async (
  options: ResolvedOptions,
  metrics: MetricsStore,
  sessionKey: string,
  rewrite: { tool: string; title: string | undefined; original: string; stripped: string },
): Promise<void> => {
  if (options.ingestionHygieneRotationMaxBytes === HYGIENE_COPY_DISABLED_MAX_BYTES) return
  const line = {
    ts: new Date(options.now()).toISOString(),
    session: sessionKey,
    tool: rewrite.tool,
    ...(rewrite.title === undefined ? {} : { title: rewrite.title }),
    originalChars: rewrite.original.length,
    strippedChars: rewrite.stripped.length,
    output: rewrite.original,
  }
  try {
    const hygieneJsonLine = `${JSON.stringify(line)}\n`
    await rotateMetricsLogPastCap(options.ingestionHygienePath, Buffer.byteLength(hygieneJsonLine), options.ingestionHygieneRotationMaxBytes)
    await appendFile(options.ingestionHygienePath, hygieneJsonLine)
    const entry = touchMapEntry(metrics, sessionKey)
    if (entry !== undefined) delete entry.hygieneWriteError
  } catch (error) {
    withSessionMetricsEntry(metrics, sessionKey, options.metricsSessions, (target) => {
      target.hygieneWriteError = error instanceof Error ? error.message : String(error)
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
const recordPageStoreLines = async (
  options: ResolvedOptions,
  metrics: MetricsStore,
  sessionKey: string,
  entries: PageEntry[],
): Promise<void> => {
  if (options.pageStore === false || entries.length === 0) return
  if (options.pageStoreRotationMaxBytes === METRICS_ROTATION_DISABLED_MAX_BYTES) return
  // One clock read per run: the lines a single eviction produced share one
  // timestamp instead of drifting across the walk.
  const ts = new Date(options.now()).toISOString()
  try {
    const pageStoreJsonLine = `${entries
      .map((entry) =>
        JSON.stringify({
          ts,
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
    await rotateMetricsLogPastCap(options.pageStorePath, Buffer.byteLength(pageStoreJsonLine), options.pageStoreRotationMaxBytes)
    await appendFile(options.pageStorePath, pageStoreJsonLine)
    const entry = touchMapEntry(metrics, sessionKey)
    if (entry !== undefined) delete entry.pageStoreWriteError
  } catch (error) {
    withSessionMetricsEntry(metrics, sessionKey, options.metricsSessions, (target) => {
      target.pageStoreWriteError = error instanceof Error ? error.message : String(error)
    })
  }
}

const recordMetricsLine = async (
  options: ResolvedOptions,
  metrics: SessionMetrics,
  sessionKey: string,
  contextLimit: ContextLimit,
  run: RunOutcome,
): Promise<void> => {
  const { eviction, deduped: dedupedThisRun, faults: faultsThisRun, reasoningExpired: reasoningExpiredThisRun, fenceEvicted: fenceEvictedThisRun } = run
  const recallsSinceLastLine = metrics.recallHits + metrics.recallMisses - metrics.recallsLoggedThrough
  const nowMs = options.now()
  // The five recorded-event disjuncts feed both gates so the lists cannot
  // drift. Eventful runs are the candidates for a line: an eviction, dedup
  // tombstone, touch, fence event, or stash read, plus reasoning expiry; a
  // budget-source change alone stays quiet. Among eventful runs, the
  // significant ones always flush: any recorded event, plus a budget-source
  // change against the last flushed line (a change the panel renders per
  // line, and the first line of a session counts as one). Reasoning expiry
  // re-reports the session's standing aged set on every run, so a
  // reasoning-only run inside the coalesce window writes nothing; the
  // window is measured from the session's previous flushed line and a
  // suppressed run does not move it, so sustained reasoning-only traffic
  // settles at one line per interval.
  const hasRecordedEvent =
    eviction.evicted.length > 0 ||
    dedupedThisRun > 0 ||
    faultsThisRun > 0 ||
    fenceEvictedThisRun.blocks > 0 ||
    recallsSinceLastLine > 0
  const isEventful = hasRecordedEvent || reasoningExpiredThisRun.parts > 0
  if (options.metricsLog === false || isEventful === false) return
  const hasSignificantEvent = hasRecordedEvent || contextLimit.source !== metrics.lastLineContextLimitSource
  const withinCoalesceWindow = metrics.lastLineAtMs !== undefined && nowMs - metrics.lastLineAtMs < options.metricsMinLineIntervalMs
  if (options.metricsMinLineIntervalMs > METRICS_COALESCING_DISABLED_MS && hasSignificantEvent === false && withinCoalesceWindow) return
  const line = {
    ts: new Date(nowMs).toISOString(),
    session: sessionKey,
    contextLimit: contextLimit.tokens,
    contextLimitSource: contextLimit.source,
    contextLimitModelKey: contextLimit.modelKey ?? null,
    estimatedTokens: eviction.estimatedTokens,
    toolPoolBytes: run.composition.toolPoolBytes,
    textChars: run.composition.textChars,
    reasoningInWindowBytes: run.composition.reasoningInWindowBytes,
    escapeBytes: run.composition.escapeBytes,
    attachmentBytes: run.composition.attachmentBytes,
    watermarkTokens: eviction.watermarkTokens,
    deficitTokens: eviction.deficitTokens,
    evictedThisRun: eviction.evicted.map((entry) => ({
      tool: entry.tool,
      subject: entry.subject,
      bytes: entry.bytes,
      attachmentBytes: entry.attachmentBytes,
      messagesAgo: entry.messagesAgo,
    })),
    dedupedThisRun,
    reasoningExpiredThisRun: reasoningExpiredThisRun.parts,
    reasoningBytesExpiredThisRun: reasoningExpiredThisRun.bytes,
    ...(run.dryRun === undefined
      ? {}
      : {
          wouldEvictThisRun: run.dryRun.wouldEvictCount,
          wouldEvictBytesThisRun: run.dryRun.wouldEvictBytes,
        }),
    fenceEvictedThisRun: fenceEvictedThisRun.blocks,
    faultsThisRun,
    recallsSinceLastLine,
    totals: totalsOf(metrics, options.charsPerToken),
  }
  try {
    const metricsJsonLine = `${JSON.stringify(line)}\n`
    await rotateMetricsLogPastCap(options.metricsPath, Buffer.byteLength(metricsJsonLine), options.metricsRotationMaxBytes)
    await appendFile(options.metricsPath, metricsJsonLine)
    metrics.recallsLoggedThrough = metrics.recallHits + metrics.recallMisses
    metrics.lastLineAtMs = nowMs
    metrics.lastLineContextLimitSource = contextLimit.source
    delete metrics.logWriteError
  } catch (error) {
    metrics.logWriteError = error instanceof Error ? error.message : String(error)
  }
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

const totalsOf = (metrics: SessionMetrics, charsPerToken: number): CumulativeCounters => {
  const metricsAsCounters = metrics as unknown as Record<TotalsKey, number>
  const totals = {} as CumulativeCounters
  for (const key of TOTALS_KEYS) {
    const bytesKey = DERIVED_TOTAL_SOURCES[key as TotalsDerivedKey]
    totals[key] = bytesKey === undefined ? metricsAsCounters[key] : estimateTokensFromBytes(metricsAsCounters[bytesKey], charsPerToken)
  }
  return totals
}

const sessionCheckpointOf = (
  sessionKey: string,
  contextLimit: ContextLimit,
  options: ResolvedOptions,
  metrics: SessionMetrics,
  lastRun: LastRunMetrics,
  pageStore: SessionPageStore,
  hotSubjects: HotSubject[],
): SessionCheckpoint => ({
  ts: new Date(options.now()).toISOString(),
  session: sessionKey,
  manualMode: options.manualMode,
  contextLimit: contextLimit.tokens,
  contextLimitSource: contextLimit.source,
  contextLimitModelKey: contextLimit.modelKey ?? null,
  lastRun,
  // Spread, not a present-undefined key: a below-band run must leave the
  // field absent from the JSON so pre-band readers and round-trip
  // deep-equals see the pre-change shape.
  ...(metrics.lastAdvisory === undefined ? {} : { advisory: metrics.lastAdvisory }),
  // Same tolerance for the retention audit: a snapshot carrying it renders
  // the panel's retention row, one without it renders none.
  // Same absent-when-empty rule as the describe block: a run that scanned
  // no live outputs leaves the field out of the JSON, so the panel renders
  // no retention row and round-trip deep-equals see the pre-change shape.
  ...(metrics.lastRetention === undefined || metrics.lastRetention.pool === 0 ? {} : { retention: metrics.lastRetention }),
  totals: totalsOf(metrics, options.charsPerToken),
  pageStore: { entries: pageStore.size, capacity: options.stashLimit },
  hotSubjects: orderedRenderedSubjectsOf(hotSubjects, options.hintSubjects),
})

// Prune runs after the snapshot write has landed, so every failure here
// is a skipped file, never a surfaced error. The directory scan itself is
// throttled to at most one per plugin instance per
// liveStatePruneMinIntervalMs (default MIN_MS_BETWEEN_PRUNE_SCANS, 0
// disables the throttle): opencode instantiates the plugin once per
// process, so an instance-level budget is a per-process budget in
// production. Per-session snapshots fire far more often than state files
// expire, so the scan that usually finds nothing is the expensive part. A
// scan landing inside the window is skipped entirely, which only
// postpones pruning; once the window elapses the next snapshot write
// scans again. Tests inject a 0 interval to assert scan effects
// time-independently; the throttled path is pinned time-independently by
// asserting that a stale file planted right after a completed scan
// survives the next snapshot write, and the window expiry is pinned by
// the injected now() clock, whose advanceMs crosses the throttle interval
// in zero real time.
const isPrunableStateFileName = (name: string): boolean =>
  name.endsWith(LIVE_STATE_FILE_SUFFIX) || name.endsWith(`${LIVE_STATE_FILE_SUFFIX}${LIVE_STATE_TEMP_FILE_SUFFIX}`)

const pruneCheckpointFiles = async (
  dir: string,
  maxAgeMs: number,
  throttle: PruneThrottle,
  minIntervalMs: number,
  nowMs: number,
): Promise<void> => {
  if (maxAgeMs <= 0) return
  if (minIntervalMs > PRUNE_SCAN_THROTTLE_DISABLED) {
    if (throttle.lastScanMs !== PRUNE_SCAN_NEVER && nowMs - throttle.lastScanMs < minIntervalMs) return
    throttle.lastScanMs = nowMs
  }
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (!isPrunableStateFileName(name)) continue
    const path = join(dir, name)
    try {
      const info = await stat(path)
      if (nowMs - info.mtimeMs > maxAgeMs) await unlink(path)
    } catch {
      continue
    }
  }
}

const isSafeSessionFileStem = (sessionKey: string): boolean =>
  sessionKey.length > 0 && sessionKey !== "." && sessionKey !== ".." && !sessionKey.includes(PATH_SEGMENT_SEPARATOR)

const recordSessionCheckpoint = async (
  options: ResolvedOptions,
  sessionKey: string,
  contextLimit: ContextLimit,
  metrics: SessionMetrics,
  pageStore: SessionPageStore,
  hotSubjects: HotSubject[],
  pruneThrottle: PruneThrottle,
): Promise<void> => {
  if (options.liveStateLog === false) return
  const lastRun = metrics.lastRun
  if (lastRun === undefined) return
  if (!isSafeSessionFileStem(sessionKey)) return
  const snapshot = sessionCheckpointOf(sessionKey, contextLimit, options, metrics, lastRun, pageStore, hotSubjects)
  const stateFile = join(options.liveStatePath, `${sessionKey}${LIVE_STATE_FILE_SUFFIX}`)
  const tempFile = `${stateFile}${LIVE_STATE_TEMP_FILE_SUFFIX}`
  try {
    await mkdir(options.liveStatePath, { recursive: true })
    // Write to a sibling temp file and rename so a concurrent reader sees
    // either the previous snapshot or the new one, never a torn write.
    await writeFile(tempFile, `${JSON.stringify(snapshot, null, JSON_INDENT_SPACES)}\n`)
    await rename(tempFile, stateFile)
    delete metrics.stateWriteError
  } catch (error) {
    metrics.stateWriteError = error instanceof Error ? error.message : String(error)
    await unlink(tempFile).catch(() => {})
    return
  }
  await pruneCheckpointFiles(options.liveStatePath, options.liveStatePruneMaxAgeMs, pruneThrottle, options.liveStatePruneMinIntervalMs, options.now())
}

const modelKeyOf = (model: ChatParamsModel | undefined): string | undefined => {
  const providerID = model?.providerID
  const modelID = model?.modelID
  if (typeof providerID !== "string" || providerID.length === 0) return undefined
  if (typeof modelID !== "string" || modelID.length === 0) return undefined
  return `${providerID}${MODEL_KEY_SEPARATOR}${modelID}`
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

// An entry without an identity (a limit-only chat params event) is never
// reset: nothing ties it to a model, so any later event retains it.
const storedContextLimitBelongsToAnotherModel = (stored: ContextLimitEntry | undefined, modelKey: string | undefined): boolean =>
  modelKey !== undefined && stored !== undefined && stored.modelKey !== undefined && stored.modelKey !== modelKey

const captureContextLimitOf = (model: ChatParamsModel | undefined, overrides: Record<string, number>): ContextLimitEntry | undefined => {
  const modelKey = modelKeyOf(model)
  const override = modelKey === undefined ? undefined : overrides[modelKey]
  if (override !== undefined) return { tokens: override, source: CONTEXT_TOKENS_SOURCE_OVERRIDE, modelKey }
  const reported = model?.limit?.context
  if (typeof reported === "number" && Number.isFinite(reported) && reported > 0)
    return { tokens: reported, source: CONTEXT_TOKENS_SOURCE_MODEL, modelKey }
  return undefined
}

const resolveContextLimit = (sessionEntry: ContextLimitEntry | undefined, explicitDefault: number | undefined): ContextLimit => {
  if (sessionEntry !== undefined) return { tokens: sessionEntry.tokens, source: sessionEntry.source, modelKey: sessionEntry.modelKey }
  if (explicitDefault !== undefined) return { tokens: explicitDefault, source: CONTEXT_TOKENS_SOURCE_DEFAULT, modelKey: undefined }
  return { tokens: null, source: CONTEXT_TOKENS_SOURCE_UNKNOWN, modelKey: undefined }
}

type ContextLimitResolution = { contextLimit: ContextLimit; fallbackSuppressed: boolean }

// Shared by the transform hook and describe so the two surfaces resolve
// identically. Precedence: a live chat.params capture, the explicit
// defaultContextTokens option, then the budget persisted for the session;
// the persisted value fills only the unknown state. The fallback is
// suppressed when the persisted budget carries a model identity and this
// sitting's chat.params events name a different model: the session
// changed models (mid sitting or across a restart), so the old model's
// budget must not refill and eviction stands down instead. A fallback
// without a model identity (option-sourced, or a snapshot predating the
// model key) is never suppressed, matching the tolerant legacy shape.
const contextLimitForRun = (
  sessionEntry: ContextLimitEntry | undefined,
  persistedBudget: PersistedContextLimit | undefined,
  sittingModelKey: string | undefined,
  resolvedOptions: Pick<ResolvedOptions, "modelContextTokens" | "defaultContextTokens">,
): ContextLimitResolution => {
  const resolved = resolveContextLimit(sessionEntry, resolvedOptions.defaultContextTokens)
  if (resolved.tokens !== null) return { contextLimit: resolved, fallbackSuppressed: false }
  if (persistedBudget === undefined) return { contextLimit: resolved, fallbackSuppressed: false }
  // A budget sourced from config that config no longer carries must not
  // refill: an override survives only while its model key stays in
  // modelContextTokens, a default only while defaultContextTokens is set.
  const configRemoved =
    (persistedBudget.source === CONTEXT_TOKENS_SOURCE_OVERRIDE &&
      (persistedBudget.modelKey === undefined || resolvedOptions.modelContextTokens[persistedBudget.modelKey] === undefined)) ||
    (persistedBudget.source === CONTEXT_TOKENS_SOURCE_DEFAULT && resolvedOptions.defaultContextTokens === undefined)
  if (configRemoved) return { contextLimit: resolved, fallbackSuppressed: true }
  if (persistedBudget.modelKey !== undefined && sittingModelKey !== undefined && persistedBudget.modelKey !== sittingModelKey) {
    return { contextLimit: resolved, fallbackSuppressed: true }
  }
  return {
    contextLimit: { tokens: persistedBudget.tokens, source: persistedBudget.source, modelKey: persistedBudget.modelKey },
    fallbackSuppressed: false,
  }
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
// read tier claims it, or when the watermark tier still has deficit left
// to cover. A null deficit (no effective watermark) disarms the watermark
// tier entirely and leaves the aged tier unaffected.
const isEvictedByWalkPolicy = (
  entry: EvictableEntry,
  listLength: number,
  options: ResolvedOptions,
  deficitTokens: number | null,
  reclaimedTokens: number,
): boolean => isAgedReadEntry(entry, listLength, options) || (deficitTokens !== null && reclaimedTokens < deficitTokens)

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

type DryRunResult = { deficitTokens: number; wouldEvictCount: number; wouldEvictBytes: number; wouldEvictSubjects: string[] }

// The advisory pressure band below the effective watermark: the newest
// run's preview of how close the session sits to eviction. The band start
// is ratio x effective watermark and the estimate tested is the shared
// candidates' pre-eviction figure, the same one the dry run prices, so
// the preview and the evictor can never disagree about the session's size.
// Returns undefined when disarmed, when no effective watermark exists, or
// when the estimate sits below the band start; never mutates anything.
type AdvisoryResult = {
  ratio: number
  bandStartTokens: number
  estimatedTokens: number
  deficitTokens: number
  subjects: string[]
}

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

const orderedRenderedSubjectsOf = (hotSubjects: HotSubject[], limit: number): string[] => {
  if (limit <= 0) return []
  const seen = new Set<string>()
  const rendered: string[] = []
  const ordered = [...hotSubjects].sort((a, b) => b.lastTouch - a.lastTouch)
  for (const { subject } of ordered) {
    const renderedSubject = renderSubject(subject)
    if (seen.has(renderedSubject)) continue
    seen.add(renderedSubject)
    rendered.push(renderedSubject)
    if (rendered.length >= limit) break
  }
  return rendered
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
  pruneThrottle: PruneThrottle
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
  const rangeCollapse = collapseRangeReads(messages, options)
  const dedupedThisRun = toolDedup.tombstones + fileDedup.tombstones
  // The lifetime unique credit gates count and bytes alike on the pair
  // identity: a standing duplicate re-tombstones every run, but only its
  // first creation credits the pair's superseded bytes.
  const { unique: dedupedUniqueThisRun, bytes: dedupedBytesUniqueThisRun } = countUniqueDedupedPairs(sessionMetrics, [
    ...toolDedup.tombstonedPairs,
    ...fileDedup.tombstonedPairs,
  ])
  purgeErroredToolInputs(messages, options)
  const reasoningExpiredThisRun = expireAgedReasoning(sessionMetrics, messages, options)
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
  storeHint(deps.hintBySession, sessionKey, eviction.hotSubjects, options.hintSubjects, options.hintSessions)
  await recordPageStoreLines(options, deps.metricsBySession, sessionKey, pageStoreEntries)
  await recordMetricsLine(options, sessionMetrics, sessionKey, contextLimit, runOutcome)
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

// Create-or-update on the session metrics store: the shared shape behind
// rememberError and the hygiene copy's error surfacing, so a diagnostic
// recorded for a session with no entry yet (a fault, compaction event, or
// hygiene write error before the first transform) still lands on a
// created entry that respects the session bound. An existing entry is
// refreshed to most-recent recency: a session emitting diagnostics is an
// active session. The fresh entry is keyed by the diagnostic's session,
// not seeded from any persisted record, so a later reseed overwriting it
// is accepted (faults and write errors are run-scoped diagnostics).
const withSessionMetricsEntry = (
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

const rememberError = (metrics: MetricsStore, sessionKey: string, lastError: LastError, sessionBound: number): void =>
  withSessionMetricsEntry(metrics, sessionKey, sessionBound, (entry) => {
    entry.lastError = lastError
  })

const chatParamsHookBody = (
  input: { sessionID: string; model?: ChatParamsModel },
  contextLimits: Map<string, ContextLimitEntry>,
  modelKeyBySession: Map<string, string | undefined>,
  metricsBySession: MetricsStore,
  options: ResolvedOptions,
): void => {
  const modelKey = modelKeyOf(input.model)
  // The sitting's newest model identity rides the transform side: the
  // persisted-budget fallback suppresses itself against it when the
  // session changed models, mid sitting or across a restart.
  rememberSessionValue(modelKeyBySession, input.sessionID, modelKey, options.limitSessions)
  const captured = captureContextLimitOf(input.model, options.modelContextTokens)
  if (captured !== undefined) {
    rememberSessionValue(contextLimits, input.sessionID, captured, options.limitSessions)
    return
  }
  const stored = contextLimits.get(input.sessionID)
  if (!storedContextLimitBelongsToAnotherModel(stored, modelKey)) return
  contextLimits.delete(input.sessionID)
  // A model change also invalidates the persisted-budget fallback:
  // without this, the deleted live capture would refill from the
  // previous model's rehydrated budget on the next run.
  const metrics = metricsBySession.get(input.sessionID)
  if (metrics !== undefined) metrics.persistedBudget = undefined
}

// One-time data migration for the plugin family rename: stored metrics,
// live state, and hygiene copies under the previous lru-* basenames move to
// the current names on the first default-path load, before any hook is
// returned, so the producer and the panel readers observe the same
// locations and accumulated history stays reachable. Each kind migrates
// only while the plugin actually uses it (the metricsLog, liveStateLog,
// and hygiene-copy switches respectively). Every rename targets its new
// name only while that name does not exist yet, and an existing current
// name wins with the legacy file left readable beside it; the rotated
// sibling carries the same check of its own, so a load that moved the
// primary but failed on the sibling moves the stranded sibling on the
// next default-path load. A configured path option bypasses migration
// entirely: the user chose their own locations. A failed rename degrades
// the way the write paths do, never blocking plugin load: the legacy file
// stays in place and the next default-path load retries, since the
// condition simply re-runs each time.
const LEGACY_METRICS_FILE_BASENAME = "lru-metrics.jsonl"
const LEGACY_LIVE_STATE_DIR_BASENAME = "lru-state"
const LEGACY_INGESTION_HYGIENE_FILE_BASENAME = "lru-hygiene.jsonl"

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const migrateLegacyFileWithRotatedSibling = async (oldPath: string, newPath: string): Promise<void> => {
  if ((await pathExists(newPath)) === false && (await pathExists(oldPath))) await rename(oldPath, newPath)
  const oldRotatedPath = `${oldPath}${METRICS_ROTATION_SUFFIX}`
  if ((await pathExists(oldRotatedPath)) === false) return
  const newRotatedPath = `${newPath}${METRICS_ROTATION_SUFFIX}`
  if (await pathExists(newRotatedPath)) return
  await rename(oldRotatedPath, newRotatedPath)
}

const migrateLegacyDirectory = async (oldDir: string, newDir: string): Promise<void> => {
  if ((await pathExists(newDir)) || (await pathExists(oldDir)) === false) return
  await rename(oldDir, newDir)
}

const usesDefaultPath = (path: string | undefined): boolean => !isNonEmptyString(path)

// One default-location migration: the legacy basename beside the derived
// default path, moved to the default path itself. Undefined when the user
// configured their own path or the kind's logging is off.
const legacyPathMigration = (
  rawPath: string | undefined,
  migrationEnabled: boolean,
  defaultPath: () => string,
  legacyBasename: string,
  migrate: (oldPath: string, newPath: string) => Promise<void>,
): (() => Promise<void>) | undefined => {
  if (usesDefaultPath(rawPath) === false || migrationEnabled === false) return undefined
  return () => {
    const newPath = defaultPath()
    return migrate(join(dirname(newPath), legacyBasename), newPath)
  }
}

const migrateLegacyDefaultPaths = async (raw: ContextManagerOptions): Promise<void> => {
  for (const migration of [
    legacyPathMigration(raw.metricsPath, raw.metricsLog !== false, defaultMetricsPath, LEGACY_METRICS_FILE_BASENAME, migrateLegacyFileWithRotatedSibling),
    legacyPathMigration(raw.liveStatePath, raw.liveStateLog !== false, defaultLiveStateDir, LEGACY_LIVE_STATE_DIR_BASENAME, migrateLegacyDirectory),
    legacyPathMigration(raw.ingestionHygienePath, raw.ingestionHygieneCopy !== false, defaultIngestionHygienePath, LEGACY_INGESTION_HYGIENE_FILE_BASENAME, migrateLegacyFileWithRotatedSibling),
  ]) {
    if (migration === undefined) continue
    try {
      await migration()
    } catch {
      // Degrade like the write paths: the old location stays in place, the
      // plugin loads, and the next default-path load retries the move.
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
  const metricsBySession: MetricsStore = new Map()
  const metricsHydrationBySession: MetricsHydration = new Map()
  const pruneThrottle: PruneThrottle = { lastScanMs: PRUNE_SCAN_NEVER }
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
    pruneThrottle,
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
    executeReadEvicted(pageStoreBySession, metricsBySession, metricsHydrationBySession, persistedTotalsForSession, options.metricsSessions, options, args, toolContext)

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
