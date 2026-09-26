import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

const EVICTION_MARKER = "[lru-evicted]"
const HINT_MARKER = "[lru-hot]"
const HINT_LABEL = "recently active:"
const HINT_LINE_PREFIX = `${HINT_MARKER} ${HINT_LABEL}`
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
const RELOAD_TOOL_NAME = "read_evicted"
const RELOAD_ARG_NAME = "subject"
const RELOAD_TOOL_DESCRIPTION =
  "Return the full original content of anything the LRU Context Manager evicted and stashed: a tool call output or a fenced code block from an old user message. Pass the subject exactly as it appears in the eviction notice."
const RELOAD_ARG_DESCRIPTION = "The subject exactly as named in the eviction notice"
const RELOAD_ARG_SCHEMA_TYPE = "string"
const RELOAD_ARG_SCHEMA: Record<string, string> = {
  type: RELOAD_ARG_SCHEMA_TYPE,
  description: RELOAD_ARG_DESCRIPTION,
}
const RELOAD_POINTER_LEAD = " Evicted output stashed; reload it with"
const DIGEST_POINTER_LEAD = " Output digest: "
const DIGEST_POINTER_TAIL = "."
const STASH_MARKER = "[lru-stash]"
const STASH_OLDER_LEAD = "older matches for subject"
const STASH_MESSAGE_LABEL = "at message"
const STASH_MATCH_SEPARATOR = "; "
const STASH_MISS_LEAD = "no stashed output for subject"
const STASH_MISS_HINT = "only outputs evicted during this session are stashed"
const STASH_INVALID_SUBJECT_LEAD = "requires a non-empty subject string"
const RECEIVED_LABEL = "received"
const FALLBACK_SESSION_KEY = "no-session"
const DEDUP_MARKER = "[lru-deduped]"
const DEDUP_SUPERSEDED_LEAD = "identical call superseded by the newer output at message"
const DEDUP_FILE_SUPERSEDED_LEAD = "identical attachment superseded by the newer attachment at message"
const FILE_PART_TYPE = "file"
const FILE_FILENAME_KEY = "filename"
const TEXT_PART_TYPE = "text"
const PURGED_INPUT_MARKER = "[lru-purged-input]"
const REASONING_PART_TYPE = "reasoning"
const REASONING_TEXT_KEY = "text"
const REASONING_METADATA_KEY = "metadata"
const DEFAULT_METRICS_SESSIONS = 8
const DEFAULT_REMEMBERED_EVICTED_SUBJECTS = 100
const TOUCH_SCAN_INITIAL_WATERMARK = -1
const DEFAULT_REMEMBERED_REASONING_PARTS = 4096
const DEFAULT_REMEMBERED_DEDUP_PAIRS = 4096
const DEFAULT_METRICS_LOG_ENABLED = true
const METRICS_DIR_SEGMENTS = [".local", "share", "opencode"]
const METRICS_FILE_BASENAME = "lru-metrics.jsonl"
const DEFAULT_METRICS_PATH = join(homedir(), ...METRICS_DIR_SEGMENTS, METRICS_FILE_BASENAME)
const DEFAULT_LIVE_STATE_LOG_ENABLED = true
const LIVE_STATE_DIR_BASENAME = "lru-state"
const DEFAULT_LIVE_STATE_DIR = join(homedir(), ...METRICS_DIR_SEGMENTS, LIVE_STATE_DIR_BASENAME)
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
const DEFAULT_METRICS_ROTATION_MAX_BYTES = 20 * 1024 * 1024
const METRICS_ROTATION_DISABLED_MAX_BYTES = 0
const METRICS_ROTATION_SUFFIX = ".1"
const DEFAULT_METRICS_MIN_LINE_INTERVAL_MS = SECONDS_PER_MINUTE * MS_PER_SECOND
const METRICS_COALESCING_DISABLED_MS = 0
const STATS_TOOL_NAME = "lru_stats"
const STATS_TOOL_DESCRIPTION =
  "Return live metrics for the LRU Context Manager in this session: eviction counters, expired reasoning counts, post-eviction touches, stash occupancy, the effective context budget, and the most recent transform run's token estimate."
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
const FENCE_EVICTION_MARKER = "[lru-evicted-fence]"
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

type LruContextOptions = {
  watermark?: number
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
  liveStateLog?: boolean
  liveStatePath?: string
  liveStatePruneMaxAgeMs?: number
  liveStatePruneMinIntervalMs?: number
  manualMode?: boolean
  userFenceEviction?: { enabled?: boolean; minBlockLines?: number }
}

type CompiledGlob = { regexp: RegExp; matchesSegments: boolean }

type ResolvedOptions = Omit<Required<LruContextOptions>, "defaultContextTokens" | "modelContextTokens" | "protectedPatterns" | "userFenceEviction"> & {
  defaultContextTokens?: number
  modelContextTokens: Record<string, number>
  protectedPatterns: CompiledGlob[]
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
  stashDropped: number
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
  dedupedBytes: number
  dedupedUnique: number
  touches: number
  reasoningExpired: ReasoningExpiry
  fenceEvicted: FenceEviction
}

type ReasoningExpiry = { parts: number; bytes: number; unique: number }

type ContextTokensSource =
  | typeof CONTEXT_TOKENS_SOURCE_OVERRIDE
  | typeof CONTEXT_TOKENS_SOURCE_MODEL
  | typeof CONTEXT_TOKENS_SOURCE_DEFAULT
  | typeof CONTEXT_TOKENS_SOURCE_UNKNOWN

type SessionBudgetEntry = { tokens: number; source: ContextTokensSource; modelKey: string | undefined }

type SessionBudget = { tokens: number | null; source: ContextTokensSource; modelKey: string | undefined }

type PruneThrottle = { lastScanMs: number }

type ChatParamsModel = { providerID?: string; modelID?: string; limit?: { context?: number } }

