/**
 * Endpoint computation for the standardized-experiment framework: the frozen
 * credits-per-turn formula (GLM-5.3 at 6.9 input / 1.7 output / 24
 * cache-write credits per 10k tokens, flash-family models at one third, a
 * 0.5 promotion factor on the total), depth buckets, covariate gates, and
 * the per-arm contrast summaries. Ported from the bash driver's
 * `compute_session_credits` awk body and the pre-registered endpoint
 * definitions.
 */

import { DEEP_PROFILE, type Arm, type ExperimentProfile } from "./arms.ts"
import type { CensusRow, MetricsEvent, TurnRow } from "./census.ts"

export const CREDITS_PER_10K_INPUT = 6.9
export const CREDITS_PER_10K_OUTPUT = 1.7
export const CREDITS_PER_10K_CACHE_WRITE = 24
export const FLASH_FAMILY_DIVISOR = 3
export const PROMOTION_FACTOR = 0.5
export const CREDITS_DECIMALS = 4

export class CreditsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CreditsError"
  }
}

/**
 * Whether a model id belongs to the flash family: the family is recognized
 * by the `flash` substring of the model id, exactly as the bash formula's
 * `model ~ /flash/` recognizes it.
 *
 * @param modelId the assistant message's modelID
 * @returns true for flash-family models
 */
export const isFlashFamily = (modelId: string): boolean => modelId.includes("flash")

/**
 * Computes one assistant turn's credits from its token counts: the per-10k
 * rates applied to input, output, and cache-write tokens, divided by 3 for
 * flash-family models.
 *
 * @param turn the assistant turn's token counts and model id
 * @returns the turn's credits before promotion
 */
export const turnCredits = (turn: { modelId: string; inputTokens: number; outputTokens: number; cacheWriteTokens: number }): number => {
  const divisor = isFlashFamily(turn.modelId) ? FLASH_FAMILY_DIVISOR : 1
  const rateInput = CREDITS_PER_10K_INPUT / divisor
  const rateOutput = CREDITS_PER_10K_OUTPUT / divisor
  const rateCacheWrite = CREDITS_PER_10K_CACHE_WRITE / divisor
  return (turn.inputTokens * rateInput + turn.outputTokens * rateOutput + turn.cacheWriteTokens * rateCacheWrite) / 10000
}

/**
 * Computes one solve session's credits: the promoted sum of its assistant
 * turns' credits (total times the promotion factor). Mirrors the bash
 * failure contract: a session with zero assistant turns can never pass as a
 * phantom 0.
 *
 * @param turns the session's assistant turns
 * @returns the session's credits
 * @throws CreditsError when the session holds no assistant turns
 */
export const computeCredits = (turns: readonly { modelId: string; inputTokens: number; outputTokens: number; cacheWriteTokens: number }[]): number => {
  if (turns.length === 0) {
    throw new CreditsError("zero assistant-message rows for session; session id or DB mismatch")
  }
  const total = turns.reduce((sum, turn) => sum + turnCredits(turn), 0)
  return total * PROMOTION_FACTOR
}

/**
 * Formats credits to the frozen four-decimal figure used in logs and
 * reports.
 *
 * @param credits the credit value
 * @returns the four-decimal string
 */
export const formatCredits = (credits: number): string => credits.toFixed(CREDITS_DECIMALS)

export const DEEP_TURNS_MIN = 40
export const DEEP_TURNS_MAX = 80

export type DepthBucket = "shallow" | "mid" | "deep"

/**
 * Buckets a block's turn count into the pre-registered depth bands:
 * `shallow` below 40 turns, `mid` at 40-79, `deep` at 80 and above.
 *
 * @param turnCount the session's assistant turn count
 * @returns the depth bucket label
 */
export const depthBucket = (turnCount: number): DepthBucket => {
  if (turnCount < DEEP_TURNS_MIN) return "shallow"
  if (turnCount < DEEP_TURNS_MAX) return "mid"
  return "deep"
}

export type GateResult = { gated: true; reason: string } | { gated: false; reason: null }

/**
 * The primary covariate gate: a census row enters the primary endpoint only
 * when it carries no exclusion class and its credits are computable. The
 * gate's reason names the first disqualifying fact for the readout.
 *
 * @param row the census row
 * @param credits the row's computed credits, or null when unavailable
 * @returns the gate outcome with its reason
 */
export const gatePrimaryEndpoint = (row: CensusRow, credits: number | null): GateResult => {
  if (row.exclusion !== null) return { gated: true, reason: row.exclusion }
  if (credits === null) return { gated: true, reason: "credits-unavailable" }
  return { gated: false, reason: null }
}

