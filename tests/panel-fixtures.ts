import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PanelMetricsLine } from "../plugin/panel-data.ts"
import { type TotalsKey } from "../plugin/schema.ts"

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
const TOTALS_REASONING_EXPIRED = 7
const TOTALS_REASONING_EXPIRED_UNIQUE = 3
const TOTALS_REASONING_BYTES = 2560
const TOTALS_FENCE_EVICTED = 2
const TOTALS_TOUCHES = 3
const TOTALS_EVICTION_TOKENS_SAVED = 3072
const TOTALS_DEDUP_TOKENS_SAVED = 2250
const TOTALS_COLLAPSED_WINDOW_TOKENS_SAVED = 1024
const TOTALS_REASONING_TOKENS_SAVED = 640

const HUGE_RECLAIMED_BYTES = 123456789012

const UNKNOWN_BUDGET_SOURCE = "unknown"
const OVERRIDE_BUDGET_SOURCE = "override"
const MODEL_BUDGET_SOURCE = "model"

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
  stashHits: TOTALS_STASH_HITS,
  stashMisses: TOTALS_STASH_MISSES,
  stashDropped: TOTALS_STASH_DROPPED,
  deduped: TOTALS_DEDUPED,
  dedupedBytes: TOTALS_DEDUPED_BYTES,
  dedupedUnique: TOTALS_DEDUPED_UNIQUE,
  dedupTokensSaved: TOTALS_DEDUP_TOKENS_SAVED,
  collapsedWindows: TOTALS_COLLAPSED_WINDOWS,
  collapsedWindowBytes: TOTALS_COLLAPSED_WINDOW_BYTES,
  collapsedWindowTokensSaved: TOTALS_COLLAPSED_WINDOW_TOKENS_SAVED,
  reasoningExpired: TOTALS_REASONING_EXPIRED,
  reasoningBytesExpired: TOTALS_REASONING_BYTES,
  reasoningExpiredUnique: TOTALS_REASONING_EXPIRED_UNIQUE,
  reasoningTokensSaved: TOTALS_REASONING_TOKENS_SAVED,
  fenceEvicted: TOTALS_FENCE_EVICTED,
  postEvictionTouches: TOTALS_TOUCHES,
}

const makeTotals = (): PanelMetricsLine["totals"] => ({ ...TOTALS_VALUES })

// A totals record written before the unique-event and token-savings keys
// existed: the exact shape the strict parser must reject and the tolerant
// reader must skip.
const makePreSchemaTotals = (): Record<string, number> => {
  const {
    evictionTokensSaved: _evictionTokensSaved,
    dedupTokensSaved: _dedupTokensSaved,
    collapsedWindowTokensSaved: _collapsedWindowTokensSaved,
    reasoningTokensSaved: _reasoningTokensSaved,
    dedupedUnique: _dedupedUnique,
    reasoningExpiredUnique: _reasoningExpiredUnique,
    collapsedWindows: _collapsedWindows,
    collapsedWindowBytes: _collapsedWindowBytes,
    ...preSchema
  } = TOTALS_VALUES
  return preSchema
}

const makeLine = (overrides: Partial<PanelMetricsLine> = {}): PanelMetricsLine => ({
  session: SESSION_A,
  ts: LOG_LINE_TS_STALE,
  modelContextTokens: BUDGET_TOKENS_MODEL,
  modelContextTokensSource: MODEL_BUDGET_SOURCE,
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
  modelContextTokens: BUDGET_TOKENS_MODEL,
  modelContextTokensSource: MODEL_BUDGET_SOURCE,
  lastRun: { estimatedTokens: ESTIMATED_TOKENS, watermarkTokens: WATERMARK_TOKENS, deficitTokens: DEFICIT_TOKENS },
  totals: makeTotals(),
  stash: { entries: SNAPSHOT_STASH_ENTRIES, capacity: SNAPSHOT_STASH_CAPACITY },
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
    modelContextTokens: BUDGET_TOKENS_SMALL,
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
  TOTALS_REASONING_BYTES,
  TOTALS_REASONING_TOKENS_SAVED,
  TOTALS_FENCE_EVICTED,
  UNKNOWN_BUDGET_SOURCE,
  OVERRIDE_BUDGET_SOURCE,
  MODEL_BUDGET_SOURCE,
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
  makeLine,
  serialize,
  withTempDir,
  makeSnapshot,
  writeSnapshot,
  logLineAgainstSnapshot,
  logLineStaleAgainstSnapshot,
}