type SessionMetrics = {
  evictions: number
  bytesReclaimed: number
  stashHits: number
  stashMisses: number
  stashDropped: number
  deduped: number
  dedupedBytes: number
  dedupedUnique: number
  reasoningExpired: number
  reasoningBytesExpired: number
  reasoningExpiredUnique: number
  postEvictionTouches: number
  fenceEvicted: number
  evictedSubjects: Subject[]
  touchScanThrough: number
  // Per-entry memory for the unique-event counters: content identities of
  // reasoning parts and dedup pairs already counted. They reset when the
  // metrics LRU evicts and reseeds the entry, so unique counts are
  // per-entry-lifetime, not per-process; identical content counts once.
  reasoningSeenKeys: string[]
  dedupedPairKeys: string[]
  stashReadsLoggedThrough: number
  // Per-process bookkeeping for the metrics line coalesce gate: the moment
  // of the session's last flushed line and the budget source it carried.
  // Never persisted; a restart simply writes on its next eventful run.
  lastLineAtMs?: number
  lastLineBudgetSource?: ContextTokensSource
  // The budget resolved at this session's previous sitting, rehydrated
  // with the counters so a restart does not flicker the budget to
  // unknown; a live chat.params capture always wins over it.
  persistedBudget?: PersistedBudget
  lastRun?: LastRunMetrics
  logWriteError?: string
  stateWriteError?: string
}

type MetricsStore = Map<string, SessionMetrics>

// The raw counters a session's persisted totals can seed, anchored to
// SessionMetrics by the exhaustiveness assertion below so a renamed or
// removed counter fails to compile here instead of silently missing its
// seed. The runtime seeder iterates this same list.
const RAW_COUNTER_KEYS = [
  "evictions",
  "bytesReclaimed",
  "stashHits",
  "stashMisses",
  "stashDropped",
  "deduped",
  "dedupedBytes",
  "dedupedUnique",
  "reasoningExpired",
  "reasoningBytesExpired",
  "reasoningExpiredUnique",
  "postEvictionTouches",
  "fenceEvicted",
] as const

type RawCounterKey = (typeof RAW_COUNTER_KEYS)[number]

// Two-directional exhaustiveness: every number-valued SessionMetrics key
// other than the per-process cursors must appear in RawCounterKey, so a
// newly added counter fails to compile until it is added to the seeded set.
// Cursor inventory beyond the two number cursors in MetricsCursorKey: the
// optional coalesce-gate fields lastLineAtMs and lastLineBudgetSource escape
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
type MetricsCursorKey = "touchScanThrough" | "stashReadsLoggedThrough"
type UnseededMetricKeys = Exclude<Exclude<NumberValuedSessionMetricKey, MetricsCursorKey>, RawCounterKey>
type AssertEveryMetricSeeded = UnseededMetricKeys extends never ? true : never
const everyMetricIsSeeded: AssertEveryMetricSeeded = true

type CumulativeCounters = {
  evictions: number
  bytesReclaimed: number
  evictionTokensSaved: number
  stashHits: number
  stashMisses: number
  stashDropped: number
  deduped: number
  dedupedBytes: number
  dedupedUnique: number
  dedupTokensSaved: number
  reasoningExpired: number
  reasoningBytesExpired: number
  reasoningExpiredUnique: number
  reasoningTokensSaved: number
  postEvictionTouches: number
  fenceEvicted: number
}

type LiveStateSnapshot = {
  ts: string
  session: string
  manualMode: boolean
  modelContextTokens: number | null
  modelContextTokensSource: ContextTokensSource
  lastRun: LastRunMetrics
  totals: CumulativeCounters
  stash: { entries: number; capacity: number }
  hotSubjects: string[]
}

type StatsSource = {
  options: ResolvedOptions
  limits: Map<string, SessionBudgetEntry>
  modelKeys: Map<string, string | undefined>
  stashes: StashStore
  metrics: MetricsStore
}

type RetainedDuplicate = { msgIndex: number; tool: string; supersedes: boolean }

type FilePartFields = { mime: string; url: string; filename: string }

type RetainedFileDuplicate = { msgIndex: number; label: string }

type DedupTarget = { stateRef: { output: string; attachments?: unknown }; tool: string; input: Record<string, unknown> }

type DedupOutcome = { tombstones: number; supersededBytes: number; tombstonedKeys: string[] }

type MessageBundle = {
  info: { sessionID?: string; role?: unknown }
  parts: Array<Record<string, unknown>>
}

type StashEntry = {
  output: string
  tool: string
  subject: string
  msgIndex: number
  partIndex: number
  attachments?: unknown[]
  stashSlot?: number
}

type SessionStash = Map<string, StashEntry>

type StashStore = Map<string, SessionStash>

const modelContextTokensOf = (raw: Record<string, number> | undefined): Record<string, number> => {
  if (typeof raw !== "object" || raw === null) return {}
  const resolved: Record<string, number> = {}
  for (const [key, tokens] of Object.entries(raw)) {
    if (typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0) resolved[key] = tokens
  }
  return resolved
}

