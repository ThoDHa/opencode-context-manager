/**
 * Arm control for the standardized-experiment framework: the experiment
 * profiles (the frozen deep profile and the lever series), the arm sets, the
 * frozen plugin config seeds, the park-aware flip-log deep-era reader
 * (profile-scoped in its arm-token recognition), the mirrored-rotation
 * schedule with its full-history validator, and the post-flip config
 * assertion. Ported from the bash apparatus
 * (`experiments/legacy/opencode-ab`, `experiments/legacy/opencode-ab-block`),
 * which stays operational for LRU-82 and is the legacy reference from LRU-84
 * onward.
 */

export const ARMS = ["OFF", "ON-FULL", "ON-DRY"] as const
// The lever-series triple rides the same mirrored rotation; LEVER is not a
// frozen deep-era token (readDeepEra recognizes arm tokens per profile).
export const LEVER_DATA_ARMS = ["OFF", "ON-FULL", "LEVER"] as const
export type Arm = (typeof ARMS | typeof LEVER_DATA_ARMS)[number]

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

export type PluginEntryOption = {
  manualMode: boolean
  watermarkTokens: number
  agedReadEvictionMessages: number
  reasoningRetentionMessages: number
  cacheAwareHints?: boolean
  cacheAwareDedup?: boolean
}
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

// The lever-series seeds: every ON arm runs the 12k-watermark measurement
// geometry the lever protocol pre-registered, and the LEVER arm adds the
// lever-1 keys (cacheAwareHints) on top of the profile's ON-FULL seed.
export const LEVER_ON_FULL_PLUGIN_ENTRY: readonly PluginEntry[] = [
  [
    "./opencode-context-manager/plugin/context-manager.ts",
    { manualMode: false, watermarkTokens: 12000, agedReadEvictionMessages: 30, reasoningRetentionMessages: 16 },
  ],
]
export const LEVER_ARM_PLUGIN_ENTRY: readonly PluginEntry[] = [
  [
    "./opencode-context-manager/plugin/context-manager.ts",
    { manualMode: false, watermarkTokens: 12000, agedReadEvictionMessages: 30, reasoningRetentionMessages: 16, cacheAwareHints: true },
  ],
]
// The lever-2 series measures the cumulative stack: its LEVER arm carries
// every landed lever key on top of the profile's ON-FULL seed, so the
// per-lever attribution comes from LEVER/ON-FULL, not from key toggling.
export const LEVER2_ARM_PLUGIN_ENTRY: readonly PluginEntry[] = [
  [
    "./opencode-context-manager/plugin/context-manager.ts",
    { manualMode: false, watermarkTokens: 12000, agedReadEvictionMessages: 30, reasoningRetentionMessages: 16, cacheAwareHints: true, cacheAwareDedup: true },
  ],
]

export const FLIP_ARG_BY_ARM = {
  OFF: "off",
  "ON-FULL": "on-full",
  "ON-DRY": "on-dry",
  LEVER: "lever",
  "CAL-ON-FULL": "cal-on-full",
} as const satisfies Readonly<Record<FlipArm, string>>

// The inverse lookup, derived from FLIP_ARG_BY_ARM: the mapped type forces
// a key for every flip argument the forward map defines (and only those),
// so the two directions cannot drift, and the index-signature side answers
// arbitrary-string lookups (an unknown flip argument) with undefined.
export type ArmByFlipArg = {
  readonly [flipArg in (typeof FLIP_ARG_BY_ARM)[FlipArm]]: FlipArm
} & Readonly<Record<string, FlipArm | undefined>>

export const ARM_BY_FLIP_ARG: ArmByFlipArg = {
  off: "OFF",
  "on-full": "ON-FULL",
  "on-dry": "ON-DRY",
  lever: "LEVER",
  "cal-on-full": CALIBRATION_ARM,
}

