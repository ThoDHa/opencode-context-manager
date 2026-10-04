/**
 * Arm control for the standardized-experiment framework: the arm set, the
 * frozen plugin config seeds, the flip-log deep-era reader (park-aware), the
 * mirrored-rotation schedule with its full-history validator, and the
 * post-flip config assertion. Ported from the bash apparatus
 * (`experiments/legacy/opencode-ab`, `experiments/legacy/opencode-ab-block`),
 * which stays operational for LRU-82 and is the legacy reference from LRU-84
 * onward.
 */

export const ARMS = ["OFF", "ON-FULL", "ON-DRY"] as const
export type Arm = (typeof ARMS)[number]

export const CALIBRATION_ARM = "CAL-ON-FULL"
export type FlipArm = Arm | typeof CALIBRATION_ARM

export const TOTAL_DATA_BLOCKS = 18

// The per-block log label: "cal" for the calibration block, the 1-based
// block number string for the data blocks.
export type BlockLabel = string

export const FLIP_LOG_BASENAME = "ab-flip.log"
export const BLOCK_LOG_BASENAME = "ab-block.log"
export const SPAWN_LOG_BASENAME = "ab-spawn.log"
export const WORK_LOG_BASENAME = "ab-work.log"
export const WORK_LOG_DEEP_BASENAME = "ab-work-deep.log"
export const BLOCK_LOCK_BASENAME = "ab-block.lock"
export const SOLVE_LOG_PREFIX = "ab-solve-"
export const SOLVE_LOG_SUFFIX = ".log"
export const SOLVE_LOG_CAL_LABEL = "cal"

export const PARK_REASON_QUOTA = "quota-exhaustion"
export const PARK_MARKER_TOKEN = "PARKED"
export const COMPLETION_MARKER = "experiment-complete"
export const CHAIN_COMPLETE_MARKER = "chain-complete"
export const CALIBRATION_COMPLETE_MARKER = "calibration-complete"

export type PluginEntryOption = { manualMode: boolean; watermarkTokens: number; agedReadEvictionMessages: number; reasoningRetentionMessages: number }
export type PluginEntry = [string, PluginEntryOption]

// The frozen arm seeds, byte-equal to the bash apparatus's ON_ENTRY and
// ON_DRY_ENTRY: the plugin path is resolved relative to the opencode config
// dir, manualMode is the arm's single behavioral switch, and the companion
// keys are the frozen policy carried by both ON arms.
export const ON_PLUGIN_ENTRY: readonly PluginEntry[] = [
  [
    "./opencode-context-manager/plugin/context-manager.ts",
    { manualMode: false, watermarkTokens: 250000, agedReadEvictionMessages: 30, reasoningRetentionMessages: 16 },
  ],
]
export const ON_DRY_PLUGIN_ENTRY: readonly PluginEntry[] = [
  [
    "./opencode-context-manager/plugin/context-manager.ts",
    { manualMode: true, watermarkTokens: 250000, agedReadEvictionMessages: 30, reasoningRetentionMessages: 16 },
  ],
]

export const FLIP_ARG_BY_ARM: Readonly<Record<FlipArm, string>> = {
  OFF: "off",
  "ON-FULL": "on-full",
  "ON-DRY": "on-dry",
  "CAL-ON-FULL": "cal-on-full",
}

// run_single_block return codes; the caller maps them per mode. Shared with
// the bash driver's RC_* values so logs and exit statuses stay join-able
// across the legacy and framework eras.
export const RC = {
  BLOCK_OK: 0,
  SEQ_COMPLETE: 10,
  NOT_ALTERNATING: 11,
  SCRATCH_LEFTOVER: 12,
  FLIP_FAILED: 13,
  RESET_FAILED: 14,
  CREDIT_ABORT: 15,
  CREDITS_FAILED: 16,
  LOG_INCONSISTENT: 17,
  PARKED: 20,
  PARK_ESCALATION: 21,
} as const

export type EraFlip = { timestamp: string; arm: FlipArm }

export type DeepEra = {
  flips: EraFlip[]
  parkedCount: number
  doubleParked: boolean
}

const ERA_ARM_TOKENS: readonly string[] = [CALIBRATION_ARM, ...ARMS]

const isFlipArm = (value: string): value is FlipArm => ERA_ARM_TOKENS.includes(value)

/**
 * Reads the deep era of a flip log's text: every line from the first
 * CAL-ON-FULL line onward. A ` PARKED <reason>` marker line cancels the
 * immediately preceding flip (the parked block is unconsumed); `doubleParked`
 * flags the same position parking twice without progress (or stray park
 * markers), which the caller escalates to the operator. Lines outside the era
 * and unrecognized in-era lines are ignored.
 *
 * @param flipLogText the raw flip-log content
 * @returns the era's flip sequence with timestamps, park count, and the
 *   double-park flag
 */
export const readDeepEra = (flipLogText: string): DeepEra => {
  const flips: EraFlip[] = []
  let parkedCount = 0
  let doubleParked = false
  let inEra = false
  let prevFlip = false
  let flipsSincePark = 0
  for (const line of flipLogText.split("\n")) {
    if (!inEra) {
      if (line.endsWith(` ${CALIBRATION_ARM}`)) inEra = true
      else continue
    }
    if (line.includes(` ${PARK_MARKER_TOKEN} `)) {
      if (prevFlip) {
        flips.pop()
        prevFlip = false
      }
      parkedCount += 1
      if (flipsSincePark <= 1 && parkedCount >= 2) doubleParked = true
      flipsSincePark = 0
      continue
    }
    const token = line.slice(line.lastIndexOf(" ") + 1)
    if (isFlipArm(token)) {
      const timestamp = line.slice(0, line.lastIndexOf(" "))
      flips.push({ timestamp, arm: token })
      prevFlip = true
      flipsSincePark += 1
    }
  }
  return { flips, parkedCount, doubleParked }
}