const userFenceEvictionOf = (raw: LruContextOptions["userFenceEviction"]): UserFenceEvictionOptions => {
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

const resolveOptions = (raw: LruContextOptions = {}): ResolvedOptions => {
  const protectedPatterns =
    Array.isArray(raw.protectedPatterns) && raw.protectedPatterns.every((pattern) => typeof pattern === "string" && pattern.length > 0)
      ? raw.protectedPatterns
      : DEFAULT_PROTECTED_PATTERNS
  return {
    watermark: typeof raw.watermark === "number" && raw.watermark > 0 && raw.watermark < 1 ? raw.watermark : DEFAULT_WATERMARK_RATIO,
    recentWindow: typeof raw.recentWindow === "number" && raw.recentWindow >= 0 ? Math.floor(raw.recentWindow) : DEFAULT_RECENT_WINDOW_MESSAGES,
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
    protectedTools:
      Array.isArray(raw.protectedTools) && raw.protectedTools.every((tool) => typeof tool === "string" && tool.length > 0)
        ? raw.protectedTools
        : DEFAULT_PROTECTED_TOOLS,
    protectedPatterns: protectedPatterns.flatMap((pattern) => {
      const compiled = compiledGlobOf(pattern)
      return compiled === undefined ? [] : [compiled]
    }),
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
    metricsPath: typeof raw.metricsPath === "string" && raw.metricsPath.length > 0 ? raw.metricsPath : DEFAULT_METRICS_PATH,
    metricsRotationMaxBytes:
      typeof raw.metricsRotationMaxBytes === "number" && Number.isFinite(raw.metricsRotationMaxBytes) && raw.metricsRotationMaxBytes >= 0
        ? raw.metricsRotationMaxBytes
        : DEFAULT_METRICS_ROTATION_MAX_BYTES,
    metricsMinLineIntervalMs:
      typeof raw.metricsMinLineIntervalMs === "number" && Number.isFinite(raw.metricsMinLineIntervalMs) && raw.metricsMinLineIntervalMs >= 0
        ? raw.metricsMinLineIntervalMs
        : DEFAULT_METRICS_MIN_LINE_INTERVAL_MS,
    liveStateLog: typeof raw.liveStateLog === "boolean" ? raw.liveStateLog : DEFAULT_LIVE_STATE_LOG_ENABLED,
    liveStatePath: typeof raw.liveStatePath === "string" && raw.liveStatePath.length > 0 ? raw.liveStatePath : DEFAULT_LIVE_STATE_DIR,
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
    userFenceEviction: userFenceEvictionOf(raw.userFenceEviction),
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
  if (outputRef.output.startsWith(EVICTION_MARKER) || outputRef.output.startsWith(DEDUP_MARKER)) return undefined
  const tool = part["tool"]
  if (typeof tool !== "string") return undefined
  const typedState = part["state"] as Record<string, unknown>
  const input = typeof typedState["input"] === "object" && typedState["input"] !== null ? (typedState["input"] as Record<string, unknown>) : {}
  return { stateRef: outputRef, tool, input }
}

const deduplicateToolOutputs = (messages: MessageBundle[], options: ResolvedOptions): DedupOutcome => {
  const retainedByKey = new Map<string, RetainedDuplicate>()
  let tombstones = 0
  let supersededBytes = 0
  const tombstonedKeys: string[] = []
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
        supersededBytes += target.stateRef.output.length + attachmentPayloadCharsOf(target.stateRef)
        target.stateRef.output = buildDedupTombstone(retained.tool, retained.msgIndex)
        stripStateAttachments(target.stateRef)
        tombstones += 1
        tombstonedKeys.push(key)
      }
    }
  }
  return { tombstones, supersededBytes, tombstonedKeys }
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
  const tombstonedKeys: string[] = []
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
      tombstonedKeys.push(key)
    }
  }
  // A file part's payload size is not observable from its url, so file dedup
  // contributes tombstones but no superseded bytes to the savings estimate.
  return { tombstones, supersededBytes: 0, tombstonedKeys }
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
// entry and resets if that entry is evicted from the metrics LRU and
// reseeded within one process.
const countUniqueDedupedPairs = (metrics: SessionMetrics, keys: string[]): number => {
  let unique = 0
  for (const key of keys) {
    if (rememberUniqueKey(metrics.dedupedPairKeys, key, DEFAULT_REMEMBERED_DEDUP_PAIRS)) unique += 1
  }
  return unique
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

const purgeErroredToolInputs = (messages: MessageBundle[], options: ResolvedOptions): void => {
  const hotFromIndex = hotFromIndexOf(messages, options)
  for (let msgIndex = 0; msgIndex < hotFromIndex; msgIndex += 1) {
    for (const part of messages[msgIndex].parts) {
      if (part["type"] !== "tool") continue
      const state = part["state"]
      if (typeof state !== "object" || state === null) continue
      const typedState = state as Record<string, unknown>
      if (typedState["status"] !== "error") continue
      if (typedState["input"] === PURGED_INPUT_MARKER) continue
      typedState["input"] = PURGED_INPUT_MARKER
    }
  }
}

// Message indices are unstable across runs: opencode trims stored messages,
// and the recent window rides the tail, so a part is identified by its own
// content (text plus metadata, stringified with the same stable stringify
// the dedup pass keys inputs by) rather than by a msgIndex cursor like the
// touch watermark. A part counts unique the first run its identity is seen
// outside the recent window, and identical-content occurrences count once.
// The seen-set lives on the session's metrics entry, whose lifetime bounds
// the memory: the entry can be evicted from the metrics LRU and reseeded
// within one process, re-counting that session's standing set once per
// entry lifetime; unique can therefore exceed the entry's own cumulative
// count after a reseed but never the session's true unique total. The
// seen-set is also bounded, so only a same-content reappearance after a
// full bound worth of newer parts could count once more.
const expireAgedReasoning = (metrics: SessionMetrics, messages: MessageBundle[], options: ResolvedOptions): ReasoningExpiry => {
  const hotFromIndex = hotFromIndexOf(messages, options)
  let parts = 0
  let bytes = 0
  let unique = 0
  for (let msgIndex = 0; msgIndex < hotFromIndex; msgIndex += 1) {
    const messageParts = messages[msgIndex].parts
    for (let partIndex = messageParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = messageParts[partIndex]
      if (part["type"] !== REASONING_PART_TYPE) continue
      const text = part[REASONING_TEXT_KEY]
      if (typeof text === "string") bytes += text.length
      const identity = reasoningIdentityOf(text, part[REASONING_METADATA_KEY])
      if (rememberUniqueKey(metrics.reasoningSeenKeys, identity, DEFAULT_REMEMBERED_REASONING_PARTS)) unique += 1
      messageParts.splice(partIndex, 1)
      parts += 1
    }
  }
  return { parts, bytes, unique }
}

const stripLegacyHintParts = (messages: MessageBundle[]): void => {
  for (const message of messages) {
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      const text = part["text"]
      if (part["type"] === TEXT_PART_TYPE && typeof text === "string" && text.startsWith(HINT_LINE_PREFIX)) {
        message.parts.splice(partIndex, 1)
      }
    }
  }
}

type FenceSpan = { startLine: number; endLine: number; language: string | undefined }

type FenceReplacement = { startOffset: number; endOffset: number; replacement: string; bytes: number }

type FenceEviction = { blocks: number; bytes: number; stashDropped: number }

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

