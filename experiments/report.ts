/**
 * Readout report writer for the standardized-experiment framework: renders
 * the census rows and endpoint summaries into the Report File Template shape
 * (Findings, Decisions, Blocks, Next) and deposits the file. The readout is
 * a research deposit: the operational path lands under the task's reports
 * directory; the writer itself only renders text and writes one file.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  formatCredits,
  type ArmContrast,
  type ArmSummary,
  type DepthBucketRow,
  type EvictionAlignedArmRow,
  type TurnPrimaryArm,
  type TurnPrimaryContrast,
} from "./endpoints.ts"
import type { CensusRow } from "./census.ts"

export type ReadoutAnalysis = {
  primary: { byArm: readonly TurnPrimaryArm[]; contrasts: readonly TurnPrimaryContrast[] }
  depthBuckets: readonly DepthBucketRow[]
  evictionAligned: readonly EvictionAlignedArmRow[]
}

export type ReadoutInputs = {
  taskFileBasename: string
  slug: string
  from: string
  date: string
  title: string
  rows: readonly CensusRow[]
  creditsByBlock: ReadonlyMap<string, number>
  summaries: readonly ArmSummary[]
  contrasts: readonly ArmContrast[]
  caveats: readonly string[]
  analysis?: ReadoutAnalysis
}

/**
 * Renders the readout's census table: one line per block with its arm,
 * turns, credits (when computable), metrics generation counts, and exclusion
 * label.
 *
 * @param inputs the readout inputs
 * @returns the census table's markdown lines
 */
export const renderCensusTable = (inputs: ReadoutInputs): string[] => {
  const lines = ["| block | arm | turns | credits | metrics g1/g2 | exclusion |", "|---|---|---|---|---|---|"]
  for (const row of inputs.rows) {
    const credits = inputs.creditsByBlock.get(row.blockLabel)
    const creditsCell = credits === undefined ? "n/a" : formatCredits(credits)
    const generations = `${row.metricsGenerations[1]}/${row.metricsGenerations[2]}`
    lines.push(
      `| ${row.blockLabel} | ${row.arm} | ${row.turns.length} | ${creditsCell} | ${generations} | ${row.exclusion ?? "included"} |`,
    )
  }
  return lines
}

const CREDITS_FORMAT_DECIMALS = 2
const RATIO_FORMAT_DECIMALS = 3

// Aggregates render as integers (the LRU-82 readout's convention); a group
// with no turns renders as n/a.
const formatTokenMean = (value: number | null): string => (value === null ? "n/a" : Math.round(value).toString())
const formatSharePercent = (share: number | null): string => (share === null ? "n/a" : `${(share * 100).toFixed(1)}%`)
const formatPrimaryMean = (value: number | null): string => (value === null ? "n/a" : value.toFixed(CREDITS_FORMAT_DECIMALS))

/**
 * Renders the per-turn analysis views (the frozen-rule instruments): the
 * per-turn primary with its delta and ratio contrasts, the depth-bucket
 * table by turn position, and the eviction-aligned view for full-mode
 * arms.
 *
 * @param analysis the computed analysis views
 * @returns the analysis section's markdown lines
 */