export type ArmSummary = {
  arm: Arm
  blocks: number
  creditsPerTurnMean: number | null
  creditsPerTurnMedian: number | null
  creditsTotal: number
}

/**
 * Summarizes one arm's gated rows: block count, the mean and median
 * credits-per-turn (per-run credits divided by the run's turn count), and
 * the total credits. Ties in the per-run mean ranking are broken by the
 * lower block number (the pre-registered tie-break).
 *
 * @param rows the census rows carrying credits for one arm
 * @param arm the arm being summarized
 * @returns the arm's endpoint summary, or zeroed figures with no mean when
 *   the arm has no gated rows
 */
export const summarizeArm = (rows: readonly (CensusRow & { credits: number })[], arm: Arm): ArmSummary => {
  const perRun = rows
    .filter((row) => row.arm === arm)
    .map((row) => ({ blockNumber: row.blockNumber ?? 0, perTurn: row.credits / row.turns.length }))
  const total = rows.filter((row) => row.arm === arm).reduce((sum, row) => sum + row.credits, 0)
  if (perRun.length === 0) {
    return { arm, blocks: 0, creditsPerTurnMean: null, creditsPerTurnMedian: null, creditsTotal: total }
  }
  const mean = perRun.reduce((sum, entry) => sum + entry.perTurn, 0) / perRun.length
  const sorted = [...perRun].sort((left, right) => left.perTurn - right.perTurn || left.blockNumber - right.blockNumber)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]!.perTurn
      : (sorted[middle - 1]!.perTurn + sorted[middle]!.perTurn) / 2
  return { arm, blocks: perRun.length, creditsPerTurnMean: mean, creditsPerTurnMedian: median, creditsTotal: total }
}

export type ArmContrast = {
  firstArm: Arm
  secondArm: Arm
  creditsPerTurnDelta: number | null
}

/**
 * Contrasts two arms' primary endpoints: the difference of their
 * credits-per-turn means (first minus second), null when either arm has no
 * gated rows.
 *
 * @param summaries the per-arm endpoint summaries
 * @param firstArm the arm whose mean is subtracted from
 * @param secondArm the reference arm
 * @returns the contrast record
 */
export const contrastArms = (summaries: readonly ArmSummary[], firstArm: Arm, secondArm: Arm): ArmContrast => {
  const first = summaries.find((summary) => summary.arm === firstArm)
  const second = summaries.find((summary) => summary.arm === secondArm)
  const delta =
    first && second && first.creditsPerTurnMean !== null && second.creditsPerTurnMean !== null
      ? first.creditsPerTurnMean - second.creditsPerTurnMean
      : null
  return { firstArm: firstArm, secondArm: secondArm, creditsPerTurnDelta: delta }
}

/**
 * Summarizes every data arm and the pairwise contrasts of the profile's
 * pre-registered contrast list, in profile order: the frozen deep profile
 * emits ON-FULL/OFF, ON-DRY/OFF, ON-DRY/ON-FULL; the lever series emits
 * LEVER/OFF, LEVER/ON-FULL, ON-FULL/OFF.
 *
 * @param rows the census rows carrying credits
 * @param profile the experiment profile whose arms and contrasts are
 *   summarized (the frozen deep profile when omitted)
 * @returns the per-arm summaries followed by the profile's contrasts
 */
export const computeEndpoints = (rows: readonly (CensusRow & { credits: number })[], profile: ExperimentProfile = DEEP_PROFILE): { summaries: ArmSummary[]; contrasts: ArmContrast[] } => {
  const summaries = profile.dataArms.map((arm) => summarizeArm(rows, arm))
  const contrasts = profile.contrasts.map(([firstArm, secondArm]) => contrastArms(summaries, firstArm, secondArm))
  return { summaries, contrasts }
}

// ---------------------------------------------------------------------------
// Per-turn analysis views over the gated endpoint population. Turn
// positions are 1-based and per session (the LRU-82 readout's convention):
// a turn's position is its index within its own run's turn sequence, so a
// later run's early turns stay early; the primary window is turn 21 onward,
// the depth buckets label turn-position ranges, and the event-aligned view
// starts at turn 2, the first turn with a prior inter-turn gap. Per-turn
// credits carry the frozen promotion factor, so the views price exactly
// what computeCredits prices per turn.
// ---------------------------------------------------------------------------

export const PRIMARY_MIN_TURN_POSITION = 21

const promotedTurnCredits = (turn: TurnRow): number => turnCredits(turn) * PROMOTION_FACTOR

const meanOr = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length