const evictLargeUserFences = (messages: MessageBundle[], options: ResolvedOptions, stash: SessionStash): FenceEviction => {
  if (options.userFenceEviction.enabled === false) return { blocks: 0, bytes: 0, stashDropped: 0 }
  const hotFromIndex = hotFromIndexOf(messages, options)
  const { minBlockLines } = options.userFenceEviction
  let blocks = 0
  let bytes = 0
  let stashDropped = 0
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
        stashDropped += stashEvictedOutput(
          stash,
          {
            output: blockText,
            tool: FENCE_STASH_TOOL_LABEL,
            subject,
            msgIndex,
            partIndex,
            stashSlot: span.startLine,
          },
          options.stashLimit,
        )
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
  return { blocks, bytes, stashDropped }
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
  `${RELOAD_POINTER_LEAD} ${RELOAD_TOOL_NAME} (subject "${subject}").`

const buildFenceTombstone = (language: string | undefined, contentLines: number, subject: string): string =>
  `${FENCE_EVICTION_MARKER} ${language === undefined ? FENCE_BLOCK_NOUN : `${language} ${FENCE_BLOCK_NOUN}`} (${contentLines} ${FENCE_LINE_COUNT_LABEL}, ${FENCE_FIRST_LINE_LABEL} "${subject}") ${FENCE_EVICTED_NOTICE}${buildReloadPointer(subject)}`

const stashKeyOf = (tool: string, subject: string, msgIndex: number, partIndex: number, stashSlot?: number): string =>
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

const stashForSession = (stashes: StashStore, sessionKey: string, sessionBound: number): SessionStash => {
  const touched = touchMapEntry(stashes, sessionKey)
  if (touched !== undefined) return touched
  trimMapToBound(stashes, sessionBound)
  const created: SessionStash = new Map()
  stashes.set(sessionKey, created)
  return created
}

const trimStash = (stash: SessionStash, limit: number): number => {
  let dropped = 0
  while (stash.size > limit) {
    const oldest = stash.keys().next()
    if (oldest.done === true) break
    stash.delete(oldest.value)
    dropped += 1
  }
  return dropped
}

const stashEvictedOutput = (stash: SessionStash, entry: StashEntry, limit: number): number => {
  stash.set(stashKeyOf(entry.tool, entry.subject, entry.msgIndex, entry.partIndex, entry.stashSlot), entry)
  return trimStash(stash, limit)
}

const stashMissTextFor = (subject: string): string =>
  `${STASH_MARKER} ${STASH_MISS_LEAD} "${subject}"; ${STASH_MISS_HINT}.`

const invalidSubjectTextFor = (received: string): string =>
  `${STASH_MARKER} ${RELOAD_TOOL_NAME} ${STASH_INVALID_SUBJECT_LEAD} (${RECEIVED_LABEL} ${received}).`

const olderMatchesLineFor = (subject: string, older: StashEntry[]): string =>
  `${STASH_MARKER} ${STASH_OLDER_LEAD} "${subject}": ${older
    .map((entry) => `${entry.tool} ${STASH_MESSAGE_LABEL} ${entry.msgIndex}`)
    .join(STASH_MATCH_SEPARATOR)}`

const stashedMatchesFor = (stash: SessionStash, subject: string): StashEntry[] => {
  const matches: StashEntry[] = []
  for (const entry of stash.values()) {
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

const stashedAttachmentsLineFor = (attachments: unknown[]): string =>
  `${STASH_MARKER} ${STASH_ATTACHMENTS_LEAD}: ${attachments.map(attachmentSummaryOf).join(SUBJECT_SEPARATOR)}; ${STASH_ATTACHMENT_DROPPED_TAIL}.`

const sessionIDFromContext = (source: unknown): string | undefined => {
  const sessionID =
    typeof source === "object" && source !== null ? (source as { sessionID?: unknown }).sessionID : undefined
  return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : undefined
}

const sessionKeyFromContext = (source: unknown): string => sessionIDFromContext(source) ?? FALLBACK_SESSION_KEY

const executeReadEvicted = async (
  stashes: StashStore,
  metrics: MetricsStore,
  hydrations: MetricsHydration,
  persistedTotalsForSession: (sessionKey: string) => Promise<PersistedTotals | undefined>,
  metricsSessionBound: number,
  args: unknown,
  toolContext: unknown,
): Promise<string> => {
  const subject = typeof args === "object" && args !== null ? (args as { subject?: unknown }).subject : undefined
  if (typeof subject !== "string" || subject.length === 0) return invalidSubjectTextFor(typeof subject)
  const sessionKey = sessionKeyFromContext(toolContext)
  const stash = stashes.get(sessionKey)
  const matches = stash === undefined ? [] : stashedMatchesFor(stash, subject)
  if (matches.length === 0) {
    // A first-touch hydration may still be seeding this session: await it
    // so the miss lands on the settled entry instead of vanishing with the
    // entry the seed replaces.
    const inFlight = hydrations.get(sessionKey)
    if (inFlight !== undefined) await inFlight.promise
    const existing = metrics.get(sessionKey)
    if (existing !== undefined) existing.stashMisses += 1
    return stashMissTextFor(subject)
  }
  // Refreshed before the await so the hit counts even if stash churn during
  // the hydration read evicts this session's stash entry.
  touchMapEntry(stashes, sessionKey)
  const sessionMetrics = await metricsForSession(metrics, hydrations, persistedTotalsForSession, sessionKey, metricsSessionBound)
  sessionMetrics.stashHits += 1
  const newest = matches[matches.length - 1]
  const older = matches.slice(0, -1)
  const output = older.length === 0 ? newest.output : `${newest.output}\n${olderMatchesLineFor(subject, older)}`
  return newest.attachments === undefined ? output : `${output}\n${stashedAttachmentsLineFor(newest.attachments)}`
}

const createSessionMetrics = (): SessionMetrics => ({
  evictions: 0,
  bytesReclaimed: 0,
  stashHits: 0,
  stashMisses: 0,
  stashDropped: 0,
  deduped: 0,
  dedupedBytes: 0,
  dedupedUnique: 0,
  reasoningExpired: 0,
  reasoningBytesExpired: 0,
  reasoningExpiredUnique: 0,
  postEvictionTouches: 0,
  fenceEvicted: 0,
  evictedSubjects: [],
  touchScanThrough: TOUCH_SCAN_INITIAL_WATERMARK,
  reasoningSeenKeys: [],
  dedupedPairKeys: [],
  stashReadsLoggedThrough: 0,
})

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
// and falls through to the next-newest record.
const persistedCounterOf = (totals: Record<string, unknown>, key: RawCounterKey): number | undefined => {
  const value = totals[key]
  if (value === undefined) return 0
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

type PersistedCounters = Pick<SessionMetrics, RawCounterKey>

type PersistedBudget = { tokens: number; source: ContextTokensSource; modelKey: string | undefined }

type PersistedBudgetSeed = { budget: PersistedBudget | undefined }

type PersistedTotals = { tsMs: number; counters: PersistedCounters; budget: PersistedBudget | undefined }

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
const persistedBudgetSeedOf = (parsed: Record<string, unknown>): PersistedBudgetSeed | undefined => {
  const tokens = parsed["modelContextTokens"]
  if (tokens === undefined || tokens === null) return { budget: undefined }
  if (typeof tokens !== "number" || Number.isFinite(tokens) === false || tokens <= 0) return undefined
  const source = parsed["modelContextTokensSource"]
  if (isContextTokensSource(source) === false) return undefined
  const rawModelKey = parsed["modelContextTokensModelKey"]
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

const snapshotTotalsSeedOf = async (options: ResolvedOptions, sessionKey: string): Promise<PersistedTotals | undefined> => {
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
  const budgetSeed = persistedBudgetSeedOf(parsed)
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
    const budgetSeed = persistedBudgetSeedOf(parsed)
    if (tsMs === undefined || counters === undefined || budgetSeed === undefined) continue
    return { tsMs, counters, budget: budgetSeed.budget }
  }
  return undefined
}

// The newest record wins, mirroring the panel's snapshot-versus-log
// preference: the snapshot covers quiet runs, while a strictly newer log
// line means another writer landed after the last snapshot.
const newestPersistedTotalsOf = async (options: ResolvedOptions, sessionKey: string): Promise<PersistedTotals | undefined> => {
  const [snapshotSeed, logSeed] = await Promise.all([snapshotTotalsSeedOf(options, sessionKey), logTotalsSeedOf(options, sessionKey)])
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
  metrics.stashReadsLoggedThrough = persisted.counters.stashHits + persisted.counters.stashMisses
}

type MetricsHydrationEntry = { promise: Promise<void>; settled: boolean }

type MetricsHydration = Map<string, MetricsHydrationEntry>

// One hydration per session key while it is in flight, and one seed per
// entry lifetime: the settled guard is replaced only when a freshly
// re-created entry asks for a reseed (the metrics LRU evicted the key and
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
  // LRU evicted this key, or created while its seed was still loading)
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

const countPostEvictionTouches = (metrics: SessionMetrics, appearances: ToolAppearance[], minSubstringChars: number): number => {
  let touches = 0
  let latestIndex = metrics.touchScanThrough
  for (const appearance of appearances) {
    if (appearance.msgIndex <= metrics.touchScanThrough) continue
    if (appearanceTouches(metrics.evictedSubjects, appearance, minSubstringChars)) touches += 1
    latestIndex = appearance.msgIndex
  }
  metrics.touchScanThrough = latestIndex
  return touches
}

const lastRunMetricsOf = (eviction: EvictionResult): LastRunMetrics => ({
  estimatedTokens: eviction.estimatedTokens,
  watermarkTokens: eviction.watermarkTokens,
  deficitTokens: eviction.deficitTokens,
})

const recordRunOutcome = (metrics: SessionMetrics, run: RunOutcome, rememberedSubjectsBound: number): void => {
  const { eviction, deduped: dedupedThisRun, dedupedBytes: dedupedBytesThisRun, dedupedUnique: dedupedUniqueThisRun, touches: touchesThisRun, reasoningExpired: reasoningExpiredThisRun, fenceEvicted: fenceEvictedThisRun } = run
  metrics.lastRun = lastRunMetricsOf(eviction)
  metrics.evictions += eviction.evicted.length
  metrics.stashDropped += eviction.stashDropped
  for (const entry of eviction.evicted) {
    metrics.bytesReclaimed += entry.bytes + entry.attachmentBytes
    metrics.evictedSubjects.push(...entry.subjects)
  }
  while (metrics.evictedSubjects.length > rememberedSubjectsBound) metrics.evictedSubjects.shift()
  metrics.deduped += dedupedThisRun
  metrics.dedupedBytes += dedupedBytesThisRun
  metrics.dedupedUnique += dedupedUniqueThisRun
  metrics.reasoningExpired += reasoningExpiredThisRun.parts
  metrics.reasoningBytesExpired += reasoningExpiredThisRun.bytes
  metrics.reasoningExpiredUnique += reasoningExpiredThisRun.unique
  metrics.postEvictionTouches += touchesThisRun
  metrics.fenceEvicted += fenceEvictedThisRun.blocks
  metrics.bytesReclaimed += fenceEvictedThisRun.bytes
  metrics.stashDropped += fenceEvictedThisRun.stashDropped
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

const recordMetricsLine = async (
  options: ResolvedOptions,
  metrics: SessionMetrics,
  sessionKey: string,
  budget: SessionBudget,
  run: RunOutcome,
): Promise<void> => {
  const { eviction, deduped: dedupedThisRun, touches: touchesThisRun, reasoningExpired: reasoningExpiredThisRun, fenceEvicted: fenceEvictedThisRun } = run
  const stashReadsSinceLastLine = metrics.stashHits + metrics.stashMisses - metrics.stashReadsLoggedThrough
  const nowMs = Date.now()
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
    touchesThisRun > 0 ||
    fenceEvictedThisRun.blocks > 0 ||
    stashReadsSinceLastLine > 0
  const isEventful = hasRecordedEvent || reasoningExpiredThisRun.parts > 0
  if (options.metricsLog === false || isEventful === false) return
  const hasSignificantEvent = hasRecordedEvent || budget.source !== metrics.lastLineBudgetSource
  const withinCoalesceWindow = metrics.lastLineAtMs !== undefined && nowMs - metrics.lastLineAtMs < options.metricsMinLineIntervalMs
  if (options.metricsMinLineIntervalMs > METRICS_COALESCING_DISABLED_MS && hasSignificantEvent === false && withinCoalesceWindow) return
  const line = {
    ts: new Date(nowMs).toISOString(),
    session: sessionKey,
    modelContextTokens: budget.tokens,
    modelContextTokensSource: budget.source,
    modelContextTokensModelKey: budget.modelKey ?? null,
    estimatedTokens: eviction.estimatedTokens,
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
    fenceEvictedThisRun: fenceEvictedThisRun.blocks,
    postEvictionTouchesThisRun: touchesThisRun,
    stashReadsSinceLastLine,
    totals: totalsOf(metrics, options.charsPerToken),
  }
  try {
    const metricsJsonLine = `${JSON.stringify(line)}\n`
    await rotateMetricsLogPastCap(options.metricsPath, Buffer.byteLength(metricsJsonLine), options.metricsRotationMaxBytes)
    await appendFile(options.metricsPath, metricsJsonLine)
    metrics.stashReadsLoggedThrough = metrics.stashHits + metrics.stashMisses
    metrics.lastLineAtMs = nowMs
    metrics.lastLineBudgetSource = budget.source
    delete metrics.logWriteError
  } catch (error) {
    metrics.logWriteError = error instanceof Error ? error.message : String(error)
  }
}

const totalsOf = (metrics: SessionMetrics, charsPerToken: number): CumulativeCounters => ({
  evictions: metrics.evictions,
  bytesReclaimed: metrics.bytesReclaimed,
  evictionTokensSaved: estimateTokensFromBytes(metrics.bytesReclaimed, charsPerToken),
  stashHits: metrics.stashHits,
  stashMisses: metrics.stashMisses,
  stashDropped: metrics.stashDropped,
  deduped: metrics.deduped,
  dedupedBytes: metrics.dedupedBytes,
  dedupedUnique: metrics.dedupedUnique,
  dedupTokensSaved: estimateTokensFromBytes(metrics.dedupedBytes, charsPerToken),
  reasoningExpired: metrics.reasoningExpired,
  reasoningBytesExpired: metrics.reasoningBytesExpired,
  reasoningExpiredUnique: metrics.reasoningExpiredUnique,
  reasoningTokensSaved: estimateTokensFromBytes(metrics.reasoningBytesExpired, charsPerToken),
  postEvictionTouches: metrics.postEvictionTouches,
  fenceEvicted: metrics.fenceEvicted,
})

const liveStateSnapshotOf = (
  sessionKey: string,
  budget: SessionBudget,
  options: ResolvedOptions,
  metrics: SessionMetrics,
  lastRun: LastRunMetrics,
  stash: SessionStash,
  hotSubjects: HotSubject[],
): LiveStateSnapshot => ({
  ts: new Date().toISOString(),
  session: sessionKey,
  manualMode: options.manualMode,
  modelContextTokens: budget.tokens,
  modelContextTokensSource: budget.source,
  modelContextTokensModelKey: budget.modelKey ?? null,
  lastRun,
  totals: totalsOf(metrics, options.charsPerToken),
  stash: { entries: stash.size, capacity: options.stashLimit },
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
// survives the next snapshot write, and the window expiry is pinned
// with a small injected interval plus a real wait.
const isPrunableStateFileName = (name: string): boolean =>
  name.endsWith(LIVE_STATE_FILE_SUFFIX) || name.endsWith(`${LIVE_STATE_FILE_SUFFIX}${LIVE_STATE_TEMP_FILE_SUFFIX}`)

const pruneLiveStateFiles = async (
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

const recordLiveStateSnapshot = async (
  options: ResolvedOptions,
  sessionKey: string,
  budget: SessionBudget,
  metrics: SessionMetrics,
  stash: SessionStash,
  hotSubjects: HotSubject[],
  pruneThrottle: PruneThrottle,
): Promise<void> => {
  if (options.liveStateLog === false) return
  const lastRun = metrics.lastRun
  if (lastRun === undefined) return
  if (!isSafeSessionFileStem(sessionKey)) return
  const snapshot = liveStateSnapshotOf(sessionKey, budget, options, metrics, lastRun, stash, hotSubjects)
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
  await pruneLiveStateFiles(options.liveStatePath, options.liveStatePruneMaxAgeMs, pruneThrottle, options.liveStatePruneMinIntervalMs, Date.now())
}

const modelKeyOf = (model: ChatParamsModel | undefined): string | undefined => {
  const providerID = model?.providerID
  const modelID = model?.modelID
  if (typeof providerID !== "string" || providerID.length === 0) return undefined
  if (typeof modelID !== "string" || modelID.length === 0) return undefined
  return `${providerID}${MODEL_KEY_SEPARATOR}${modelID}`
}

// An entry without an identity (a limit-only chat params event) is never
// reset: nothing ties it to a model, so any later event retains it.
const storedBudgetBelongsToAnotherModel = (stored: SessionBudgetEntry | undefined, modelKey: string | undefined): boolean =>
  modelKey !== undefined && stored !== undefined && stored.modelKey !== undefined && stored.modelKey !== modelKey

const captureBudgetOf = (model: ChatParamsModel | undefined, overrides: Record<string, number>): SessionBudgetEntry | undefined => {
  const modelKey = modelKeyOf(model)
  const override = modelKey === undefined ? undefined : overrides[modelKey]
  if (override !== undefined) return { tokens: override, source: CONTEXT_TOKENS_SOURCE_OVERRIDE, modelKey }
  const reported = model?.limit?.context
  if (typeof reported === "number" && Number.isFinite(reported) && reported > 0)
    return { tokens: reported, source: CONTEXT_TOKENS_SOURCE_MODEL, modelKey }
  return undefined
}

const resolveSessionBudget = (sessionEntry: SessionBudgetEntry | undefined, explicitDefault: number | undefined): SessionBudget => {
  if (sessionEntry !== undefined) return { tokens: sessionEntry.tokens, source: sessionEntry.source, modelKey: sessionEntry.modelKey }
  if (explicitDefault !== undefined) return { tokens: explicitDefault, source: CONTEXT_TOKENS_SOURCE_DEFAULT, modelKey: undefined }
  return { tokens: null, source: CONTEXT_TOKENS_SOURCE_UNKNOWN, modelKey: undefined }
}

type SessionBudgetResolution = { budget: SessionBudget; fallbackSuppressed: boolean }

// Shared by the transform hook and lru_stats so the two surfaces resolve
// identically. Precedence: a live chat.params capture, the explicit
// defaultContextTokens option, then the budget persisted for the session;
// the persisted value fills only the unknown state. The fallback is
// suppressed when the persisted budget carries a model identity and this
// sitting's chat.params events name a different model: the session
// changed models (mid sitting or across a restart), so the old model's
// budget must not refill and eviction stands down instead. A fallback
// without a model identity (option-sourced, or a snapshot predating the
// model key) is never suppressed, matching the tolerant legacy shape.
const sessionBudgetForRun = (
  sessionEntry: SessionBudgetEntry | undefined,
  persistedBudget: PersistedBudget | undefined,
  sittingModelKey: string | undefined,
  resolvedOptions: Pick<ResolvedOptions, "modelContextTokens" | "defaultContextTokens">,
): SessionBudgetResolution => {
  const resolved = resolveSessionBudget(sessionEntry, resolvedOptions.defaultContextTokens)
  if (resolved.tokens !== null) return { budget: resolved, fallbackSuppressed: false }
  if (persistedBudget === undefined) return { budget: resolved, fallbackSuppressed: false }
  // A budget sourced from config that config no longer carries must not
  // refill: an override survives only while its model key stays in
  // modelContextTokens, a default only while defaultContextTokens is set.
  const configRemoved =
    (persistedBudget.source === CONTEXT_TOKENS_SOURCE_OVERRIDE &&
      (persistedBudget.modelKey === undefined || resolvedOptions.modelContextTokens[persistedBudget.modelKey] === undefined)) ||
    (persistedBudget.source === CONTEXT_TOKENS_SOURCE_DEFAULT && resolvedOptions.defaultContextTokens === undefined)
  if (configRemoved) return { budget: resolved, fallbackSuppressed: true }
  if (persistedBudget.modelKey !== undefined && sittingModelKey !== undefined && persistedBudget.modelKey !== sittingModelKey) {
    return { budget: resolved, fallbackSuppressed: true }
  }
  return {
    budget: { tokens: persistedBudget.tokens, source: persistedBudget.source, modelKey: persistedBudget.modelKey },
    fallbackSuppressed: false,
  }
}

const executeLruStats = (source: StatsSource, toolContext: unknown): string => {
  const sessionID = sessionIDFromContext(toolContext)
  const sessionKey = sessionID ?? FALLBACK_SESSION_KEY
  const sessionLimit = sessionID === undefined ? undefined : touchMapEntry(source.limits, sessionID)
  const metrics = touchMapEntry(source.metrics, sessionKey) ?? createSessionMetrics()
  const { budget } = sessionBudgetForRun(sessionLimit, metrics.persistedBudget, sessionID === undefined ? undefined : source.modelKeys.get(sessionID), source.options)
  const stash = source.stashes.get(sessionKey)
  const report = {
    session: sessionKey,
    options: {
      watermark: source.options.watermark,
      recentWindow: source.options.recentWindow,
      minEvictableBytes: source.options.minEvictableBytes,
      defaultContextTokens: source.options.defaultContextTokens ?? null,
      modelContextTokens: source.options.modelContextTokens,
      metricsLog: source.options.metricsLog,
      metricsPath: source.options.metricsPath,
      metricsRotationMaxBytes: source.options.metricsRotationMaxBytes,
      metricsMinLineIntervalMs: source.options.metricsMinLineIntervalMs,
      liveStateLog: source.options.liveStateLog,
      liveStatePath: source.options.liveStatePath,
      liveStatePruneMaxAgeMs: source.options.liveStatePruneMaxAgeMs,
      liveStatePruneMinIntervalMs: source.options.liveStatePruneMinIntervalMs,
      userFenceEviction: {
        enabled: source.options.userFenceEviction.enabled,
        minBlockLines: source.options.userFenceEviction.minBlockLines,
      },
      manualMode: source.options.manualMode,
    },
    modelContextTokens: budget.tokens,
    modelContextTokensSource: budget.source,
    stash: { entries: stash === undefined ? 0 : stash.size, capacity: source.options.stashLimit },
    counters: totalsOf(metrics, source.options.charsPerToken),
    lastRun: metrics.lastRun ?? null,
    ...(metrics.logWriteError === undefined ? {} : { logWriteError: metrics.logWriteError }),
    ...(metrics.stateWriteError === undefined ? {} : { stateWriteError: metrics.stateWriteError }),
  }
  return JSON.stringify(report, null, JSON_INDENT_SPACES)
}

const liveSubjectsOf = (entries: EvictableEntry[]): HotSubject[] =>
  entries.flatMap((entry) =>
    entry.stateRef.output.startsWith(EVICTION_MARKER) || entry.stateRef.output.startsWith(DEDUP_MARKER)
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
      if (output.startsWith(EVICTION_MARKER) || output.startsWith(DEDUP_MARKER) || output.length < options.minEvictableBytes) continue
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

const measureWithoutEvicting = (messages: MessageBundle[], options: ResolvedOptions): EvictionResult => {
  const { appearances, entries } = scanToolOutputs(messages, options)
  return {
    hotSubjects: liveSubjectsOf(entries),
    appearances,
    estimatedTokens: estimateTokens(messages, options.charsPerToken),
    watermarkTokens: null,
    deficitTokens: null,
    evicted: [],
    stashDropped: 0,
  }
}

const evictLeastRecentlyUsed = (
  messages: MessageBundle[],
  options: ResolvedOptions,
  watermarkTokens: number,
  stash: SessionStash,
): EvictionResult => {
  const { appearances, entries } = scanToolOutputs(messages, options)

  const hotFromIndex = hotFromIndexOf(messages, options)
  const evictable = entries
    .filter((entry) => !isProtectedTool(entry.tool, options))
    .filter((entry) => entry.lastTouch < hotFromIndex)
    .filter((entry) => !isPatternProtected(entry.subjects, options))
    .sort((a, b) => a.lastTouch - b.lastTouch || b.bytes - a.bytes)

  const estimatedTokens = estimateTokens(messages, options.charsPerToken)
  const deficitTokens = estimatedTokens - watermarkTokens
  const evicted: EvictedEntryInfo[] = []
  let stashDropped = 0
  if (deficitTokens > 0 && evictable.length > 0) {
    let reclaimedTokens = 0
    for (const entry of evictable) {
      if (reclaimedTokens >= deficitTokens) break
      const subject = entry.subjects.length > 0 ? renderSubject(entry.subjects[0]) : UNKNOWN_TARGET_LABEL
      const messagesAgo = messages.length - entry.lastTouch
      const droppedAttachments = nonEmptyAttachmentsOf(entry.stateRef)
      const digest = buildOutputDigest(entry.tool, subject, entry.stateRef.output)
      const tombstone = buildTombstone(entry.tool, subject, entry.bytes, messagesAgo, droppedAttachments !== undefined, digest)
      const stashed: StashEntry = {
        output: entry.stateRef.output,
        tool: entry.tool,
        subject,
        msgIndex: entry.msgIndex,
        partIndex: entry.partIndex,
      }
      if (droppedAttachments !== undefined) stashed.attachments = droppedAttachments
      stashDropped += stashEvictedOutput(stash, stashed, options.stashLimit)
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
  }
  return {
    hotSubjects: liveSubjectsOf(entries),
    appearances,
    estimatedTokens,
    watermarkTokens,
    deficitTokens,
    evicted,
    stashDropped,
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

const deliverHint = (hintBySession: Map<string, string>, input: unknown, output: { system: string[] }): void => {
  if (!Array.isArray(output.system)) return
  const sessionKey = sessionKeyFromContext(input)
  const hintLine = touchMapEntry(hintBySession, sessionKey)
  if (hintLine === undefined) return
  const existingIndex = output.system.findIndex((block) => typeof block === "string" && block.startsWith(HINT_LINE_PREFIX))
  if (existingIndex === -1) output.system.push(hintLine)
  else output.system[existingIndex] = hintLine
}

export default (async (_input, rawOptions) => {
  const options = resolveOptions(rawOptions as LruContextOptions)
  const contextTokensBySession = new Map<string, SessionBudgetEntry>()
  const modelKeyBySession = new Map<string, string | undefined>()
  const stashBySession = new Map<string, SessionStash>()
  const hintBySession = new Map<string, string>()
  const metricsBySession: MetricsStore = new Map()
  const metricsHydrationBySession: MetricsHydration = new Map()
  const pruneThrottle: PruneThrottle = { lastScanMs: PRUNE_SCAN_NEVER }
  const persistedTotalsForSession = (sessionKey: string): Promise<PersistedTotals | undefined> =>
    newestPersistedTotalsOf(options, sessionKey)

  // Workaround: read_evicted and lru_stats are registered as plain
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
  const readEvicted = async (args: unknown, toolContext: unknown): Promise<string> =>
    executeReadEvicted(stashBySession, metricsBySession, metricsHydrationBySession, persistedTotalsForSession, options.metricsSessions, args, toolContext)

  const lruStats = async (_args: unknown, toolContext: unknown): Promise<string> =>
    executeLruStats({ options, limits: contextTokensBySession, modelKeys: modelKeyBySession, stashes: stashBySession, metrics: metricsBySession }, toolContext)

  return {
    "chat.params": async (input: { sessionID: string; model?: ChatParamsModel }) => {
      const modelKey = modelKeyOf(input.model)
      // The sitting's newest model identity rides the transform side: the
      // persisted-budget fallback suppresses itself against it when the
      // session changed models, mid sitting or across a restart.
      rememberSessionValue(modelKeyBySession, input.sessionID, modelKey, options.limitSessions)
      const captured = captureBudgetOf(input.model, options.modelContextTokens)
      if (captured !== undefined) {
        rememberSessionValue(contextTokensBySession, input.sessionID, captured, options.limitSessions)
        return
      }
      const stored = contextTokensBySession.get(input.sessionID)
      if (!storedBudgetBelongsToAnotherModel(stored, modelKey)) return
      contextTokensBySession.delete(input.sessionID)
      // A model change also invalidates the persisted-budget fallback:
      // without this, the deleted live capture would refill from the
      // previous model's rehydrated budget on the next run.
      const metrics = metricsBySession.get(input.sessionID)
      if (metrics !== undefined) metrics.persistedBudget = undefined
    },
    "experimental.chat.messages.transform": async (_input: unknown, output: { messages: MessageBundle[] }) => {
      const messages = output.messages
      if (!Array.isArray(messages) || messages.length === 0) return
      const info = messages[0]?.info
      const sessionKey = sessionKeyFromContext(info)
      const sessionID = info?.sessionID
      // The budget fallback rides the session metrics, so hydration must
      // land before resolution: a restart resolves the persisted budget
      // instead of flickering to unknown, and a live chat.params capture
      // still wins because the fallback fills only the unknown state.
      const sessionMetrics = await metricsForSession(metricsBySession, metricsHydrationBySession, persistedTotalsForSession, sessionKey, options.metricsSessions)
      const sessionLimit = sessionID !== undefined ? touchMapEntry(contextTokensBySession, sessionID) : undefined
      const sittingModelKey = sessionID === undefined ? undefined : modelKeyBySession.get(sessionID)
      const { budget, fallbackSuppressed } = sessionBudgetForRun(sessionLimit, sessionMetrics.persistedBudget, sittingModelKey, options)
      if (fallbackSuppressed) sessionMetrics.persistedBudget = undefined
      else if (budget.source !== CONTEXT_TOKENS_SOURCE_UNKNOWN) sessionMetrics.persistedBudget = { tokens: budget.tokens, source: budget.source, modelKey: budget.modelKey }
      const sessionStash = stashForSession(stashBySession, sessionKey, options.stashSessions)
      stripLegacyHintParts(messages)
      const toolDedup = deduplicateToolOutputs(messages, options)
      const fileDedup = deduplicateFileAttachments(messages, options)
      const dedupedThisRun = toolDedup.tombstones + fileDedup.tombstones
      const dedupedUniqueThisRun = countUniqueDedupedPairs(sessionMetrics, [
        ...toolDedup.tombstonedKeys,
        ...fileDedup.tombstonedKeys,
      ])
      purgeErroredToolInputs(messages, options)
      const reasoningExpiredThisRun = expireAgedReasoning(sessionMetrics, messages, options)
      const fenceEvictedThisRun = evictLargeUserFences(messages, options, sessionStash)
      const eviction =
        options.manualMode || budget.tokens === null
          ? measureWithoutEvicting(messages, options)
          : evictLeastRecentlyUsed(messages, options, budget.tokens * options.watermark, sessionStash)
      const touchesThisRun = countPostEvictionTouches(sessionMetrics, eviction.appearances, options.minSubstringMatchChars)
      const runOutcome: RunOutcome = {
        eviction,
        deduped: dedupedThisRun,
        dedupedBytes: toolDedup.supersededBytes,
        dedupedUnique: dedupedUniqueThisRun,
        touches: touchesThisRun,
        reasoningExpired: reasoningExpiredThisRun,
        fenceEvicted: fenceEvictedThisRun,
      }
      recordRunOutcome(sessionMetrics, runOutcome, options.rememberedEvictedSubjects)
      storeHint(hintBySession, sessionKey, eviction.hotSubjects, options.hintSubjects, options.hintSessions)
      await recordMetricsLine(options, sessionMetrics, sessionKey, budget, runOutcome)
      await recordLiveStateSnapshot(options, sessionKey, budget, sessionMetrics, sessionStash, eviction.hotSubjects, pruneThrottle)
    },
    "experimental.chat.system.transform": async (input: { sessionID?: string }, output: { system: string[] }) => {
      deliverHint(hintBySession, input, output)
    },
    tool: {
      [RELOAD_TOOL_NAME]: {
        description: RELOAD_TOOL_DESCRIPTION,
        args: { [RELOAD_ARG_NAME]: RELOAD_ARG_SCHEMA },
        execute: readEvicted,
      },
      [STATS_TOOL_NAME]: {
        description: STATS_TOOL_DESCRIPTION,
        args: {},
        execute: lruStats,
      },
    },
  }
}) satisfies Plugin
