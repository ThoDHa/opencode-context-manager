import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PanelMetricsLine } from "../plugin/panel-data.ts"
import type { TotalsKey } from "../plugin/schema.ts"

const SESSION_A = "sess-panel-a"
const SESSION_B = "sess-panel-b"
const BUDGET_TOKENS_MODEL = 200000
const BUDGET_TOKENS_SMALL = 600
const ESTIMATED_TOKENS = 123456
const WATERMARK_TOKENS = 100000
const DEFICIT_TOKENS = 23456
const EVICTED_BYTES = 3072
const EVICTED_MESSAGES_AGO = 7
const TOTALS_EVICTIONS = 5
const TOTALS_BYTES = 12288
const TOTALS_STASH_HITS = 4
const TOTALS_STASH_MISSES = 6
const TOTALS_STASH_DROPPED = 1
const TOTALS_DEDUPED = 9
const TOTALS_DEDUPED_UNIQUE = 4
// Not a schema key: the retired per-request-recounted cumulative count,
// kept as the needle the panel-rows negative assertion expects never to
// see rendered beside "reasoning".
const TOTALS_REASONING_EXPIRED = 7
const TOTALS_REASONING_EXPIRED_UNIQUE = 3
const TOTALS_REASONING_BYTES_UNIQUE = 2560
const TOTALS_FENCE_EVICTED = 2
const TOTALS_TOUCHES = 3
const TOTALS_PROCESSED_CONTEXT_BYTES = 78000
const TOTALS_PROCESSED_CONTEXT_TOKENS = 19500
const TOTALS_EVICTION_TOKENS_SAVED = 3072
const TOTALS_DEDUP_TOKENS_SAVED = 2250
const TOTALS_COLLAPSED_WINDOW_TOKENS_SAVED = 1024
const TOTALS_REASONING_TOKENS_SAVED = 640
const EXPECTED_REASONING_STAT = `Reasoning expired: ${TOTALS_REASONING_EXPIRED_UNIQUE}, ${TOTALS_REASONING_TOKENS_SAVED} tokens`
const EXPECTED_DEDUPED_STAT = `Deduped: ${TOTALS_DEDUPED_UNIQUE}, 2.3k tokens`
const EXPECTED_TOKENS_PROCESSED_STAT = "Tokens processed: 19.5k tokens"

const HUGE_RECLAIMED_BYTES = 123456789012

const UNKNOWN_CONTEXT_LIMIT_SOURCE = "unknown"
const OVERRIDE_CONTEXT_LIMIT_SOURCE = "override"
const MODEL_CONTEXT_LIMIT_SOURCE = "model"

const SNAPSHOT_SUFFIX = ".json"
const SNAPSHOT_STASH_ENTRIES = 2
const SNAPSHOT_STASH_CAPACITY = 50
const SNAPSHOT_HOT_SUBJECTS = ["/data/hot-a.txt", "/data/hot-b.txt"]
const SNAPSHOT_TS = "2026-09-18T09:00:00.000Z"
const LOG_LINE_TS_STALE = "2026-09-18T08:00:00.000Z"

const LOG_LINE_ONLY_EVICTIONS = TOTALS_EVICTIONS + 1
const TOTALS_DEDUPED_BYTES = 9000
const TOTALS_COLLAPSED_WINDOWS = 2
const TOTALS_COLLAPSED_WINDOW_BYTES = 4096

// One value per shared schema totals key: the mapped type forces a fixture
// value for every key in plugin/schema.ts, so a counter added there
// fails to compile here until it is given a value.
const TOTALS_VALUES: Record<TotalsKey, number> = {
  evictions: TOTALS_EVICTIONS,
  bytesReclaimed: TOTALS_BYTES,
  evictionTokensSaved: TOTALS_EVICTION_TOKENS_SAVED,
  recallHits: TOTALS_STASH_HITS,
  recallMisses: TOTALS_STASH_MISSES,
  pagesDropped: TOTALS_STASH_DROPPED,
  deduped: TOTALS_DEDUPED,
  dedupedBytesUnique: TOTALS_DEDUPED_BYTES,
  dedupedUnique: TOTALS_DEDUPED_UNIQUE,
  dedupTokensSaved: TOTALS_DEDUP_TOKENS_SAVED,
  collapsedWindows: TOTALS_COLLAPSED_WINDOWS,
  collapsedWindowBytes: TOTALS_COLLAPSED_WINDOW_BYTES,
  collapsedWindowTokensSaved: TOTALS_COLLAPSED_WINDOW_TOKENS_SAVED,
  reasoningExpiredUnique: TOTALS_REASONING_EXPIRED_UNIQUE,
  reasoningBytesExpiredUnique: TOTALS_REASONING_BYTES_UNIQUE,
  reasoningTokensSaved: TOTALS_REASONING_TOKENS_SAVED,
  fenceEvicted: TOTALS_FENCE_EVICTED,
  faults: TOTALS_TOUCHES,
  processedContextBytes: TOTALS_PROCESSED_CONTEXT_BYTES,
  processedContextTokens: TOTALS_PROCESSED_CONTEXT_TOKENS,
}

const makeTotals = (): PanelMetricsLine["totals"] => ({ ...TOTALS_VALUES })

