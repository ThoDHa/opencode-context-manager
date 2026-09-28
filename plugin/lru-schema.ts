// Single source of truth for the metrics totals schema shared by the
// producer (lru-context.ts: SessionMetrics seeding, CumulativeCounters,
// totalsOf) and the parser (lru-panel-data.ts: PanelTotals, parseTotals),
// plus the default path constants both files re-declared. Zero imports:
// both consumers stay dependency-free, and a counter added here reaches
// both sides in one edit instead of a six-file lockstep.

export const DEFAULT_METRICS_DIR_SEGMENTS = [".local", "share", "opencode"]
export const DEFAULT_METRICS_FILE_BASENAME = "lru-metrics.jsonl"
export const DEFAULT_LIVE_STATE_DIR_BASENAME = "lru-state"

// Raw counters a session's persisted totals carry and seed. A key must be
// a finite number in every persisted record: the producer seeds from this
// list, the parser requires every key, so a new counter is added here and
// both sides pick it up.
export const RAW_COUNTER_KEYS = Object.freeze([
  "evictions",
  "bytesReclaimed",
  "stashHits",
  "stashMisses",
  "stashDropped",
  "deduped",
  "dedupedBytes",
  "dedupedUnique",
  "collapsedWindows",
  "collapsedWindowBytes",
  "reasoningExpired",
  "reasoningBytesExpired",
  "reasoningExpiredUnique",
  "postEvictionTouches",
  "fenceEvicted",
] as const)

export type RawCounterKey = (typeof RAW_COUNTER_KEYS)[number]

// Derived counters: the producer computes them from the raw counters over
// the charsPerToken factor (the totalsOf map in lru-context.ts names each
// derived key's source byte counter); the parser requires them like raw
// keys, so the full totals shape is RawCounterKey plus these.
export const DERIVED_COUNTER_KEYS = Object.freeze([
  "evictionTokensSaved",
  "dedupTokensSaved",
  "collapsedWindowTokensSaved",
  "reasoningTokensSaved",
] as const)

export type DerivedCounterKey = (typeof DERIVED_COUNTER_KEYS)[number]

export const TOTALS_KEYS = Object.freeze([...RAW_COUNTER_KEYS, ...DERIVED_COUNTER_KEYS] as const)

export type TotalsKey = (typeof TOTALS_KEYS)[number]