/**
 * Counts era flip tokens equal to the given arm.
 *
 * @param era the parsed deep era
 * @param arm the arm to count
 * @returns the number of flips carrying that arm
 */
export const countEraFlips = (era: DeepEra, arm: FlipArm): number =>
  era.flips.filter((flip) => flip.arm === arm).length

/**
 * Counts era data-block flips: every token that is not the calibration arm.
 *
 * @param era the parsed deep era
 * @returns the number of consumed data blocks
 */
export const eraDataCount = (era: DeepEra): number =>
  era.flips.filter((flip) => flip.arm !== CALIBRATION_ARM).length

/**
 * Prints the arm for a 1-based deep data block number under the mirrored
 * six-rotation schedule: rotation r (0-based) runs the base cycle OFF,
 * ON-FULL, ON-DRY forward on even r and mirrored on odd r. Each arm's six
 * run indices form three pairs that each sum to 19, so every arm's mean run
 * index is exactly 9.5; ON-FULL additionally holds the mid-rotation position
 * in all six rotations (the named residual of the mirrored scheme).
 *
 * @param blockNumber the 1-based data block position
 * @returns the arm pre-registered for that position
 */
export const armForDataBlock = (blockNumber: number): Arm => {
  const rotation = Math.floor((blockNumber - 1) / 3)
  const position = (blockNumber - 1) % 3
  const index = rotation % 2 === 0 ? position : 2 - position
  return ARMS[index]!
}

export type RotationMismatch = { position: number; carried: FlipArm; expected: Arm }

/**
 * Validates EVERY deep-era data flip against the rotation formula (not just
 * the last line): a deleted or duplicated mid-log line shifts every
 * subsequent position and must refuse rather than pass.
 *
 * @param era the parsed deep era
 * @returns the first mismatch (carried arm, 1-based position, expected arm),
 *   or null when the history matches the pre-registered rotation
 */
export const validateDeepRotation = (era: DeepEra): RotationMismatch | null => {
  let position = 0
  for (const flip of era.flips) {
    if (flip.arm === CALIBRATION_ARM) continue
    position += 1
    const expected = armForDataBlock(position)
    if (flip.arm !== expected) return { position, carried: flip.arm, expected }
  }
  return null
}

// Serializes a JSON value with object keys sorted, so semantic deep equality
// of config documents reduces to string equality (the jq `==` behavior the
// bash assertion relies on).
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, mapped: unknown) => {
    if (mapped === null || typeof mapped !== "object" || Array.isArray(mapped)) return mapped
    const record = mapped as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(record)
        .filter(([, member]) => member !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    )
  })

/**
 * The post-flip arm assertion's core: a parsed live config must carry exactly
 * the intended arm's plugin entry (deep equality carries the manualMode
 * boolean, the watermark, and every companion key); OFF means an empty plugin
 * list.
 *
 * @param config the parsed opencode config document
 * @param arm the arm the flip intended
 * @returns true when the live plugin entry matches the arm's seed exactly
 */
export const configMatchesArm = (config: unknown, arm: FlipArm): boolean => {
  const plugin = (config as { plugin?: unknown } | null)?.plugin
  switch (arm) {
    case "OFF":
      return Array.isArray(plugin) && plugin.length === 0
    case "ON-FULL":
    case CALIBRATION_ARM:
      return canonicalJson(plugin) === canonicalJson(ON_PLUGIN_ENTRY)
    case "ON-DRY":
      return canonicalJson(plugin) === canonicalJson(ON_DRY_PLUGIN_ENTRY)
  }
}

/**
 * Applies the intended arm's plugin entry to a parsed config document,
 * leaving every other config key untouched (the jq `.plugin = $seed`
 * behavior).
 *
 * @param config the parsed opencode config document
 * @param arm the arm to apply
 * @returns a new config document carrying the arm's plugin entry
 */
export const applyArmToConfig = (config: unknown, arm: FlipArm): unknown => {
  const plugin =
    arm === "OFF" ? [] : arm === "ON-DRY" ? ON_DRY_PLUGIN_ENTRY : ON_PLUGIN_ENTRY
  return { ...(config as Record<string, unknown>), plugin }
}

/**
 * Formats one flip-log line: `<timestamp> <ARM>`.
 *
 * @param timestamp the ISO-8601 flip time
 * @param arm the arm that was flipped to
 * @returns the flip-log line without its trailing newline
 */
export const formatFlipLine = (timestamp: string, arm: FlipArm): string => `${timestamp} ${arm}`

/**
 * Formats one park-marker flip-log line: `<timestamp> PARKED <reason>`. The
 * marker cancels the immediately preceding flip in the era counts.
 *
 * @param timestamp the ISO-8601 park time
 * @param reason the pinned park reason
 * @returns the park-marker line without its trailing newline
 */
export const formatParkLine = (timestamp: string, reason: string): string =>
  `${timestamp} ${PARK_MARKER_TOKEN} ${reason}`
