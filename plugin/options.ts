import { homedir } from "node:os"
import { join } from "node:path"
import type { Subject } from "./vocabulary.ts"
import {
  DEFAULT_CACHE_AWARE_HINTS,
  DEFAULT_EVICTION_BATCH_MULTIPLIER,
  DEFAULT_LIVE_STATE_DIR_BASENAME,
  DEFAULT_METRICS_DIR_SEGMENTS,
  DEFAULT_METRICS_FILE_BASENAME,
  DEFAULT_MUTATION_BATCH_CADENCE,
  DEFAULT_SUMMARIZE_EVICTED_OUTPUTS,
  DEFAULT_SUMMARY_TOKEN_BUDGET,
  OPTION_CACHE_AWARE_HINTS,
  OPTION_EVICTION_BATCH_MULTIPLIER,
  OPTION_MUTATION_BATCH_CADENCE,
  OPTION_SUMMARIZE_EVICTED_OUTPUTS,
  OPTION_SUMMARY_TOKEN_BUDGET,
} from "./schema.ts"

const DEFAULT_CHARS_PER_TOKEN = 4
const DEFAULT_WATERMARK_RATIO = 0.5
const DEFAULT_RECENT_WINDOW_MESSAGES = 4
const DEFAULT_MIN_EVICTABLE_BYTES = 2048
const DEFAULT_HINT_SUBJECTS = 10

const DEFAULT_PROTECTED_TOOLS = ["task", "todowrite"]
const DEFAULT_PROTECTED_PATTERNS: string[] = []

const GLOB_DOUBLESTAR_TRAILING_SLASH = "**/"
const GLOB_DOUBLESTAR = "**"
const GLOB_SINGLE_STAR = "*"
const GLOB_QUESTION_MARK = "?"
const REGEX_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g
export const PATH_SEGMENT_SEPARATOR = "/"

const DEFAULT_MIN_SUBSTRING_MATCH_CHARS = 3

const DEFAULT_STASH_LIMIT = 50
const DEFAULT_STASH_SESSIONS = 8
const DEFAULT_LIMIT_SESSIONS = 8
const DEFAULT_HINT_SESSIONS = 8

const DEFAULT_METRICS_SESSIONS = 8
const DEFAULT_REMEMBERED_EVICTED_SUBJECTS = 100

const DEFAULT_METRICS_LOG_ENABLED = true
// The default locations derive per resolution instead of once at module
// load, so the migration below and the resolved options always agree on
// where the default paths are even if the process home is relocated.
export const defaultMetricsPath = (): string => join(homedir(), ...DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_METRICS_FILE_BASENAME)
const DEFAULT_LIVE_STATE_LOG_ENABLED = true
export const defaultLiveStateDir = (): string => join(homedir(), ...DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_LIVE_STATE_DIR_BASENAME)
const DEFAULT_INGESTION_HYGIENE = true
const DEFAULT_INGESTION_HYGIENE_COPY = true
const DEFAULT_INGESTION_HYGIENE_FILE_BASENAME = "context-hygiene.jsonl"
export const defaultIngestionHygienePath = (): string => join(homedir(), ...DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_INGESTION_HYGIENE_FILE_BASENAME)
// 5 MiB: hygiene lines carry the full original output, the fattest lines
// the plugin writes, and the copy is a paranoid escape hatch rather than
// a standing record, so its cap sits well under the metrics log's 20 MiB.
export const DEFAULT_INGESTION_HYGIENE_ROTATION_MAX_BYTES = 5 * 1024 * 1024

const DEFAULT_PAGE_STORE_ENABLED = true
const DEFAULT_PAGE_STORE_FILE_BASENAME = "context-pages.jsonl"
const defaultPageStorePath = (): string => join(homedir(), ...DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_PAGE_STORE_FILE_BASENAME)
// 20 MiB: metrics parity rather than the hygiene copy's smaller cap, because
// page lines carry the same fat verbatim-output content class the metrics
// log's cap was sized for, and the store is a standing record, not an
// escape hatch.
export const DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES = 20 * 1024 * 1024

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_PRUNE_INTERVAL = 7
const DEFAULT_LIVE_STATE_PRUNE_MAX_AGE_MS =
  DAYS_PER_PRUNE_INTERVAL * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND

const MIN_MS_BETWEEN_PRUNE_SCANS = 60 * MS_PER_SECOND