export const renderAnalysis = (analysis: ReadoutAnalysis): string[] => {
  const lines: string[] = []
  lines.push("### per-turn primary (credits per turn, turns 21+)")
  for (const entry of analysis.primary.byArm) {
    lines.push(`- primary ${entry.arm}: turns=${entry.turns} creditsPerTurn mean=${formatPrimaryMean(entry.creditsPerTurnMean)}`)
  }
  for (const contrast of analysis.primary.contrasts) {
    const delta = contrast.creditsPerTurnDelta === null ? "n/a" : contrast.creditsPerTurnDelta.toFixed(CREDITS_FORMAT_DECIMALS)
    const ratio = contrast.creditsPerTurnRatio === null ? "n/a" : contrast.creditsPerTurnRatio.toFixed(RATIO_FORMAT_DECIMALS)
    lines.push(`- primary contrast ${contrast.firstArm}/${contrast.secondArm}: creditsPerTurn delta=${delta} ratio=${ratio}`)
  }
  lines.push("### per-turn views by turn-position bucket")
  lines.push("| arm | bucket | turns | input/turn | cache.read/turn | cache share | credits/turn |", "|---|---|---|---|---|---|---|")
  for (const row of analysis.depthBuckets) {
    lines.push(
      `| ${row.arm} | ${row.bucket} | ${row.turns} | ${formatTokenMean(row.inputTokensMean)} | ${formatTokenMean(row.cacheReadTokensMean)} | ${formatSharePercent(row.cacheShare)} | ${formatPrimaryMean(row.creditsPerTurnMean)} |`,
    )
  }
  lines.push("### eviction-aligned view (turns 2+, full-mode arms)")
  lines.push("| arm | group | turns | input/turn | cache.read/turn | cache share |", "|---|---|---|---|---|---|")
  for (const row of analysis.evictionAligned) {
    lines.push(
      `| ${row.arm} | post-eviction | ${row.postEvictionTurns} | ${formatTokenMean(row.postEvictionInputMean)} | ${formatTokenMean(row.postEvictionCacheReadMean)} | ${formatSharePercent(row.postEvictionCacheShare)} |`,
    )
    lines.push(
      `| ${row.arm} | clean | ${row.cleanTurns} | ${formatTokenMean(row.cleanInputMean)} | ${formatTokenMean(row.cleanCacheReadMean)} | ${formatSharePercent(row.cleanCacheShare)} |`,
    )
  }
  return lines
}

/**
 * Renders the endpoint summaries and contrasts as markdown lines: one
 * summary line per arm (n, mean, median, total) and one contrast line per
 * pair.
 *
 * @param inputs the readout inputs
 * @returns the endpoint section's markdown lines
 */
export const renderEndpoints = (inputs: ReadoutInputs): string[] => {
  const lines: string[] = []
  for (const summary of inputs.summaries) {
    const mean = formatPrimaryMean(summary.creditsPerTurnMean)
    const median = formatPrimaryMean(summary.creditsPerTurnMedian)
    lines.push(
      `- ${summary.arm}: n=${summary.blocks} creditsPerTurn mean=${mean} median=${median} total=${formatCredits(summary.creditsTotal)}`,
    )
  }
  for (const contrast of inputs.contrasts) {
    const delta = contrast.creditsPerTurnDelta === null ? "n/a" : contrast.creditsPerTurnDelta.toFixed(CREDITS_FORMAT_DECIMALS)
    lines.push(`- contrast ${contrast.firstArm} - ${contrast.secondArm}: creditsPerTurn delta=${delta}`)
  }
  return lines
}

/**
 * Renders the full readout in the Report File Template shape: the fixed
 * header block, then Findings (census table plus endpoints plus caveats),
 * then the Decisions, Blocks, and Next sections.
 *
 * @param inputs the readout inputs
 * @returns the complete markdown report text
 */
export const renderReadout = (inputs: ReadoutInputs): string => {
  const sections: string[] = []
  sections.push(`# Report: ${inputs.taskFileBasename}: ${inputs.slug}`)
  sections.push(`**From:** ${inputs.from}`)
  sections.push(`**Date:** ${inputs.date}`)
  sections.push(`**Task:** ${inputs.taskFileBasename}`)
  sections.push("## Findings")
  sections.push(inputs.title)
  sections.push(...renderCensusTable(inputs))
  sections.push(...renderEndpoints(inputs))
  if (inputs.analysis !== undefined) sections.push(...renderAnalysis(inputs.analysis))
  for (const caveat of inputs.caveats) sections.push(`- caveat: ${caveat}`)
  sections.push("## Decisions")
  sections.push("none")
  sections.push("## Blocks")
  sections.push("none")
  sections.push("## Next")
  sections.push("none")
  return sections.join("\n\n") + "\n"
}

/**
 * Writes the readout file, creating its parent directory when missing. The
 * caller owns the deposit path (the operational harness resolves the
 * task's reports directory).
 *
 * @param filePath the deposit path
 * @param content the rendered report text
 */
export const writeReadoutFile = (filePath: string, content: string): void => {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}