// A totals record written before the unique-event, unique-bytes, and
// token-savings keys existed (the new-key absence the strict parser must
// reject and the tolerant reader must skip: the pre-upgrade shape that
// resets persisted reasoning totals on upgrade).
const makePreSchemaTotals = (): Record<string, number> => {
  const {
    evictionTokensSaved: _evictionTokensSaved,
    dedupTokensSaved: _dedupTokensSaved,
    collapsedWindowTokensSaved: _collapsedWindowTokensSaved,
    reasoningTokensSaved: _reasoningTokensSaved,
    dedupedUnique: _dedupedUnique,
    reasoningExpiredUnique: _reasoningExpiredUnique,
    reasoningBytesExpiredUnique: _reasoningBytesExpiredUnique,
    collapsedWindows: _collapsedWindows,
    collapsedWindowBytes: _collapsedWindowBytes,
    processedContextBytes: _processedContextBytes,
    processedContextTokens: _processedContextTokens,
    ...preSchema
  } = TOTALS_VALUES
  return preSchema
}

// A totals record written before the processed-context token totals
// existed: the transitional shape whose absent keys parse as zero on both
// sides instead of rejecting the record.
const makePreTokenUsageTotals = (): Record<string, number> => {
  const { processedContextBytes: _processedContextBytes, processedContextTokens: _processedContextTokens, ...preTokenUsage } = TOTALS_VALUES
  return preTokenUsage
}

const makeLine = (overrides: Partial<PanelMetricsLine> = {}): PanelMetricsLine => ({
  session: SESSION_A,
  ts: LOG_LINE_TS_STALE,
  contextLimit: BUDGET_TOKENS_MODEL,
  contextLimitSource: MODEL_CONTEXT_LIMIT_SOURCE,
  estimatedTokens: ESTIMATED_TOKENS,
  watermarkTokens: WATERMARK_TOKENS,
  deficitTokens: DEFICIT_TOKENS,
  evictedThisRun: [{ tool: "read", subject: "/data/a.txt", bytes: EVICTED_BYTES, messagesAgo: EVICTED_MESSAGES_AGO }],
  totals: makeTotals(),
  ...overrides,
})

const serialize = (lines: PanelMetricsLine[]): string => lines.map((line) => JSON.stringify(line)).join("\n") + "\n"

const withTempDir = async (run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-panel-data-"))
  try {
    await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const makeSnapshot = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  ts: SNAPSHOT_TS,
  session: SESSION_A,
  manualMode: true,
  contextLimit: BUDGET_TOKENS_MODEL,
  contextLimitSource: MODEL_CONTEXT_LIMIT_SOURCE,
  lastRun: { estimatedTokens: ESTIMATED_TOKENS, watermarkTokens: WATERMARK_TOKENS, deficitTokens: DEFICIT_TOKENS },
  totals: makeTotals(),
  pageStore: { entries: SNAPSHOT_STASH_ENTRIES, capacity: SNAPSHOT_STASH_CAPACITY },
  hotSubjects: SNAPSHOT_HOT_SUBJECTS,
  ...overrides,
})

const writeSnapshot = (stateDir: string, sessionID: string, snapshot: unknown): void => {
  writeFileSync(join(stateDir, `${sessionID}${SNAPSHOT_SUFFIX}`), `${JSON.stringify(snapshot)}\n`)
}

const SECOND_LINE_ESTIMATED = 200000

const logLineAgainstSnapshot = (ts: string): PanelMetricsLine =>
  makeLine({
    ts,
    contextLimit: BUDGET_TOKENS_SMALL,
    estimatedTokens: SECOND_LINE_ESTIMATED,
    totals: { ...makeTotals(), evictions: LOG_LINE_ONLY_EVICTIONS },
  })

const logLineStaleAgainstSnapshot = (): PanelMetricsLine => logLineAgainstSnapshot(LOG_LINE_TS_STALE)

export {
  SESSION_A,
  SESSION_B,
  BUDGET_TOKENS_MODEL,
  BUDGET_TOKENS_SMALL,
  ESTIMATED_TOKENS,
  WATERMARK_TOKENS,
  DEFICIT_TOKENS,
  EVICTED_BYTES,
  EVICTED_MESSAGES_AGO,
  TOTALS_EVICTIONS,
  TOTALS_BYTES,
  TOTALS_STASH_HITS,
  TOTALS_STASH_MISSES,
  TOTALS_DEDUPED,
  TOTALS_DEDUPED_UNIQUE,
  TOTALS_COLLAPSED_WINDOWS,
  TOTALS_COLLAPSED_WINDOW_BYTES,
  TOTALS_COLLAPSED_WINDOW_TOKENS_SAVED,
  TOTALS_REASONING_EXPIRED,
  TOTALS_REASONING_EXPIRED_UNIQUE,
  TOTALS_REASONING_BYTES_UNIQUE,
  TOTALS_REASONING_TOKENS_SAVED,
  EXPECTED_REASONING_STAT,
  EXPECTED_DEDUPED_STAT,
  EXPECTED_TOKENS_PROCESSED_STAT,
  TOTALS_FENCE_EVICTED,
  TOTALS_PROCESSED_CONTEXT_BYTES,
  TOTALS_PROCESSED_CONTEXT_TOKENS,
  UNKNOWN_CONTEXT_LIMIT_SOURCE,
  OVERRIDE_CONTEXT_LIMIT_SOURCE,
  MODEL_CONTEXT_LIMIT_SOURCE,
  HUGE_RECLAIMED_BYTES,
  SNAPSHOT_SUFFIX,
  SNAPSHOT_STASH_ENTRIES,
  SNAPSHOT_STASH_CAPACITY,
  SNAPSHOT_HOT_SUBJECTS,
  SNAPSHOT_TS,
  LOG_LINE_TS_STALE,
  LOG_LINE_ONLY_EVICTIONS,
  SECOND_LINE_ESTIMATED,
  makeTotals,
  makePreSchemaTotals,
  makePreTokenUsageTotals,
  makeLine,
  serialize,
  withTempDir,
  makeSnapshot,
  writeSnapshot,
  logLineAgainstSnapshot,
  logLineStaleAgainstSnapshot,
}