// 20 MiB: at the observed pre-coalescing rate of about 1.45 MB/day the
// previous 5 MiB cap kept only about 7 days across its two generations and
// older lines rotated out permanently within days; coalescing cut that
// rate by an estimated 70-85 percent, so two generations now hold roughly
// three weeks at the old rate and several times that at the current one.
export const DEFAULT_METRICS_ROTATION_MAX_BYTES = 20 * 1024 * 1024

const DEFAULT_METRICS_MIN_LINE_INTERVAL_MS = SECONDS_PER_MINUTE * MS_PER_SECOND

const DEFAULT_FENCE_EVICTABLE_LINES = 40
const DEFAULT_USER_FENCE_EVICTION_ENABLED = false
const DEFAULT_MANUAL_MODE = false
const DEFAULT_ADVISORY_BAND_ENABLED = true
export const ADVISORY_BAND_RATIO_DEFAULT = 0.85
export const ADVISORY_SUBJECTS_BOUND = 3
const DEFAULT_NOW = (): number => Date.now()

type UserFenceEvictionOptions = { enabled: boolean; minBlockLines: number }

export type ContextManagerOptions = {
  watermark?: number
  watermarkTokens?: number
  agedReadEvictionMessages?: number
  reasoningRetentionMessages?: number
  recentWindow?: number
  minEvictableBytes?: number
  defaultContextTokens?: number
  modelContextTokens?: Record<string, number>
  hintSubjects?: number
  cacheAwareHints?: boolean
  mutationBatchCadence?: number
  evictionBatchMultiplier?: number
  summarizeEvictedOutputs?: boolean
  summaryTokenBudget?: number
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

export type ResolvedOptions = Omit<
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

export const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0

export const resolveOptions = (raw: ContextManagerOptions = {}): ResolvedOptions => {
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
    [OPTION_CACHE_AWARE_HINTS]: typeof raw.cacheAwareHints === "boolean" ? raw.cacheAwareHints : DEFAULT_CACHE_AWARE_HINTS,
    // The hygiene passes' batch cadence in trigger-carrying runs: 0 (the
    // default) keeps every pass firing per request; N defers the passes'
    // mutations until the session's Nth trigger-carrying run fires them as
    // one batched mutation. The cache reasoning lives at resolveHygieneBatch.
    [OPTION_MUTATION_BATCH_CADENCE]: boundedIntegerOr(raw.mutationBatchCadence, DEFAULT_MUTATION_BATCH_CADENCE, 0),
    // The eviction walk's deficit multiplier: N clears N x the deficit per
    // firing, so reset events land rarer and larger; 1 (the default) is the
    // byte-identical deficit-exact walk. The cache reasoning lives at
    // isEvictedByWalkPolicy, the one disposition the multiplier widens.
    [OPTION_EVICTION_BATCH_MULTIPLIER]: boundedIntegerOr(raw.evictionBatchMultiplier, DEFAULT_EVICTION_BATCH_MULTIPLIER, 1),
    // The compression-on-evict gate: when true and the host provided a
    // client, each eviction-walk page queues one side-session model call
    // whose summary persists beside the page and serves recall by default.
    // Ships default-off pending the lever5 readout (the schema.ts
    // convention); false leaves every path byte-identical to the
    // pre-compression plugin.
    [OPTION_SUMMARIZE_EVICTED_OUTPUTS]:
      typeof raw.summarizeEvictedOutputs === "boolean" ? raw.summarizeEvictedOutputs : DEFAULT_SUMMARIZE_EVICTED_OUTPUTS,
    // The per-summary token budget: enforced by the prompt clause plus the
    // compressor's hard truncation, so the value bounds a summary's size
    // regardless of model compliance. Same bounded-integer discipline as
    // the other count options: integral and at least 1, else dropped.
    [OPTION_SUMMARY_TOKEN_BUDGET]: boundedIntegerOr(raw.summaryTokenBudget, DEFAULT_SUMMARY_TOKEN_BUDGET, 1),
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

export const isProtectedTool = (tool: string, options: ResolvedOptions): boolean => options.protectedTools.includes(tool)

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

export const isPatternProtected = (subjects: Subject[], options: ResolvedOptions): boolean =>
  options.protectedPatterns.some((compiled) => subjects.some((subject) => globMatches(compiled, subject.path)))