// Every gated turn of one arm at a per-session 1-based position window:
// a turn's position is its index within its own run's turn sequence. The
// arm-concatenated index misclassifies later runs' early turns as deep,
// deflating the shallow buckets and inflating the primary window.
const armTurnsAtPosition = (rows: readonly CensusRow[], arm: Arm, minPosition: number, maxPosition: number = Number.MAX_SAFE_INTEGER): TurnRow[] =>
  rows
    .filter((row) => row.arm === arm)
    .flatMap((row) => row.turns.filter((_, index) => index + 1 >= minPosition && index + 1 <= maxPosition))

// The LRU-82 pooled-turn aggregates: per-turn means plus the pooled cache
// share, cache.read over the input-side tokens (input plus cache.read;
// cache.write is priced but not part of the share). The event-aligned
// view's split groups reuse it as their aggregate shape.
export type PooledTurnView = {
  turns: number
  inputMean: number | null
  cacheReadMean: number | null
  cacheShare: number | null
}

const pooledTurnView = (turns: readonly TurnRow[]): PooledTurnView => {
  const inputSum = turns.reduce((sum, turn) => sum + turn.inputTokens, 0)
  const cacheReadSum = turns.reduce((sum, turn) => sum + turn.cacheReadTokens, 0)
  return {
    turns: turns.length,
    inputMean: meanOr(turns.map((turn) => turn.inputTokens)),
    cacheReadMean: meanOr(turns.map((turn) => turn.cacheReadTokens)),
    cacheShare: inputSum + cacheReadSum === 0 ? null : cacheReadSum / (inputSum + cacheReadSum),
  }
}

export const TURN_POSITION_BUCKETS: readonly { label: string; min: number; max: number }[] = [
  { label: "1-5", min: 1, max: 5 },
  { label: "6-20", min: 6, max: 20 },
  { label: "21-50", min: 21, max: 50 },
  { label: "51+", min: 51, max: Number.MAX_SAFE_INTEGER },
]

export type DepthBucketRow = {
  arm: Arm
  bucket: string
  turns: number
  inputTokensMean: number | null
  cacheReadTokensMean: number | null
  cacheShare: number | null
  creditsPerTurnMean: number | null
}

/**
 * The per-arm depth-bucket table: every profile arm crossed with every
 * turn-position bucket, aggregating the gated rows' turns by their 1-based
 * per-session position (the index within each run's own turn sequence).
 * Empty buckets stay in the table with zero turns and null
 * figures (reported, non-gating, exactly like the LRU-82 readout's empty
 * 51+ row). Cache share is pooled per bucket (summed cache.read over
 * summed input-side tokens), not a mean of per-turn shares.
 *
 * @param rows the gated endpoint population
 * @param profile the experiment profile whose arms the table covers
 * @returns one row per arm and bucket, in profile then bucket order
 */
export const computeDepthBucketTable = (rows: readonly CensusRow[], profile: ExperimentProfile): DepthBucketRow[] => {
  const table: DepthBucketRow[] = []
  for (const arm of profile.dataArms) {
    for (const bucket of TURN_POSITION_BUCKETS) {
      const bucketTurns = armTurnsAtPosition(rows, arm, bucket.min, bucket.max)
      const view = pooledTurnView(bucketTurns)
      table.push({
        arm,
        bucket: bucket.label,
        turns: view.turns,
        inputTokensMean: view.inputMean,
        cacheReadTokensMean: view.cacheReadMean,
        cacheShare: view.cacheShare,
        creditsPerTurnMean: meanOr(bucketTurns.map(promotedTurnCredits)),
      })
    }
  }
  return table
}

export type TurnPrimaryArm = { arm: Arm; turns: number; creditsPerTurnMean: number | null }
export type TurnPrimaryContrast = {
  firstArm: Arm
  secondArm: Arm
  creditsPerTurnDelta: number | null
  creditsPerTurnRatio: number | null
}

/**
 * The primary endpoint of the lever protocol: pooled promoted per-turn
 * credits over every gated turn at per-session position 21 or later, per
 * profile arm, with the profile's contrasts as deltas and ratios (the
 * frozen rule judges the plugin-arm ratio against OFF). The ratio is null
 * when the reference arm's mean is null or zero.
 *
 * @param rows the gated endpoint population
 * @param profile the experiment profile whose arms and contrasts apply
 * @returns the per-arm per-turn primary means and the contrast records
 */