// An experiment profile fixes the data-arm triple, the per-arm plugin seeds
// (the OFF arm is the empty plugin list and carries no seed), whether the
// readout runs the full-mode metrics corroboration, whether the flip command
// defaults to this CLI's self flip (the legacy bash flip tool writes the
// frozen deep seeds only), and the pre-registered readout contrasts. The
// deep profile is the frozen LRU-82 shape and stays the default everywhere;
// a profile parameter omitted means deep.
export type ExperimentProfile = {
  name: "deep" | "lever1" | "lever2"
  dataArms: readonly Arm[]
  pluginSeedByArm: Readonly<Partial<Record<FlipArm, readonly PluginEntry[]>>>
  corroboratesFullModeMetrics: boolean
  defaultsToSelfFlip: boolean
  contrasts: readonly (readonly [Arm, Arm])[]
}

export const DEEP_PROFILE: ExperimentProfile = {
  name: "deep",
  dataArms: ARMS,
  pluginSeedByArm: {
    "ON-FULL": ON_PLUGIN_ENTRY,
    "ON-DRY": ON_DRY_PLUGIN_ENTRY,
    "CAL-ON-FULL": ON_PLUGIN_ENTRY,
  },
  corroboratesFullModeMetrics: false,
  defaultsToSelfFlip: false,
  contrasts: [
    ["ON-FULL", "OFF"],
    ["ON-DRY", "OFF"],
    ["ON-DRY", "ON-FULL"],
  ],
}

export const LEVER1_PROFILE: ExperimentProfile = {
  name: "lever1",
  dataArms: LEVER_DATA_ARMS,
  pluginSeedByArm: {
    "ON-FULL": LEVER_ON_FULL_PLUGIN_ENTRY,
    LEVER: LEVER_ARM_PLUGIN_ENTRY,
    "CAL-ON-FULL": LEVER_ON_FULL_PLUGIN_ENTRY,
  },
  corroboratesFullModeMetrics: true,
  defaultsToSelfFlip: true,
  contrasts: [
    ["LEVER", "OFF"],
    ["LEVER", "ON-FULL"],
    ["ON-FULL", "OFF"],
  ],
}

// The lever-2 series: the lever shape byte-identical at the schedule and
// era layers, with the LEVER arm measuring the cumulative lever stack.
export const LEVER2_PROFILE: ExperimentProfile = {
  name: "lever2",
  dataArms: LEVER_DATA_ARMS,
  pluginSeedByArm: {
    "ON-FULL": LEVER_ON_FULL_PLUGIN_ENTRY,
    LEVER: LEVER2_ARM_PLUGIN_ENTRY,
    "CAL-ON-FULL": LEVER_ON_FULL_PLUGIN_ENTRY,
  },
  corroboratesFullModeMetrics: true,
  defaultsToSelfFlip: true,
  contrasts: [
    ["LEVER", "OFF"],
    ["LEVER", "ON-FULL"],
    ["ON-FULL", "OFF"],
  ],
}

export const EXPERIMENT_PROFILES: Readonly<Record<ExperimentProfile["name"], ExperimentProfile>> = {
  deep: DEEP_PROFILE,
  lever1: LEVER1_PROFILE,
  lever2: LEVER2_PROFILE,
}

/**
 * Whether a raw profile-selection value names a known experiment profile.
 *
 * @param value the raw selection (an env value or CLI input)
 * @returns true for the profile names in EXPERIMENT_PROFILES
 */
export const isExperimentProfileName = (value: string): value is ExperimentProfile["name"] =>
  Object.hasOwn(EXPERIMENT_PROFILES, value)

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

// A profile's era tokens: the calibration arm plus the profile's data arms.
// The frozen deep set is [CAL-ON-FULL, OFF, ON-FULL, ON-DRY]; the lever set
// swaps ON-DRY for LEVER, so each reader ignores the other era's tokens (the
// unrecognized-line tolerance keeps old-log reads safe in both directions).
const eraArmTokens = (profile: ExperimentProfile): readonly string[] => [CALIBRATION_ARM, ...profile.dataArms]

/**
 * Reads the deep era of a flip log's text: every line from the first
 * CAL-ON-FULL line onward. A ` PARKED <reason>` marker line cancels the
 * immediately preceding flip (the parked block is unconsumed); `doubleParked`
 * flags the same position parking twice without progress (or stray park
 * markers), which the caller escalates to the operator. Lines outside the era
 * and unrecognized in-era lines are ignored.
 *
 * @param flipLogText the raw flip-log content
 * @param profile the experiment profile whose arm tokens are recognized
 *   (the frozen deep profile when omitted)
 * @returns the era's flip sequence with timestamps, park count, and the
 *   double-park flag
 */
