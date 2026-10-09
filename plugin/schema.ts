// Single source of truth for the metrics totals schema shared by the
// producer (context-manager.ts: SessionMetrics seeding, CumulativeCounters,
// totalsOf), the parser (panel-data.ts: PanelTotals, parseTotals), and the
// TUI entry (context-manager.tui.tsx: PLUGIN_ID), the default path
// constants from which the producer and parser each build their default
// paths, and the option spellings and defaults of the cache-aware passes.
// Zero imports: every consumer stays dependency-free, and a counter
// added here reaches both sides in one edit instead of a six-file lockstep.

export const DEFAULT_METRICS_DIR_SEGMENTS = [".local", "share", "opencode"]
export const DEFAULT_METRICS_FILE_BASENAME = "context-metrics.jsonl"
export const DEFAULT_LIVE_STATE_DIR_BASENAME = "context-state"

// Canonical spellings and defaults for the cache-aware pass options: the
// producer resolves its option surface through these, so a consumer
// spelling an option differently cannot silently no-op. cacheAwareHints
// and mutationBatchCadence ship default-off pending the measurement
// program's conclusion; summarizeEvictedOutputs ships default-off for the
// same reason (the compression-on-evict flagship is judged by the lever5
// readout before it earns its default); evictionBatchMultiplier ships at
// its identity default 1, which reproduces the deficit-exact walk byte for
// byte; summaryTokenBudget ships at the compressor module's default 256.
// The README cache-model passage is the frame of record.
export const OPTION_CACHE_AWARE_HINTS = "cacheAwareHints"
export const DEFAULT_CACHE_AWARE_HINTS = false
export const OPTION_MUTATION_BATCH_CADENCE = "mutationBatchCadence"
export const DEFAULT_MUTATION_BATCH_CADENCE = 0
export const OPTION_EVICTION_BATCH_MULTIPLIER = "evictionBatchMultiplier"
export const DEFAULT_EVICTION_BATCH_MULTIPLIER = 1
export const OPTION_SUMMARIZE_EVICTED_OUTPUTS = "summarizeEvictedOutputs"
export const DEFAULT_SUMMARIZE_EVICTED_OUTPUTS = false
export const OPTION_SUMMARY_TOKEN_BUDGET = "summaryTokenBudget"
export const DEFAULT_SUMMARY_TOKEN_BUDGET = 256

// Shared by both entry modules so their registrations never drift.
export const PLUGIN_ID = "context-manager"

// Stamped onto every metrics line beside the session id so a log read
// after an upgrade or restart attributes each line to the release and
// writing process that produced it; the stamp is its only consumer, so
// a release bumps it and no UI surface echoes it.
export const PLUGIN_VERSION = "0.1.0"

// Raw counters a session's persisted totals carry and seed. A key must be
// a finite number in every persisted record: the producer seeds from this
// list, the parser requires every key, so a new counter is added here and
// both sides pick it up.
export const RAW_COUNTER_KEYS = Object.freeze([
  "evictions",
  "bytesReclaimed",
  "recallHits",
  "recallMisses",
  "pagesDropped",
  "deduped",
  "dedupedBytesUnique",
  "dedupedUnique",
  "collapsedWindows",
  "collapsedWindowBytes",
  "reasoningExpiredUnique",
  "reasoningBytesExpiredUnique",
  "faults",
  "fenceEvicted",
  "processedContextBytes",
  "summariesQueued",
  "summariesWritten",
  "summaryFailures",
] as const)

export type RawCounterKey = (typeof RAW_COUNTER_KEYS)[number]

// Derived counters: the producer computes them from the raw counters over
// the charsPerToken factor (the totalsOf map in context-manager.ts names each
// derived key's source byte counter); the parser requires them like raw
// keys, so the full totals shape is RawCounterKey plus these.
export const DERIVED_COUNTER_KEYS = Object.freeze([
  "evictionTokensSaved",
  "dedupTokensSaved",
  "collapsedWindowTokensSaved",
  "reasoningTokensSaved",
  "processedContextTokens",
] as const)

export type DerivedCounterKey = (typeof DERIVED_COUNTER_KEYS)[number]

export const TOTALS_KEYS = Object.freeze([...RAW_COUNTER_KEYS, ...DERIVED_COUNTER_KEYS] as const)

export type TotalsKey = (typeof TOTALS_KEYS)[number]