export const computeTurnPrimary = (rows: readonly CensusRow[], profile: ExperimentProfile): { byArm: TurnPrimaryArm[]; contrasts: TurnPrimaryContrast[] } => {
  const byArm = profile.dataArms.map((arm) => {
    const primaryTurns = armTurnsAtPosition(rows, arm, PRIMARY_MIN_TURN_POSITION)
    return { arm, turns: primaryTurns.length, creditsPerTurnMean: meanOr(primaryTurns.map(promotedTurnCredits)) }
  })
  const contrasts = profile.contrasts.map(([firstArm, secondArm]) => {
    const first = byArm.find((entry) => entry.arm === firstArm)
    const second = byArm.find((entry) => entry.arm === secondArm)
    const computable =
      first !== undefined && second !== undefined && first.creditsPerTurnMean !== null && second.creditsPerTurnMean !== null && second.creditsPerTurnMean !== 0
    return {
      firstArm,
      secondArm,
      creditsPerTurnDelta: computable ? first!.creditsPerTurnMean! - second!.creditsPerTurnMean! : null,
      creditsPerTurnRatio: computable ? first!.creditsPerTurnMean! / second!.creditsPerTurnMean! : null,
    }
  })
  return { byArm, contrasts }
}

/**
 * The profile's full-mode arms: the data arms whose plugin seed runs the
 * plugin without manualMode. OFF carries no seed and the dry arm's seed
 * sets manualMode, so both are excluded; under the lever profile this is
 * ON-FULL and LEVER, under the frozen deep profile ON-FULL alone.
 *
 * @param profile the experiment profile whose arms are classified
 * @returns the full-mode arms in profile order
 */
export const fullModeArms = (profile: ExperimentProfile): Arm[] =>
  profile.dataArms.filter((arm) => {
    if (arm === "OFF") return false
    const seed = profile.pluginSeedByArm[arm]
    return seed !== undefined && seed[0] !== undefined && seed[0][1].manualMode === false
  })

export type EventAlignedArmRow = {
  arm: Arm
  postEvent: PooledTurnView
  eventClean: PooledTurnView
  postEviction: PooledTurnView
  evictionClean: PooledTurnView
}

// The prior inter-turn gap of the 1-based turn position p >= 2 is the
// half-open span (turn p-1 creation, turn p creation]: it covers the prior
// turn's own processing span (where the plugin writes its metrics lines)
// and everything after it up to the turn under analysis, so an event that
// recorded a mutation before the turn saw its prompt counts for it.
const eventLandedInPriorGap = (
  turns: readonly TurnRow[],
  events: readonly MetricsEvent[],
  index: number,
  eventMatches: (event: MetricsEvent) => boolean,
): boolean =>
  events.some(
    (event) =>
      eventMatches(event) &&
      event.timestampMs !== null &&
      event.timestampMs > turns[index - 1]!.createdAtMs &&
      event.timestampMs <= turns[index]!.createdAtMs,
  )

/**
 * The event-aligned view (the LRU-82 cost-per-cut signature, generalized
 * to every logged metrics event): for every full-mode arm, the gated turns
 * at position 2 or later split by whether the prior inter-turn gap carried
 * any metrics event (postEvent against eventClean) and by whether it
 * carried an eviction (postEviction against evictionClean), the view's
 * eviction-specific case. Post-mutation turns re-send the rebuilt context
 * as uncached input, which is the invalidation-proxy the frozen rule
 * reads. The export keeps the eviction-aligned name because the
 * operational readout wiring (experiments/cli.ts) imports this symbol.
 *
 * @param rows the gated endpoint population
 * @param arms the full-mode arms to cover (fullModeArms of the profile)
 * @returns one row per arm with both splits' pooled aggregates
 */
export const computeEvictionAlignedView = (rows: readonly CensusRow[], arms: readonly Arm[]): EventAlignedArmRow[] =>
  arms.map((arm) => {
    const postEvent: TurnRow[] = []
    const eventClean: TurnRow[] = []
    const postEviction: TurnRow[] = []
    const evictionClean: TurnRow[] = []
    for (const row of rows.filter((candidate) => candidate.arm === arm)) {
      for (let index = 1; index < row.turns.length; index++) {
        const turn = row.turns[index]!
        if (eventLandedInPriorGap(row.turns, row.metricsEvents, index, () => true)) postEvent.push(turn)
        else eventClean.push(turn)
        if (eventLandedInPriorGap(row.turns, row.metricsEvents, index, (event) => event.evictedThisRun)) postEviction.push(turn)
        else evictionClean.push(turn)
      }
    }
    return {
      arm,
      postEvent: pooledTurnView(postEvent),
      eventClean: pooledTurnView(eventClean),
      postEviction: pooledTurnView(postEviction),
      evictionClean: pooledTurnView(evictionClean),
    }
  })