export const readDeepEra = (flipLogText: string, profile: ExperimentProfile = DEEP_PROFILE): DeepEra => {
  const eraTokens = eraArmTokens(profile)
  const isEraArm = (value: string): value is FlipArm => eraTokens.includes(value)
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
    if (isEraArm(token)) {
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
 * Prints the arm for a 1-based data block number under the mirrored
 * six-rotation schedule: rotation r (0-based) runs the profile's arm triple
 * forward on even r and mirrored on odd r. Each arm's six run indices form
 * three pairs that each sum to 19, so every arm's mean run index is exactly
 * 9.5; the middle arm additionally holds the mid-rotation position in all
 * six rotations (the named residual of the mirrored scheme).
 *
 * @param blockNumber the 1-based data block position
 * @param profile the experiment profile whose arm triple the rotation runs
 *   (the frozen deep profile when omitted)
 * @returns the arm pre-registered for that position
 */
export const armForDataBlock = (blockNumber: number, profile: ExperimentProfile = DEEP_PROFILE): Arm => {
  const arms = profile.dataArms
  const rotation = Math.floor((blockNumber - 1) / arms.length)
  const position = (blockNumber - 1) % arms.length
  const index = rotation % 2 === 0 ? position : arms.length - 1 - position
  return arms[index]!
}

export type RotationMismatch = { position: number; carried: FlipArm; expected: Arm }

/**
 * Validates EVERY deep-era data flip against the rotation formula (not just
 * the last line): a deleted or duplicated mid-log line shifts every
 * subsequent position and must refuse rather than pass.
 *
 * @param era the parsed deep era
 * @param profile the experiment profile whose rotation is expected (the
 *   frozen deep profile when omitted)
 * @returns the first mismatch (carried arm, 1-based position, expected arm),
 *   or null when the history matches the pre-registered rotation
 */
export const validateDeepRotation = (era: DeepEra, profile: ExperimentProfile = DEEP_PROFILE): RotationMismatch | null => {
  let position = 0
  for (const flip of era.flips) {
    if (flip.arm === CALIBRATION_ARM) continue
    position += 1
    const expected = armForDataBlock(position, profile)
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
 * boolean, the watermark, and every companion key, including the lever
 * profile's cacheAwareHints discriminator); OFF means an empty plugin list.
 * An arm outside the profile carries no seed and matches nothing.
 *
 * @param config the parsed opencode config document
 * @param arm the arm the flip intended
 * @param profile the experiment profile whose seeds the assertion compares
 *   against (the frozen deep profile when omitted)
 * @returns true when the live plugin entry matches the arm's seed exactly
 */
export const configMatchesArm = (config: unknown, arm: FlipArm, profile: ExperimentProfile = DEEP_PROFILE): boolean => {
  const plugin = (config as { plugin?: unknown } | null)?.plugin
  if (arm === "OFF") return Array.isArray(plugin) && plugin.length === 0
  const seed = profile.pluginSeedByArm[arm]
  return seed !== undefined && canonicalJson(plugin) === canonicalJson(seed)
}

/**
 * Applies the intended arm's plugin entry to a parsed config document,
 * leaving every other config key untouched (the jq `.plugin = $seed`
 * behavior).
 *
 * @param config the parsed opencode config document
 * @param arm the arm to apply
 * @param profile the experiment profile whose seeds are applied (the frozen
 *   deep profile when omitted)
 * @returns a new config document carrying the arm's plugin entry
 * @throws Error when the arm carries no plugin seed in the profile
 */
export const applyArmToConfig = (config: unknown, arm: FlipArm, profile: ExperimentProfile = DEEP_PROFILE): unknown => {
  if (arm === "OFF") return { ...(config as Record<string, unknown>), plugin: [] }
  const seed = profile.pluginSeedByArm[arm]
  if (seed === undefined) throw new Error(`arm ${arm} carries no plugin seed in the ${profile.name} profile`)
  return { ...(config as Record<string, unknown>), plugin: seed }
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
