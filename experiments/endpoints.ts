/**
 * Endpoint computation for the standardized-experiment framework: the frozen
 * credits-per-turn formula (GLM-5.3 at 6.9 input / 1.7 output / 24
 * cache-write credits per 10k tokens, flash-family models at one third, a
 * 0.5 promotion factor on the total), depth buckets, covariate gates, and
 * the per-arm contrast summaries. Ported from the bash driver's
 * `compute_session_credits` awk body and the pre-registered endpoint
 * definitions.
 */

import { ARMS, type Arm } from "./arms.ts"
import type { CensusRow } from "./census.ts"

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
 * Summarizes every data arm and the pairwise contrasts between them, in the
 * frozen arm order.
 *
 * @param rows the census rows carrying credits
 * @returns the per-arm summaries followed by the pairwise contrasts
 */
export const computeEndpoints = (rows: readonly (CensusRow & { credits: number })[]): { summaries: ArmSummary[]; contrasts: ArmContrast[] } => {
  const summaries = ARMS.map((arm) => summarizeArm(rows, arm))
  const contrasts = [
    contrastArms(summaries, "ON-FULL", "OFF"),
    contrastArms(summaries, "ON-DRY", "OFF"),
    contrastArms(summaries, "ON-DRY", "ON-FULL"),
  ]
  return { summaries, contrasts }
}
