import test from "node:test"
import assert from "node:assert/strict"
import { appendFileSync, chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, isAbsolute, relative } from "node:path"
import { spawnSync } from "node:child_process"

import {
  applyArmToConfig,
  armForDataBlock,
  ARM_BY_FLIP_ARG,
  BLOCK_LOG_BASENAME,
  CALIBRATION_ARM,
  DEEP_PROFILE,
  FLIP_LOG_BASENAME,
  LEVER1_PROFILE,
  LEVER3_ARM_PLUGIN_ENTRY,
  LEVER3_PROFILE,
  LEVER4_ARM_PLUGIN_ENTRY,
  LEVER4_PROFILE,
  LEVER_ARM_PLUGIN_ENTRY,
  LEVER_ON_FULL_PLUGIN_ENTRY,
  SPAWN_LOG_BASENAME,
  WORK_LOG_DEEP_BASENAME,
  WORK_LOG_BASENAME,
  configMatchesArm,
  countEraFlips,
  eraDataCount,
  isExperimentProfileName,
  FLIP_ARG_BY_ARM,
  formatFlipLine,
  formatParkLine,
  ON_DRY_PLUGIN_ENTRY,
  ON_PLUGIN_ENTRY,
  readDeepEra,
  TOTAL_DATA_BLOCKS,
  validateDeepRotation,
  type Arm,
} from "../../../experiments/arms.ts"
import {
  buildSolveArgv,
  classifySpawnOutcome,
  extractSessionId,
  hasCompletionMarker,
  isQuotaFailure,
  parseSpawnLog,
  solveLogBasename,
  SOLVE_MODEL_DEFAULT,
} from "../../../experiments/spawn.ts"
import {
  buildCensus,
  classifyMetricsGeneration,
  METRICS_LOG_BASENAME,
  openTurnDatabase,
  parseMetricsLog,
  parseWorkLog,
  uncorroboratedFullModeBlocks,
  type CensusRow,
  type TurnRow,
  type TurnSource,
} from "../../../experiments/census.ts"
import {
  computeCredits,
  computeDepthBucketTable,
  computeEndpoints,
  computeEvictionAlignedView,
  computeTurnPrimary,
  contrastArms,
  depthBucket,
  formatCredits,
  fullModeArms,
  gatePrimaryEndpoint,
  summarizeArm,
  CreditsError,
} from "../../../experiments/endpoints.ts"
import { renderReadout, writeReadoutFile, type ReadoutInputs } from "../../../experiments/report.ts"
import { checkSpecIntegrity, corpusManifest, resolveExercise, treeManifest } from "../../../experiments/exercise.ts"
import { findRedcheckLeftover, resetTree, suiteFilesOf, verifyTree, writeWorkLogLine, REDCHECK_SCRATCH_PREFIXES, type ExerciseCliOptions } from "../../../experiments/exercise-cli.ts"
import {
  decideNextBlock,
  EXPERIMENT_PROFILE_ENV,
  flipArmAndAssert,
  flipFailureStatus,
  main as runCli,
  missingCoverageBlocks,
  resetExercise,
  resolveCliConfig,
  runReadout,
  SELF_FLIP_COMMAND,
  type CliConfig,
} from "../../../experiments/cli.ts"
import {
  buildOpencodeDb,
  flipLogText,
  LEVER_SCHEDULE,
  metricsLogText,
  runExerciseSuite,
  spawnLogText,
  SCHEDULE,
  T0,
  workLogText,
  at,
  writeFakeFlip,
  writeFakeWork,
  type MetricsLineOptions,
} from "./fixtures.ts"

const tempDir = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

// Hermeticity guard for the exercise-tool cases: the options' workDir must
// sit under the case's temp root, so a resolver regression cannot route
// resetTree's rm -rf at the live deployed trees again.
const assertContainedInTemp = (workDir: string, tempRoot: string): void => {
  const relativePath = relative(tempRoot, workDir)
  assert.equal(relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath), true, `workDir ${workDir} escapes the temp root ${tempRoot}`)
}

// Literal exercise options entirely under the temp root: workDir, home, and
// scratch are all case-local; only nodeBin is the runner's own executable.
const tempExerciseOptions = (tempRoot: string, workName: string): ExerciseCliOptions => ({
  home: join(tempRoot, "home"),
  scratchDir: join(tempRoot, "scratch"),
  workDir: join(tempRoot, workName),
  nodeBin: process.execPath,
})

const turn = (updatedMinute: number): TurnRow => ({
  createdAtMs: Date.parse(T0) + (updatedMinute - 1) * 60000,
  updatedAtMs: Date.parse(T0) + updatedMinute * 60000,
  modelId: "glm-5.3",
  inputTokens: 100000,
  outputTokens: 10000,
  cacheWriteTokens: 5000,
  cacheReadTokens: 0,
})

const turnsOf = (map: ReadonlyMap<string, TurnRow[]>): TurnSource => ({ assistantTurns: (sessionId) => map.get(sessionId) ?? [] })

const generateCorpus = (templateDir: string, targetDir: string): void => {
  const result = spawnSync(process.execPath, [join(templateDir, "tools", "generate.mjs"), targetDir], { encoding: "utf8" })
  assert.equal(result.status, 0, `generator failed: ${result.stderr}`)
}

const cliConfigFor = (home: string, overrides: Partial<CliConfig>): CliConfig => ({
  home,
  configPath: join(home, "config.json"),
  dbPath: join(home, "opencode.db"),
  workDir: join(home, "work"),
  flipCmd: "",
  workCmd: "",
  opencodeBin: "unused",
  solveModel: "m",
  spawnTimeout: "2h",
  spawnKillAfter: "5m",
  creditCeiling: "",
  settleSeconds: 0,
  chainMode: false,
  calibrationMode: false,
  profile: DEEP_PROFILE,
  ...overrides,
})

test("armForDataBlock reproduces the pinned mirrored 18-block schedule", () => {
  assert.equal(TOTAL_DATA_BLOCKS, SCHEDULE.length)
  assert.deepEqual(Array.from({ length: TOTAL_DATA_BLOCKS }, (_, index) => armForDataBlock(index + 1)), [...SCHEDULE])
})

test("every arm's six run indices form pairs summing to 19 (mean run index 9.5)", () => {
  for (const arm of ["OFF", "ON-FULL", "ON-DRY"] as const) {
    const indices = SCHEDULE.map((scheduleArm, index) => (scheduleArm === arm ? index + 1 : 0)).filter((index) => index > 0)
    assert.equal(indices.length, 6)
    const pairSums = indices.filter((index) => indices.includes(19 - index))
    assert.equal(pairSums.length >= 2, true, `arm ${arm} holds no pair summing to 19`)
    const mean = indices.reduce((sum, index) => sum + index, 0) / indices.length
    assert.equal(mean, 9.5)
  }
})

test("readDeepEra ignores pre-era history and anchors the era at the calibration line", () => {
  const era = readDeepEra(flipLogText(["OFF", "ON-FULL"], { preEra: true }))
  assert.equal(era.flips.length, 3)
  assert.equal(countEraFlips(era, CALIBRATION_ARM), 1)
  assert.equal(eraDataCount(era), 2)
  assert.equal(era.flips[0]!.arm, CALIBRATION_ARM)
})

test("a park marker cancels the immediately preceding flip so the block stays unconsumed", () => {
  const era = readDeepEra(flipLogText(["OFF", "PARKED quota-exhaustion", "OFF", "ON-FULL"]))
  assert.equal(era.parkedCount, 1)
  assert.equal(eraDataCount(era), 2)
  assert.deepEqual(era.flips.map((flip) => flip.arm), [CALIBRATION_ARM, "OFF", "ON-FULL"])
  assert.equal(era.doubleParked, false)
})

test("the same position parking twice without progress raises the double-park escalation", () => {
  const consecutive = readDeepEra(flipLogText(["PARKED quota-exhaustion", "PARKED quota-exhaustion"]))
  assert.equal(consecutive.doubleParked, true)
  const samePosition = readDeepEra(flipLogText(["OFF", "PARKED quota-exhaustion", "PARKED quota-exhaustion"]))
  assert.equal(samePosition.doubleParked, true)
  const healthy = readDeepEra(flipLogText(["OFF", "PARKED quota-exhaustion", "OFF"]))
  assert.equal(healthy.doubleParked, false)
  const distinctPositions = readDeepEra(flipLogText(["OFF", "PARKED quota-exhaustion", "OFF", "ON-FULL", "PARKED quota-exhaustion"]))
  assert.equal(distinctPositions.doubleParked, false)
})

test("validateDeepRotation names the first position that departs from the rotation", () => {
  const mismatch = validateDeepRotation(readDeepEra(flipLogText(["OFF", "OFF"])))
  assert.deepEqual(mismatch, { position: 2, carried: "OFF", expected: "ON-FULL" })
})

test("validateDeepRotation passes the clean pinned 18-block history", () => {
  const era = readDeepEra(flipLogText(SCHEDULE))
  assert.equal(validateDeepRotation(era), null)
  assert.equal(eraDataCount(era), 18)
})

test("configMatchesArm discriminates the manualMode boolean, OFF, and the calibration alias", () => {
  assert.equal(configMatchesArm({ model: "m", plugin: ON_PLUGIN_ENTRY }, "ON-FULL"), true)
  assert.equal(configMatchesArm({ model: "m", plugin: ON_DRY_PLUGIN_ENTRY }, "ON-FULL"), false)
  assert.equal(configMatchesArm({ model: "m", plugin: ON_DRY_PLUGIN_ENTRY }, "ON-DRY"), true)
  assert.equal(configMatchesArm({ model: "m", plugin: ON_PLUGIN_ENTRY }, "ON-DRY"), false)
  assert.equal(configMatchesArm({ model: "m", plugin: [] }, "OFF"), true)
  assert.equal(configMatchesArm({ model: "m", plugin: ON_PLUGIN_ENTRY }, "OFF"), false)
  assert.equal(configMatchesArm({ model: "m", plugin: ON_PLUGIN_ENTRY }, CALIBRATION_ARM), true)
  assert.equal(configMatchesArm(null, "OFF"), false)
})

test("applyArmToConfig swaps only the plugin entry and leaves every other key", () => {
  const config = { model: "test-model", theme: "dark", plugin: [] as unknown[] }
  const flipped = applyArmToConfig(config, "ON-DRY") as { model: string; theme: string; plugin: unknown }
  assert.equal(flipped.model, "test-model")
  assert.equal(flipped.theme, "dark")
  assert.deepEqual(flipped.plugin, ON_DRY_PLUGIN_ENTRY)
  assert.deepEqual(config.plugin, [])
})

test("flip and park log lines carry the timestamp and the arm or park reason", () => {
  assert.equal(formatFlipLine(T0, "ON-FULL"), `${T0} ON-FULL`)
  assert.equal(formatParkLine(T0, "quota-exhaustion"), `${T0} PARKED quota-exhaustion`)
})

test("buildSolveArgv carries the frozen spawn geometry with no --pure", () => {
  assert.equal(SOLVE_MODEL_DEFAULT, "zai-coding-plan/glm-5.3-flash")
  const argv = buildSolveArgv({ model: SOLVE_MODEL_DEFAULT, blockLabel: "3", workDir: "/tmp/opencode/ab-work-deep", prompt: "PROMPT" })
  assert.deepEqual(argv, [
    "run",
    "--format",
    "json",
    "-m",
    SOLVE_MODEL_DEFAULT,
    "--title",
    "ab-solve block 3",
    "--dir",
    "/tmp/opencode/ab-work-deep",
    "PROMPT",
  ])
  assert.equal(argv.includes("--pure"), false)
})

test("isQuotaFailure pins every quota marker class in the failure tail", () => {
  const markers = [
    "API Error: 429 Too Many Requests",
    "provider quota exhausted",
    "hit the rate limit",
    "usage limit reached for this window",
    "credits exhausted for the billing period",
    "you have exceeded your quota",
  ]
  for (const marker of markers) {
    assert.equal(isQuotaFailure(`prose\n${marker}`, 1), true, `marker not pinned: ${marker}`)
  }
})

test("the 429 marker is anchored to non-digit boundaries", () => {
  assert.equal(isQuotaFailure("retried 1429 times", 1), false)
  assert.equal(isQuotaFailure("endpoint returned code 42900", 1), false)
  assert.equal(isQuotaFailure("error 429 raised", 1), true)
})

test("a zero exit and a timeout kill never park regardless of markers", () => {
  assert.equal(isQuotaFailure("429 quota rate limit", 0), false)
  assert.equal(isQuotaFailure("429 quota rate limit", 124), false)
})

test("only the failure tail of the solve log is scanned for quota markers", () => {
  const earlyProse = ["the plan quota is generous", ...Array.from({ length: 60 }, (_, index) => `line ${index}`)]
  assert.equal(isQuotaFailure(earlyProse.join("\n"), 1), false)
  const tailProse = [...Array.from({ length: 60 }, (_, index) => `line ${index}`), "the plan quota is generous"]
  assert.equal(isQuotaFailure(tailProse.join("\n"), 1), true)
})

test("classifySpawnOutcome parks quota evidence and consumes every other failure class", () => {
  assert.equal(classifySpawnOutcome("tail: 429 too many requests", 1), "park")
  assert.equal(classifySpawnOutcome("connect ECONNREFUSED", 1), "consume")
  assert.equal(classifySpawnOutcome("clean run", 0), "consume")
  assert.equal(classifySpawnOutcome("killed after timeout with 429 text", 124), "consume")
})

test("extractSessionId takes the first parseable event line and falls back to unknown", () => {
  assert.equal(extractSessionId('garbage\n{"type":"step_start","sessionID":"ses_abc"}\n{"type":"x","sessionID":"ses_late"}'), "ses_abc")
  assert.equal(extractSessionId("totally not json"), "unknown")
  assert.equal(extractSessionId('{"sessionID":null}'), "unknown")
})

test("spawn-log parsing, the completion marker, and solve-log naming round-trip", () => {
  const text = spawnLogText(
    [
      { label: "cal", arm: CALIBRATION_ARM, sessionId: "ses_cal", exit: 0, minute: 5 },
      { label: "1", arm: "OFF", sessionId: "ses_1", exit: 0, minute: 15 },
      { label: "2", arm: "ON-FULL", sessionId: "ses_2", exit: 7, minute: 25 },
    ],
    { completion: true },
  )
  const entries = parseSpawnLog(text)
  assert.equal(entries.length, 3)
  assert.equal(entries[1]!.blockLabel, "1")
  assert.equal(entries[1]!.arm, "OFF")
  assert.equal(entries[1]!.sessionId, "ses_1")
  assert.equal(entries[1]!.exit, 0)
  assert.equal(entries[2]!.exit, 7)
  assert.equal(hasCompletionMarker(text), true)
  assert.equal(hasCompletionMarker(spawnLogText([], {})), false)
  assert.equal(solveLogBasename("cal"), "ab-solve-cal.log")
  assert.equal(solveLogBasename("3"), "ab-solve-3.log")
})

test("computeCredits reproduces the frozen glm-5.3 vector (two deep turns = 82.7000)", () => {
  const turns = [1, 2].map(() => ({ modelId: "glm-5.3", inputTokens: 100000, outputTokens: 10000, cacheWriteTokens: 5000 }))
  assert.equal(formatCredits(computeCredits(turns)), "82.7000")
})

test("flash-family credits are one third of the glm-5.3 rate with promotion", () => {
  const turns = [{ modelId: "glm-5.3-flash", inputTokens: 300000, outputTokens: 30000, cacheWriteTokens: 15000 }]
  assert.equal(formatCredits(computeCredits(turns)), "41.3500")
})

test("a session with zero assistant rows can never pass as a phantom zero", () => {
  assert.throws(() => computeCredits([]), CreditsError)
})

test("formatCredits pins the four-decimal log figure", () => {
  assert.equal(formatCredits(0), "0.0000")
  assert.equal(formatCredits(1.5), "1.5000")
  assert.equal(formatCredits(82.7), "82.7000")
})

test("depth buckets split at the pre-registered 40/80 turn boundaries", () => {
  assert.equal(depthBucket(39), "shallow")
  assert.equal(depthBucket(40), "mid")
  assert.equal(depthBucket(79), "mid")
  assert.equal(depthBucket(80), "deep")
})

test("the primary endpoint gate excludes any classified row and uncomputable credits", () => {
  const baseRow = { exclusion: null as CensusRow["exclusion"], turns: [{} as TurnRow] }
  assert.deepEqual(gatePrimaryEndpoint(baseRow, 10), { gated: false, reason: null })
  assert.deepEqual(gatePrimaryEndpoint({ ...baseRow, exclusion: "spanning" }, 10), { gated: true, reason: "spanning" })
  assert.deepEqual(gatePrimaryEndpoint(baseRow, null), { gated: true, reason: "credits-unavailable" })
})

const endpointRow = (arm: Arm, credits: number, turnCount: number, blockNumber: number | null): CensusRow & { credits: number } => ({
  blockLabel: blockNumber === null ? "cal" : String(blockNumber),
  blockNumber,
  arm,
  started: T0,
  sessionId: `s${blockNumber}`,
  spawnExit: 0,
  verifyPassed: turnCount,
  verifyFailed: 0,
  verifyExit: 0,
  turns: Array.from({ length: turnCount }, () => turn(0)),
  turnsError: null,
  metricsEvents: [],
  metricsGenerations: { 1: 0, 2: 0 },
  windowStartMs: null,
  windowEndMs: null,
  exclusion: null,
  credits,
})

test("summarizeArm computes mean, even-count median, and the block-number tie-break", () => {
  const rows = [endpointRow("OFF", 100, 2, 3), endpointRow("OFF", 100, 2, 1), endpointRow("OFF", 40, 1, 2), endpointRow("ON-FULL", 30, 1, 1)]
  const off = summarizeArm(rows, "OFF")
  assert.equal(off.blocks, 3)
  assert.equal(off.creditsTotal, 240)
  assert.ok(Math.abs(off.creditsPerTurnMean! - 140 / 3) < 1e-9)
  assert.equal(off.creditsPerTurnMedian, 50)
  const empty = summarizeArm(rows, "ON-DRY")
  assert.equal(empty.blocks, 0)
  assert.equal(empty.creditsPerTurnMean, null)
  assert.equal(empty.creditsPerTurnMedian, null)
})

test("computeEndpoints contrasts every pair and contrastArms yields null without data", () => {
  const emptySummary = summarizeArm([], "OFF")
  assert.equal(contrastArms([emptySummary], "ON-FULL", "OFF").creditsPerTurnDelta, null)
  const rows = [endpointRow("ON-FULL", 60, 1, 1), endpointRow("OFF", 40, 1, 2)]
  const { summaries, contrasts } = computeEndpoints(rows)
  assert.equal(summaries.length, 3)
  const onFull = summaries.find((summary) => summary.arm === "ON-FULL")!
  const off = summaries.find((summary) => summary.arm === "OFF")!
  assert.ok(Math.abs(onFull.creditsPerTurnMean! - 60) < 1e-9)
  assert.ok(Math.abs(off.creditsPerTurnMean! - 40) < 1e-9)
  assert.ok(Math.abs(contrasts[0]!.creditsPerTurnDelta! - 20) < 1e-9)
})

test("classifyMetricsGeneration splits the two metrics-log generations and rejects junk", () => {
  assert.equal(classifyMetricsGeneration(JSON.parse(`{"ts":"${T0}","session":"s","watermarkTokens":1}`)), 1)
  assert.equal(classifyMetricsGeneration(JSON.parse(`{"ts":"${T0}","session":"s","wouldEvictThisRun":0}`)), 2)
  assert.equal(classifyMetricsGeneration({ ts: T0 }), null)
  assert.equal(classifyMetricsGeneration("junk"), null)
  assert.equal(classifyMetricsGeneration(null), null)
})

test("parseMetricsLog drops truncated and unparseable lines", () => {
  const good = `{"ts":"${T0}","session":"s","watermarkTokens":1}`
  assert.equal(parseMetricsLog(`${good}\n{"ts":"${T0},"sess`).length, 1)
  assert.equal(parseMetricsLog(`${good}\nnot json\n`).length, 1)
  assert.equal(parseMetricsLog("").length, 0)
})

test("parseWorkLog reads verify, reset, tamper, and unreadable entries", () => {
  const text = [
    `${T0} reset`,
    `${T0} verify: pass=57 fail=0 (exit 0)`,
    `${T0} verify: spec tampered: README.md differs from template`,
    `${T0} verify: unreadable runner summary (exit 1)`,
  ].join("\n")
  const entries = parseWorkLog(text)
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["reset", "verify", "tamper", "unreadable"],
  )
  const verify = entries[1]!
  assert.equal(verify.kind === "verify" && verify.passed === 57 && verify.failed === 0 && verify.exit === 0, true)
})

test("buildCensus labels blocks from the flip log, calibration included", () => {
  const census = buildCensus({
    flipLogText: flipLogText(["OFF", "ON-FULL"]),
    spawnLogText: spawnLogText([
      { label: "cal", arm: "OFF", sessionId: "s_cal", exit: 0, minute: 5 },
      { label: "1", arm: "OFF", sessionId: "s1", exit: 0, minute: 15 },
      { label: "2", arm: "OFF", sessionId: "s2", exit: 0, minute: 25 },
    ]),
    workLogText: workLogText([
      { label: "cal", passed: 57, failed: 0, minute: 6 },
      { label: "1", passed: 57, failed: 0, minute: 16 },
      { label: "2", passed: 57, failed: 0, minute: 26 },
    ]),
    metricsLogText: "",
    turns: turnsOf(new Map([["s_cal", [turn(6)]], ["s1", [turn(16)]], ["s2", [turn(26)]]])),
  })
  assert.deepEqual(
    census.map((row) => [row.blockLabel, row.arm]),
    [
      ["cal", CALIBRATION_ARM],
      ["1", "OFF"],
      ["2", "ON-FULL"],
    ],
  )
})

test("the calibration block carries the calibration exclusion and never counts as data", () => {
  const census = buildCensus({
    flipLogText: flipLogText([]),
    spawnLogText: spawnLogText([{ label: "cal", arm: CALIBRATION_ARM, sessionId: "s_cal", exit: 0, minute: 5 }]),
    workLogText: workLogText([{ label: "cal", passed: 57, failed: 0, minute: 6 }]),
    metricsLogText: "",
    turns: turnsOf(new Map([["s_cal", [turn(6)]]])),
  })
  assert.equal(census[0]!.exclusion, "calibration")
  assert.equal(census[0]!.blockNumber, null)
})

test("a nonzero spawn exit classifies the block as an incomplete run", () => {
  const census = buildCensus({
    flipLogText: flipLogText(["OFF"]),
    spawnLogText: spawnLogText([{ label: "1", arm: "OFF", sessionId: "s1", exit: 1, minute: 15 }]),
    workLogText: workLogText([{ label: "1", passed: 57, failed: 0, minute: 16 }]),
    metricsLogText: "",
    turns: turnsOf(new Map([["s1", [turn(16)]]])),
  })
  assert.equal(census[0]!.exclusion, "incomplete-run")
})

test("an unknown session id, a red verify, or zero turns each classifies an incomplete run", () => {
  const census = buildCensus({
    flipLogText: flipLogText(["OFF", "ON-FULL", "ON-DRY"]),
    spawnLogText: spawnLogText([
      { label: "1", arm: "OFF", sessionId: "unknown", exit: 0, minute: 15 },
      { label: "2", arm: "ON-FULL", sessionId: "s2", exit: 0, minute: 25 },
      { label: "3", arm: "ON-DRY", sessionId: "s3", exit: 0, minute: 35 },
    ]),
    workLogText: workLogText([
      { label: "1", passed: 57, failed: 0, minute: 16 },
      { label: "2", passed: 0, failed: 57, minute: 26 },
      { label: "3", passed: 57, failed: 0, minute: 36 },
    ]),
    metricsLogText: "",
    turns: turnsOf(new Map([["s2", [turn(26)]], ["s3", []]])),
  })
  assert.equal(census[0]!.exclusion, "incomplete-run")
  assert.equal(census[1]!.exclusion, "incomplete-run")
  assert.equal(census[2]!.exclusion, "incomplete-run")
})

test("a session reused across two blocks is spanning in both", () => {
  const census = buildCensus({
    flipLogText: flipLogText(["OFF", "ON-FULL"]),
    spawnLogText: spawnLogText([
      { label: "1", arm: "OFF", sessionId: "shared", exit: 0, minute: 15 },
      { label: "2", arm: "ON-FULL", sessionId: "shared", exit: 0, minute: 25 },
    ]),
    workLogText: workLogText([
      { label: "1", passed: 57, failed: 0, minute: 16 },
      { label: "2", passed: 57, failed: 0, minute: 26 },
    ]),
    metricsLogText: "",
    turns: turnsOf(new Map([["shared", [turn(16)]]])),
  })
  assert.equal(census[0]!.exclusion, "spanning")
  assert.equal(census[1]!.exclusion, "spanning")
})

test("turn activity reaching past the next block's spawn start is spanning", () => {
  const census = buildCensus({
    flipLogText: flipLogText(["OFF", "ON-FULL"]),
    spawnLogText: spawnLogText([
      { label: "1", arm: "OFF", sessionId: "s1", exit: 0, minute: 15 },
      { label: "2", arm: "ON-FULL", sessionId: "s2", exit: 0, minute: 25 },
    ]),
    workLogText: workLogText([
      { label: "1", passed: 57, failed: 0, minute: 16 },
      { label: "2", passed: 57, failed: 0, minute: 26 },
    ]),
    metricsLogText: "",
    turns: turnsOf(new Map([["s1", [turn(30)]], ["s2", [turn(26)]]])),
  })
  assert.equal(census[0]!.exclusion, "spanning")
  assert.equal(census[1]!.exclusion, null)
})

test("metrics events are attributed per block window and generations counted per block", () => {
  const census = buildCensus({
    flipLogText: flipLogText(["OFF", "ON-DRY"]),
    spawnLogText: spawnLogText([
      { label: "1", arm: "OFF", sessionId: "s1", exit: 0, minute: 15 },
      { label: "2", arm: "ON-DRY", sessionId: "s2", exit: 0, minute: 25 },
    ]),
    workLogText: workLogText([
      { label: "1", passed: 57, failed: 0, minute: 16 },
      { label: "2", passed: 57, failed: 0, minute: 26 },
    ]),
    metricsLogText: metricsLogText([
      { minute: 15, sessionId: "s1", generation: 1 },
      { minute: 16, sessionId: "s1", generation: 1 },
      { minute: 15.5, sessionId: "s2", generation: 2 },
      { minute: 40, sessionId: "s2", generation: 2 },
    ]),
    turns: turnsOf(new Map([["s1", [turn(16)]], ["s2", [turn(26)]]])),
  })
  // s1's window is [at(14), at(24)); the minute-15 and minute-16 events land
  // inside it. s2's window is [at(24), end); the minute-15.5 event precedes
  // it (it belongs to s1's side of the boundary) and minute-40 lands inside.
  assert.deepEqual(census[0]!.metricsGenerations, { 1: 2, 2: 0 })
  assert.deepEqual(census[1]!.metricsGenerations, { 1: 0, 2: 1 })
  assert.equal(census[0]!.windowStartMs, Date.parse(at(14)))
  assert.equal(census[0]!.windowEndMs, Date.parse(at(24)))
  assert.equal(census[1]!.windowEndMs, null)
})

test("a failing turn source surfaces turnsError and classifies the block incomplete", () => {
  const census = buildCensus({
    flipLogText: flipLogText(["OFF"]),
    spawnLogText: spawnLogText([{ label: "1", arm: "OFF", sessionId: "s1", exit: 0, minute: 15 }]),
    workLogText: workLogText([{ label: "1", passed: 57, failed: 0, minute: 16 }]),
    metricsLogText: "",
    turns: {
      assistantTurns: () => {
        throw new Error("sqlite disk I/O error")
      },
    },
  })
  assert.match(census[0]!.turnsError ?? "", /sqlite disk I\/O error/)
  assert.equal(census[0]!.exclusion, "incomplete-run")
})

test("openTurnDatabase reads assistant turns from an opencode-shaped DB, scoped and ordered", () => {
  const temp = tempDir("ab-census-db-")
  try {
    const dbPath = join(temp, "opencode.db")
    buildOpencodeDb(dbPath, [
      { sessionId: "s1", minute: 10, modelId: "glm-5.3", input: 100000, output: 10000, cacheWrite: 5000, updatedMinute: 11 },
      { sessionId: "s1", minute: 20, modelId: "glm-5.3", input: 50000, output: 5000, cacheWrite: 1000, updatedMinute: 21 },
      { sessionId: "s2", minute: 12, modelId: "glm-5.3", input: 1, output: 1, cacheWrite: 1 },
    ])
    const source = openTurnDatabase(dbPath)
    const turns = source.assistantTurns("s1")
    assert.equal(turns.length, 2)
    assert.equal(turns[0]!.inputTokens, 100000)
    assert.equal(turns[0]!.cacheWriteTokens, 5000)
    assert.equal(turns[0]!.modelId, "glm-5.3")
    assert.ok(turns[0]!.createdAtMs < turns[1]!.createdAtMs)
    assert.equal(source.assistantTurns("s2").length, 1)
    assert.equal(source.assistantTurns("missing").length, 0)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("the rotator exercise is red against the committed stubs", () => {
  const exercise = resolveExercise("rotator")
  const result = runExerciseSuite(exercise.templateDir, "tests/rotator.test.mjs")
  assert.equal(result.status !== 0, true)
  assert.equal(result.fail, 26)
  assert.equal(result.pass, 0)
})

test("the rotator exercise is green against the committed reference", () => {
  const exercise = resolveExercise("rotator")
  const result = runExerciseSuite(exercise.referenceDir, "tests/rotator.test.mjs")
  assert.equal(result.status, 0)
  assert.equal(result.pass, 26)
  assert.equal(result.fail, 0)
})

test("frozen spec files byte-match between template and reference for both exercises", () => {
  for (const name of ["rotator", "deep"] as const) {
    const exercise = resolveExercise(name)
    for (const spec of exercise.specFiles) {
      assert.deepEqual(readFileSync(join(exercise.templateDir, spec)), readFileSync(join(exercise.referenceDir, spec)), `${name}/${spec} stale`)
    }
  }
})

test("the tamper gate flags every modified frozen spec file", () => {
  const exercise = resolveExercise("rotator")
  for (const spec of exercise.specFiles) {
    const workDir = tempDir("ab-tamper-")
    try {
      cpSync(exercise.templateDir, workDir, { recursive: true })
      writeFileSync(join(workDir, spec), `${readFileSync(join(workDir, spec), "utf8")}\n// tamper\n`)
      assert.deepEqual(checkSpecIntegrity(exercise.templateDir, workDir, exercise.specFiles), { ok: false, file: spec })
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }
})

test("the deep tamper gate flags the workdir fence config alongside the shared spec files", () => {
  const exercise = resolveExercise("deep")
  for (const spec of exercise.workdirSpecFiles) {
    const workDir = tempDir("ab-tamper-deep-")
    try {
      cpSync(exercise.templateDir, workDir, { recursive: true })
      writeFileSync(join(workDir, spec), `${readFileSync(join(workDir, spec), "utf8")}\n// tamper\n`)
      assert.deepEqual(checkSpecIntegrity(exercise.templateDir, workDir, exercise.workdirSpecFiles), { ok: false, file: spec })
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }
})

test("the tamper gate flags a missing work spec file", () => {
  const exercise = resolveExercise("rotator")
  const workDir = tempDir("ab-tamper-missing-")
  try {
    cpSync(exercise.templateDir, workDir, { recursive: true })
    rmSync(join(workDir, "package.json"))
    assert.deepEqual(checkSpecIntegrity(exercise.templateDir, workDir, exercise.specFiles), { ok: false, file: "package.json" })
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test("a missing template spec file is an apparatus defect, not a tamper verdict", () => {
  const result = checkSpecIntegrity(resolveExercise("rotator").templateDir, "/nonexistent-work", ["no-such-file.md"])
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.file : "", /template missing/)
})

test("the rotator paste prompt is the frozen single-line prompt", () => {
  const exercise = resolveExercise("rotator")
  assert.equal(exercise.pastePrompt.includes("\n"), false)
  assert.match(exercise.pastePrompt, /Do not modify anything under tests\//)
  assert.match(exercise.pastePrompt, /the spec files are frozen/)
})

test("the deep exercise is red against the committed stubs", () => {
  const exercise = resolveExercise("deep")
  const result = runExerciseSuite(exercise.templateDir, "tests/importer.test.mjs")
  assert.equal(result.status !== 0, true)
  assert.equal(result.fail, 57)
  assert.equal(result.pass, 0)
})

test("the deep exercise is green against the committed reference", () => {
  const exercise = resolveExercise("deep")
  const result = runExerciseSuite(exercise.referenceDir, "tests/importer.test.mjs")
  assert.equal(result.status, 0)
  assert.equal(result.pass, 57)
  assert.equal(result.fail, 0)
})

test("the deep suite pins the four table digests and imports only the subject module beyond builtins", () => {
  const suiteText = readFileSync(join(resolveExercise("deep").templateDir, "tests", "importer.test.mjs"), "utf8")
  for (const pin of ["STATUS_TABLE_DIGEST", "CALIBRATION_TABLE_DIGEST", "SITE_TABLE_DIGEST", "DAT_LAYOUT_DIGEST"]) {
    assert.match(suiteText, new RegExp(`const ${pin} = "`), `missing digest pin ${pin}`)
  }
  const importSpecifiers = [...suiteText.matchAll(/from "([^"]+)"/g)].map((match) => match[1]!)
  const nonBuiltins = importSpecifiers.filter((specifier) => !specifier.startsWith("node:"))
  assert.deepEqual(nonBuiltins, ["../src/importer.mjs"])
})

test("the deep template carries the qhaway guard and the eight-needle apparatus isolation fence", () => {
  const guard = JSON.parse(readFileSync(join(resolveExercise("deep").templateDir, ".opencode", "opencode.json"), "utf8")) as {
    $schema?: string
    plugin?: unknown
    permission: Record<string, string | Record<string, string>>
  }
  assert.match(guard.$schema ?? "", /opencode\.ai\/config\.json/)
  assert.equal(guard.plugin, undefined)
  const mcpDenies = ["context7_*", "playwright_*", "qhaway_*"]
  const fenceCategories = ["read", "glob", "grep", "list", "edit", "bash", "external_directory"]
  const fenceNeedles = [
    "*ab-work-deep-reference*",
    "*ab-work-deep-template*",
    "*opencode-ab-work-deep*",
    "*ab-work-deep.log*",
    "*ab-work-template*",
    "*ab-test*",
    "*ab-redcheck*",
    "*ab-deep-redcheck*",
  ]
  assert.deepEqual(Object.keys(guard.permission).sort(), [...mcpDenies, ...fenceCategories].sort())
  for (const server of mcpDenies) assert.equal(guard.permission[server], "deny")
  for (const category of fenceCategories) {
    const needles = guard.permission[category] as Record<string, string>
    assert.deepEqual(Object.keys(needles).sort(), [...fenceNeedles].sort())
    assert.deepEqual(Object.values(needles), fenceNeedles.map(() => "deny"))
  }
})

test("the deep README orders the corpus harvest before any suite reading", () => {
  const readme = readFileSync(join(resolveExercise("deep").templateDir, "README.md"), "utf8")
  const harvestLine = readme.split("\n").findIndex((line) => line.includes("before reading any test"))
  const suiteLine = readme.split("\n").findIndex((line) => line.includes("tests/importer.test.mjs"))
  assert.ok(harvestLine >= 0 && suiteLine >= 0 && harvestLine < suiteLine)
  assert.match(readme, /Transcribing the suite/)
  assert.match(readme, /case-insensitively/)
})

test("the deep generator is deterministic across two fresh runs", () => {
  const first = tempDir("ab-deep-gen-a-")
  const second = tempDir("ab-deep-gen-b-")
  try {
    generateCorpus(resolveExercise("deep").templateDir, first)
    generateCorpus(resolveExercise("deep").templateDir, second)
    assert.equal(treeManifest(join(first, "data")), treeManifest(join(second, "data")))
  } finally {
    rmSync(first, { recursive: true, force: true })
    rmSync(second, { recursive: true, force: true })
  }
})

test("the deep generator reproduces the committed corpus manifest byte-for-byte", () => {
  const generated = tempDir("ab-deep-gen-pin-")
  try {
    generateCorpus(resolveExercise("deep").templateDir, generated)
    const regenerated = treeManifest(join(generated, "data"))
      .split("\n")
      .map((line) => line.replace(/^([0-9a-f]+)  /, "$1  data/"))
      .join("\n")
    assert.equal(regenerated, corpusManifest())
  } finally {
    rmSync(generated, { recursive: true, force: true })
  }
})

test("the deep corpus shape is 96 archives, 53 directives, three formats", () => {
  const generated = tempDir("ab-deep-gen-shape-")
  try {
    generateCorpus(resolveExercise("deep").templateDir, generated)
    const dataDir = join(generated, "data")
    const names = readdirSync(dataDir).sort()
    assert.equal(names.length, 96)
    assert.deepEqual([...new Set(names.map((name) => name.split(".").pop()))].sort(), ["csv", "dat", "jsonl"])
    let directives = 0
    for (const name of names) {
      const text = readFileSync(join(dataDir, name), "utf8")
      directives += text.split("\n").filter((line) => /directive/i.test(line)).length
      assert.ok(statSync(join(dataDir, name)).size > 0)
    }
    assert.equal(directives, 53)
  } finally {
    rmSync(generated, { recursive: true, force: true })
  }
})

test("the deep paste prompt is the frozen single-line prompt with the memory-tool prohibition", () => {
  const exercise = resolveExercise("deep")
  assert.equal(exercise.pastePrompt.includes("\n"), false)
  assert.match(exercise.pastePrompt, /Do not modify anything under tests\//)
  assert.match(exercise.pastePrompt, /the spec files are frozen/)
  assert.match(exercise.pastePrompt, /memory tools/)
  assert.match(exercise.pastePrompt, /qhaway/)
})

test("a full 18-block fixture resolves to labeled blocks with six runs per arm", () => {
  const spawnEntries = [
    { label: "cal", arm: CALIBRATION_ARM, sessionId: "ses_cal", exit: 0, minute: 5 },
    ...SCHEDULE.map((arm, index) => ({ label: String(index + 1), arm, sessionId: `ses_${index + 1}`, exit: 0, minute: 15 + index * 10 })),
  ]
  const census = buildCensus({
    flipLogText: flipLogText(SCHEDULE),
    spawnLogText: spawnLogText(spawnEntries, { completion: true }),
    workLogText: workLogText([
      { label: "cal", passed: 57, failed: 0, minute: 6 },
      ...SCHEDULE.map((_, index) => ({ label: String(index + 1), passed: 57, failed: 0, minute: 16 + index * 10 })),
    ]),
    metricsLogText: "",
    turns: turnsOf(new Map(spawnEntries.map((entry) => [entry.sessionId, [turn(entry.minute + 1)]]))),
  })
  assert.equal(census.length, 19)
  const includedByArm = { OFF: 0, "ON-FULL": 0, "ON-DRY": 0 }
  for (const row of census) {
    if (row.exclusion === null) includedByArm[row.arm as keyof typeof includedByArm] += 1
  }
  assert.deepEqual(includedByArm, { OFF: 6, "ON-FULL": 6, "ON-DRY": 6 })
  assert.equal(census.filter((row) => row.exclusion === "calibration").length, 1)
})

test("wouldEvictThisRun generation-2 metrics land only in their own session's blocks", () => {
  const census = buildCensus({
    flipLogText: flipLogText(["OFF", "ON-DRY"]),
    spawnLogText: spawnLogText([
      { label: "1", arm: "OFF", sessionId: "ses_off", exit: 0, minute: 15 },
      { label: "2", arm: "ON-DRY", sessionId: "ses_dry", exit: 0, minute: 25 },
    ]),
    workLogText: workLogText([
      { label: "1", passed: 57, failed: 0, minute: 16 },
      { label: "2", passed: 57, failed: 0, minute: 26 },
    ]),
    metricsLogText: metricsLogText([
      { minute: 15, sessionId: "ses_off", generation: 1 },
      { minute: 16, sessionId: "ses_off", generation: 1 },
      { minute: 27, sessionId: "ses_dry", generation: 2 },
    ]),
    turns: turnsOf(new Map([["ses_off", [turn(16)]], ["ses_dry", [turn(26)]]])),
  })
  assert.deepEqual(census[0]!.metricsGenerations, { 1: 2, 2: 0 })
  assert.deepEqual(census[1]!.metricsGenerations, { 1: 0, 2: 1 })
})

test("a full flip log without the completion marker withholds completion instead of claiming it", () => {
  const era = readDeepEra(flipLogText(SCHEDULE))
  const withheld = decideNextBlock(era, false, false)
  assert.equal(withheld.kind, "completion-withheld")
  const complete = decideNextBlock(era, false, true)
  assert.equal(complete.kind, "refuse")
  assert.equal(complete.kind === "refuse" ? complete.rc : -1, 10)
  const missingFive = spawnLogText(SCHEDULE.map((arm, index) => ({ label: String(index + 1), arm, sessionId: `s${index}`, exit: 0, minute: index * 10 })).filter((entry) => entry.label !== "5"))
  assert.deepEqual(missingCoverageBlocks(missingFive), [5])
  const full = spawnLogText(SCHEDULE.map((arm, index) => ({ label: String(index + 1), arm, sessionId: `s${index}`, exit: 0, minute: index * 10 })))
  assert.deepEqual(missingCoverageBlocks(full), [])
})

test("a parked block is unconsumed and the resume re-runs the same arm position", () => {
  const parked = decideNextBlock(readDeepEra(flipLogText(["OFF", "PARKED quota-exhaustion"])), false, false)
  assert.deepEqual(parked, { kind: "run", blockLabel: "1", arm: "OFF" })
  const resumed = decideNextBlock(readDeepEra(flipLogText(["OFF", "PARKED quota-exhaustion", "OFF"])), false, false)
  assert.deepEqual(resumed, { kind: "run", blockLabel: "2", arm: "ON-FULL" })
})

test("decideNextBlock refuses every broken flip-log history with the pinned codes", () => {
  const noCalibration = decideNextBlock(readDeepEra(""), false, false)
  assert.equal(noCalibration.kind, "refuse")
  assert.equal(noCalibration.kind === "refuse" ? noCalibration.rc : -1, 11)
  assert.match(noCalibration.kind === "refuse" ? noCalibration.reason : "", /no calibration flip/)

  const doubleCalibration = decideNextBlock(readDeepEra(`${at(0)} CAL-ON-FULL\n${at(5)} CAL-ON-FULL\n${at(10)} OFF\n`), false, false)
  assert.equal(doubleCalibration.kind, "refuse")
  assert.match(doubleCalibration.kind === "refuse" ? doubleCalibration.reason : "", /multiple calibration flips/)

  const mismatch = decideNextBlock(readDeepEra(flipLogText(["OFF", "OFF"])), false, false)
  assert.match(mismatch.kind === "refuse" ? mismatch.reason : "", /position 2 carries arm OFF, expected ON-FULL/)

  const doublePark = decideNextBlock(readDeepEra(flipLogText(["OFF", "PARKED quota-exhaustion", "PARKED quota-exhaustion"])), false, false)
  assert.equal(doublePark.kind === "refuse" ? doublePark.rc : -1, 21)

  assert.deepEqual(decideNextBlock(readDeepEra(""), true, false), { kind: "run", blockLabel: "cal", arm: CALIBRATION_ARM })
  const calibrationDone = decideNextBlock(readDeepEra(flipLogText([])), true, false)
  assert.equal(calibrationDone.kind === "refuse" ? calibrationDone.rc : -1, 10)
})

const withFakeEnv = (values: Record<string, string>, run: () => void): void => {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    process.env[key] = value
  }
  try {
    run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("flipArmAndAssert passes a correct flip and logs the arm assertion", () => {
  const temp = tempDir("ab-shell-flip-ok-")
  try {
    const configPath = join(temp, "config.json")
    const flipLog = join(temp, "ab-flip.log")
    const fake = writeFakeFlip(temp, "correct")
    withFakeEnv({ ABX_CONFIG: configPath, ABX_FLIP_LOG: flipLog }, () => {
      const output = flipArmAndAssert(cliConfigFor(temp, { flipCmd: fake }), "ON-FULL")
      assert.match(output ?? "", /flipped to on-full/)
      const blockLog = readFileSync(join(temp, BLOCK_LOG_BASENAME), "utf8")
      assert.match(blockLog, /flip: flipped to on-full/)
      assert.match(blockLog, /arm-assert: OK \(ON-FULL\)/)
      assert.equal(configMatchesArm(JSON.parse(readFileSync(configPath, "utf8")), "ON-FULL"), true)
      assert.match(readFileSync(flipLog, "utf8"), / ON-FULL\n$/)
      assert.equal(FLIP_ARG_BY_ARM["ON-DRY"], "on-dry")
    })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("flipArmAndAssert catches an inverted manualMode boolean as an infra failure", () => {
  const temp = tempDir("ab-shell-flip-bool-")
  try {
    const fake = writeFakeFlip(temp, "wrong-bool")
    withFakeEnv({ ABX_CONFIG: join(temp, "config.json"), ABX_FLIP_LOG: join(temp, "ab-flip.log") }, () => {
      const output = flipArmAndAssert(cliConfigFor(temp, { flipCmd: fake }), "ON-FULL")
      assert.equal(output, null)
      assert.match(readFileSync(join(temp, BLOCK_LOG_BASENAME), "utf8"), /arm-assert: FAILED \(live config does not match arm ON-FULL/)
    })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("flipArmAndAssert catches swapped arm entries (dry entry under the full name)", () => {
  const temp = tempDir("ab-shell-flip-swap-")
  try {
    const fake = writeFakeFlip(temp, "swapped")
    withFakeEnv({ ABX_CONFIG: join(temp, "config.json"), ABX_FLIP_LOG: join(temp, "ab-flip.log") }, () => {
      assert.equal(flipArmAndAssert(cliConfigFor(temp, { flipCmd: fake }), "ON-FULL"), null)
      assert.equal(flipArmAndAssert(cliConfigFor(temp, { flipCmd: fake }), "ON-DRY"), null)
      const blockLog = readFileSync(join(temp, BLOCK_LOG_BASENAME), "utf8")
      assert.match(blockLog, /arm-assert: FAILED \(live config does not match arm ON-FULL/)
      assert.match(blockLog, /arm-assert: FAILED \(live config does not match arm ON-DRY/)
    })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("resetExercise accepts a single-line prompt and logs it", () => {
  const temp = tempDir("ab-shell-reset-ok-")
  try {
    const fake = writeFakeWork(temp, {})
    withFakeEnv({ ABX_WORK_LOG: join(temp, WORK_LOG_DEEP_BASENAME) }, () => {
      const prompt = resetExercise(cliConfigFor(temp, { workCmd: fake }))
      assert.match(prompt ?? "", /^Complete the deep coding task/)
      assert.equal((prompt ?? "").includes("\n"), false)
      assert.match(readFileSync(join(temp, BLOCK_LOG_BASENAME), "utf8"), /reset: prompt="Complete the deep coding task/)
    })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("resetExercise fails on a nonzero reset and on a multiline or empty prompt", () => {
  const failing = tempDir("ab-shell-reset-fail-")
  const multiline = tempDir("ab-shell-reset-multi-")
  try {
    withFakeEnv({ ABX_WORK_LOG: join(failing, WORK_LOG_DEEP_BASENAME) }, () => {
      const output = resetExercise(cliConfigFor(failing, { workCmd: writeFakeWork(failing, { resetStatus: 3 }) }))
      assert.equal(output, null)
      assert.match(readFileSync(join(failing, BLOCK_LOG_BASENAME), "utf8"), /reset: FAILED \(exit 3/)
    })
    withFakeEnv({ ABX_WORK_LOG: join(multiline, WORK_LOG_DEEP_BASENAME) }, () => {
      const output = resetExercise(cliConfigFor(multiline, { workCmd: writeFakeWork(multiline, { promptLines: ["line one", "line two"] }) }))
      assert.equal(output, null)
    })
  } finally {
    rmSync(failing, { recursive: true, force: true })
    rmSync(multiline, { recursive: true, force: true })
  }
})

test("the readout renders the Report File Template shape and deposits the file", () => {
  const rows: CensusRow[] = [
    {
      blockLabel: "cal",
      blockNumber: null,
      arm: CALIBRATION_ARM,
      started: at(5),
      sessionId: "ses_cal",
      spawnExit: 0,
      verifyPassed: 57,
      verifyFailed: 0,
      verifyExit: 0,
      turns: [turn(6)],
      turnsError: null,
      metricsEvents: [],
      metricsGenerations: { 1: 3, 2: 0 },
      windowStartMs: null,
      windowEndMs: null,
      exclusion: "calibration",
    },
    {
      blockLabel: "1",
      blockNumber: 1,
      arm: "OFF",
      started: at(15),
      sessionId: "ses_1",
      spawnExit: 0,
      verifyPassed: 57,
      verifyFailed: 0,
      verifyExit: 0,
      turns: [turn(16), turn(17)],
      turnsError: null,
      metricsEvents: [],
      metricsGenerations: { 1: 0, 2: 4 },
      windowStartMs: null,
      windowEndMs: null,
      exclusion: null,
    },
  ]
  const creditsByBlock = new Map([
    ["cal", 41.35],
    ["1", 82.7],
  ])
  const { summaries, contrasts } = computeEndpoints([endpointRow("OFF", 82.7, 2, 1)])
  const inputs: ReadoutInputs = {
    taskFileBasename: "LRU-83",
    slug: "readout",
    from: "worker-lru83",
    date: "2026-10-04 15:00",
    title: "A/B readout over 2 census rows.",
    rows,
    creditsByBlock,
    summaries,
    contrasts,
    caveats: ["caveat text"],
  }
  const content = renderReadout(inputs)
  const sectionOrder = ["## Findings", "## Decisions", "## Blocks", "## Next"].map((section) => content.indexOf(section))
  assert.equal(sectionOrder.every((position) => position >= 0), true)
  assert.deepEqual([...sectionOrder].sort((a, b) => a - b), sectionOrder)
  assert.match(content, /^\| block \| arm \| turns \| credits \| metrics g1\/g2 \| exclusion \|/m)
  assert.match(content, /\| cal \| CAL-ON-FULL \| 1 \| 41\.3500 \| 3\/0 \| calibration \|/)
  assert.match(content, /\| 1 \| OFF \| 2 \| 82\.7000 \| 0\/4 \| included \|/)
  assert.match(content, /creditsPerTurn/)
  assert.match(content, /caveat: caveat text/)
  const temp = tempDir("ab-readout-write-")
  try {
    const depositPath = join(temp, "nested", "readout.md")
    writeReadoutFile(depositPath, content)
    assert.equal(existsSync(depositPath), true)
    assert.equal(readFileSync(depositPath, "utf8"), content)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Review-83-1 fix-round cases (F1-F6).
// ---------------------------------------------------------------------------

test("the exercise tool's work-log lines round-trip through the census's parseWorkLog", () => {
  const temp = tempDir("ab-f1-logline-")
  try {
    const options: ExerciseCliOptions = { home: temp, scratchDir: temp, workDir: join(temp, "work"), nodeBin: process.execPath }
    writeWorkLogLine(options, "deep", "reset")
    writeWorkLogLine(options, "deep", "verify: pass=57 fail=0 (exit 0)")
    writeWorkLogLine(options, "deep", "verify: spec tampered: README.md differs from template")
    const written = readFileSync(join(temp, WORK_LOG_DEEP_BASENAME), "utf8")
    const lines = written.split("\n").filter((line) => line.length > 0)
    assert.equal(lines.length, 3)
    for (const line of lines) assert.match(line, /^\d{4}-\d{2}-\d{2}T/, "every written line carries the ISO timestamp prefix")
    const entries = parseWorkLog(written)
    assert.deepEqual(
      entries.map((entry) => entry.kind),
      ["reset", "verify", "tamper"],
    )
    const verify = entries[1]!
    assert.equal(verify.kind === "verify" && verify.passed === 57 && verify.failed === 0 && verify.exit === 0, true)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("a real resetTree invocation writes a parseable reset line into the exercise log", () => {
  const temp = tempDir("ab-f1-reset-")
  try {
    const options = tempExerciseOptions(temp, "work-rotator")
    assertContainedInTemp(options.workDir, temp)
    const prompt = resetTree(resolveExercise("rotator"), options)
    assert.match(prompt ?? "", /^Complete the coding task/)
    const entries = parseWorkLog(readFileSync(join(options.home, WORK_LOG_BASENAME), "utf8"))
    assert.equal(entries.at(-1)!.kind, "reset")
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("the verify runner glob includes a solver-added test file", () => {
  const temp = tempDir("ab-f6-extra-")
  try {
    const options = tempExerciseOptions(temp, "work-rotator")
    assertContainedInTemp(options.workDir, temp)
    resetTree(resolveExercise("rotator"), options)
    writeFileSync(
      join(options.workDir, "tests", "extra.test.mjs"),
      ["import test from \"node:test\"", "import assert from \"node:assert/strict\"", "test(\"solver-added case fails\", () => { assert.equal(1, 2) })"].join("\n"),
    )
    const status = verifyTree(resolveExercise("rotator"), options)
    assert.equal(status !== 0, true)
    // The baseline stub run is 26 tests; the added file must have run too.
    const logged = readFileSync(join(options.home, WORK_LOG_BASENAME), "utf8")
    assert.match(logged, /verify: pass=0 fail=27/)
    assert.deepEqual(suiteFilesOf(options.workDir), [join("tests", "extra.test.mjs"), join("tests", "rotator.test.mjs")])
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("the deep template carries the generator, reset generates the corpus, and the laid stub differs from the reference", () => {
  const deep = resolveExercise("deep")
  assert.equal(existsSync(join(deep.templateDir, "tools", "generate.mjs")), true)
  const temp = tempDir("ab-f6-stub-")
  try {
    const options = tempExerciseOptions(temp, "work-deep")
    assertContainedInTemp(options.workDir, temp)
    resetTree(deep, options)
    assert.equal(existsSync(join(options.workDir, "data")), true, "reset must generate the corpus into the work tree")
    const laid = readFileSync(join(options.workDir, "src", "importer.mjs"))
    const reference = readFileSync(join(deep.referenceDir, "src", "importer.mjs"))
    assert.equal(laid.equals(reference), false, "the laid stub must not be byte-equal to the reference module")
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("the redcheck contamination guard covers both apparatus generations' scratch prefixes", () => {
  const temp = tempDir("ab-f5-scratch-")
  try {
    const options: ExerciseCliOptions = { home: temp, scratchDir: temp, workDir: join(temp, "work"), nodeBin: process.execPath }
    assert.equal(findRedcheckLeftover(options), null)
    for (const stale of ["ab-redcheck-deep.stale", "ab-deep-redcheck-stale", "ab-redcheck.stale"]) {
      writeFileSync(join(temp, stale), "")
      assert.equal(findRedcheckLeftover(options), join(temp, stale), `prefix of ${stale} must be caught`)
      assert.equal(REDCHECK_SCRATCH_PREFIXES.some((prefix) => stale.startsWith(prefix)), true)
      rmSync(join(temp, stale))
    }
    assert.equal(findRedcheckLeftover(options), null)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("the quota tail scans the last 40 real lines (trailing newline is not a 41st line)", () => {
  const marker = "the provider quota is exhausted"
  const build = (before: number, after: number): string =>
    [...Array.from({ length: before }, (_, index) => `line ${index}`), marker, ...Array.from({ length: after }, (_, index) => `after ${index}`)].join("\n") + "\n"
  assert.equal(isQuotaFailure(build(20, 39), 1), true, "marker on the 40th-from-last real line must park")
  assert.equal(isQuotaFailure(build(20, 40), 1), false, "marker on the 41st line from the end must not park")
})

test("metrics events past the window end prove a spanning session even though they attribute to no block", () => {
  const census = buildCensus({
    flipLogText: flipLogText(["OFF", "ON-FULL"]),
    spawnLogText: spawnLogText([
      { label: "1", arm: "OFF", sessionId: "s1", exit: 0, minute: 15 },
      { label: "2", arm: "ON-FULL", sessionId: "s2", exit: 0, minute: 25 },
    ]),
    workLogText: workLogText([
      { label: "1", passed: 57, failed: 0, minute: 16 },
      { label: "2", passed: 57, failed: 0, minute: 26 },
    ]),
    // s1's metrics run entirely past block 2's spawn start (minute 24): they
    // attribute to no block's window but still mark s1 as spanning.
    metricsLogText: metricsLogText([
      { minute: 30, sessionId: "s1", generation: 1 },
      { minute: 31, sessionId: "s1", generation: 1 },
    ]),
    turns: turnsOf(new Map([["s1", [turn(16)]], ["s2", [turn(26)]]])),
  })
  assert.equal(census[0]!.exclusion, "spanning")
  assert.deepEqual(census[0]!.metricsGenerations, { 1: 0, 2: 0 })
  assert.equal(census[1]!.exclusion, null)
})

test("the CLI main creates a fresh nonexistent experiment home before its first log touch", async () => {
  const temp = tempDir("ab-f2-fresh-home-")
  try {
    const freshHome = join(temp, "fresh", "nested", "home")
    // The invalid-ceiling refusal is main's lightest path: it bootstraps the
    // home, writes the infra-error block line, and returns before tool
    // resolution and the lock fork.
    const exitCode = await runCli(["not-a-subcommand"], { AB_HOME: freshHome, AB_CREDIT_CEILING: "not-a-number" })
    assert.equal(exitCode, 1, "the invalid ceiling refuses with exit 1")
    const blockLog = readFileSync(join(freshHome, BLOCK_LOG_BASENAME), "utf8")
    assert.match(blockLog, /invalid AB_CREDIT_CEILING: not-a-number/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Lever-series experiment profile (LRU-85-2).
// ---------------------------------------------------------------------------

test("the lever profile's seeds pin the 12k geometry and the LEVER arm adds cacheAwareHints", () => {
  assert.equal(
    JSON.stringify(ON_PLUGIN_ENTRY),
    '[["./opencode-context-manager/plugin/context-manager.ts",{"manualMode":false,"watermarkTokens":250000,"agedReadEvictionMessages":30,"reasoningRetentionMessages":16}]]',
    "the frozen deep ON seed must stay byte-identical",
  )
  assert.equal(
    JSON.stringify(ON_DRY_PLUGIN_ENTRY),
    '[["./opencode-context-manager/plugin/context-manager.ts",{"manualMode":true,"watermarkTokens":250000,"agedReadEvictionMessages":30,"reasoningRetentionMessages":16}]]',
    "the frozen deep ON-DRY seed must stay byte-identical",
  )
  const leverOnFull = LEVER_ON_FULL_PLUGIN_ENTRY[0]![1]
  assert.deepEqual(leverOnFull, { manualMode: false, watermarkTokens: 12000, agedReadEvictionMessages: 30, reasoningRetentionMessages: 16 })
  assert.equal("cacheAwareHints" in leverOnFull, false, "the profile's ON-FULL seed carries no lever keys")
  assert.deepEqual(LEVER_ARM_PLUGIN_ENTRY[0]![1], {
    manualMode: false,
    watermarkTokens: 12000,
    agedReadEvictionMessages: 30,
    reasoningRetentionMessages: 16,
    cacheAwareHints: true,
  })
  assert.equal(LEVER_ON_FULL_PLUGIN_ENTRY[0]![0], LEVER_ARM_PLUGIN_ENTRY[0]![0], "both lever seeds point at the same plugin path")
})

test("configMatchesArm discriminates the lever arms per profile and maps calibration to the profile's ON-FULL seed", () => {
  assert.equal(configMatchesArm({ plugin: LEVER_ARM_PLUGIN_ENTRY }, "LEVER", LEVER1_PROFILE), true)
  assert.equal(configMatchesArm({ plugin: LEVER_ON_FULL_PLUGIN_ENTRY }, "LEVER", LEVER1_PROFILE), false, "the missing cacheAwareHints key must fail the LEVER assertion")
  assert.equal(configMatchesArm({ plugin: LEVER_ON_FULL_PLUGIN_ENTRY }, "ON-FULL", LEVER1_PROFILE), true)
  assert.equal(configMatchesArm({ plugin: LEVER_ARM_PLUGIN_ENTRY }, "ON-FULL", LEVER1_PROFILE), false)
  assert.equal(configMatchesArm({ plugin: LEVER_ON_FULL_PLUGIN_ENTRY }, CALIBRATION_ARM, LEVER1_PROFILE), true, "the calibration token maps to the profile's ON-FULL seed")
  assert.equal(configMatchesArm({ plugin: [] }, "OFF", LEVER1_PROFILE), true)
  assert.equal(configMatchesArm({ plugin: LEVER_ARM_PLUGIN_ENTRY }, "OFF", LEVER1_PROFILE), false)
  assert.equal(configMatchesArm({ plugin: ON_PLUGIN_ENTRY }, "ON-FULL", LEVER1_PROFILE), false, "the frozen 250k seed is not a lever-profile seed")
  assert.equal(configMatchesArm({ plugin: ON_DRY_PLUGIN_ENTRY }, "ON-DRY", LEVER1_PROFILE), false, "ON-DRY is not a lever arm")
  assert.equal(configMatchesArm(null, "LEVER", LEVER1_PROFILE), false)
})

test("applyArmToConfig applies the lever profile's seeds and refuses arms outside the profile", () => {
  const flipped = applyArmToConfig({ model: "test-model", theme: "dark", plugin: [] as unknown[] }, "LEVER", LEVER1_PROFILE) as { model: string; theme: string; plugin: unknown }
  assert.equal(flipped.model, "test-model")
  assert.equal(flipped.theme, "dark")
  assert.deepEqual(flipped.plugin, LEVER_ARM_PLUGIN_ENTRY)
  const onFull = applyArmToConfig({ plugin: [] }, "ON-FULL", LEVER1_PROFILE) as { plugin: unknown }
  assert.deepEqual(onFull.plugin, LEVER_ON_FULL_PLUGIN_ENTRY)
  const off = applyArmToConfig({ plugin: LEVER_ARM_PLUGIN_ENTRY }, "OFF", LEVER1_PROFILE) as { plugin: unknown }
  assert.deepEqual(off.plugin, [])
  assert.throws(() => applyArmToConfig({ plugin: [] }, "LEVER", DEEP_PROFILE), /no plugin seed in the deep profile/)
})

test("the lever profile's mirrored 18-block schedule runs OFF, ON-FULL, LEVER at mean run index 9.5", () => {
  assert.equal(LEVER_SCHEDULE.length, TOTAL_DATA_BLOCKS)
  assert.deepEqual(Array.from({ length: TOTAL_DATA_BLOCKS }, (_, index) => armForDataBlock(index + 1, LEVER1_PROFILE)), [...LEVER_SCHEDULE])
  for (const arm of new Set<string>(LEVER_SCHEDULE)) {
    const indices = LEVER_SCHEDULE.map((scheduleArm, index) => (scheduleArm === arm ? index + 1 : 0)).filter((index) => index > 0)
    assert.equal(indices.length, 6, `arm ${arm} holds six runs`)
    const mean = indices.reduce((sum, index) => sum + index, 0) / indices.length
    assert.equal(mean, 9.5, `arm ${arm} mean run index`)
  }
})

test("readDeepEra recognizes the LEVER token only under the lever profile and neither reader accepts the other's history", () => {
  const leverEra = readDeepEra(flipLogText(LEVER_SCHEDULE), LEVER1_PROFILE)
  assert.equal(eraDataCount(leverEra), 18)
  assert.equal(validateDeepRotation(leverEra, LEVER1_PROFILE), null)
  const frozenReaderOnLeverLog = readDeepEra(flipLogText(LEVER_SCHEDULE))
  assert.equal(validateDeepRotation(frozenReaderOnLeverLog) === null, false, "the frozen reader must refuse a lever history")
  const leverReaderOnFrozenLog = readDeepEra(flipLogText(SCHEDULE), LEVER1_PROFILE)
  assert.equal(validateDeepRotation(leverReaderOnFrozenLog, LEVER1_PROFILE) === null, false, "the lever reader must refuse a frozen deep history")
})

test("the census joins lever blocks by era position with six included runs per arm", () => {
  const spawnEntries = [
    { label: "cal", arm: CALIBRATION_ARM, sessionId: "ses_cal", exit: 0, minute: 5 },
    ...LEVER_SCHEDULE.map((arm, index) => ({ label: String(index + 1), arm, sessionId: `ses_${index + 1}`, exit: 0, minute: 15 + index * 10 })),
  ]
  const census = buildCensus({
    flipLogText: flipLogText(LEVER_SCHEDULE),
    spawnLogText: spawnLogText(spawnEntries, { completion: true }),
    workLogText: workLogText([
      { label: "cal", passed: 57, failed: 0, minute: 6 },
      ...LEVER_SCHEDULE.map((_, index) => ({ label: String(index + 1), passed: 57, failed: 0, minute: 16 + index * 10 })),
    ]),
    metricsLogText: "",
    turns: turnsOf(new Map(spawnEntries.map((entry) => [entry.sessionId, [turn(entry.minute + 1)]]))),
    profile: LEVER1_PROFILE,
  })
  assert.equal(census.length, 19)
  assert.deepEqual(census.map((row) => row.arm), [CALIBRATION_ARM, ...LEVER_SCHEDULE])
  const includedByArm: Record<string, number> = {}
  for (const row of census) {
    if (row.exclusion === null) includedByArm[row.arm] = (includedByArm[row.arm] ?? 0) + 1
  }
  assert.deepEqual(includedByArm, { OFF: 6, "ON-FULL": 6, LEVER: 6 })
  assert.equal(census.filter((row) => row.exclusion === "calibration").length, 1)
})

test("parseMetricsLog records whether a metrics line carries real evictions", () => {
  const events = parseMetricsLog(
    metricsLogText([
      { minute: 1, sessionId: "s1", generation: 1, evictions: 2 },
      { minute: 2, sessionId: "s2", generation: 2 },
    ]),
  )
  assert.equal(events.length, 2)
  assert.equal(events[0]!.evictedThisRun, true)
  assert.equal(events[1]!.evictedThisRun, false)
})

const corroborationCensus = (metricsEvents: readonly MetricsLineOptions[]): CensusRow[] =>
  buildCensus({
    flipLogText: flipLogText(["OFF", "ON-FULL", "LEVER"]),
    spawnLogText: spawnLogText([
      { label: "cal", arm: CALIBRATION_ARM, sessionId: "ses_cal", exit: 0, minute: 5 },
      { label: "1", arm: "OFF", sessionId: "ses_off", exit: 0, minute: 15 },
      { label: "2", arm: "ON-FULL", sessionId: "ses_full", exit: 0, minute: 25 },
      { label: "3", arm: "LEVER", sessionId: "ses_lever", exit: 0, minute: 35 },
    ]),
    workLogText: workLogText([
      { label: "cal", passed: 57, failed: 0, minute: 6 },
      { label: "1", passed: 57, failed: 0, minute: 16 },
      { label: "2", passed: 57, failed: 0, minute: 26 },
      { label: "3", passed: 57, failed: 0, minute: 36 },
    ]),
    metricsLogText: metricsLogText(metricsEvents),
    turns: turnsOf(new Map([
      ["ses_cal", [turn(6)]],
      ["ses_off", [turn(16)]],
      ["ses_full", [turn(26)]],
      ["ses_lever", [turn(36)]],
    ])),
    profile: LEVER1_PROFILE,
  })

test("the lever corroboration demands eviction-bearing metrics on ON arms and silence on OFF", () => {
  const healthy = corroborationCensus([
    { minute: 26, sessionId: "ses_full", generation: 1, evictions: 1 },
    { minute: 36, sessionId: "ses_lever", generation: 2, evictions: 1 },
  ])
  assert.deepEqual(uncorroboratedFullModeBlocks(healthy), [], "a corroborating series names no blocks")
  const offWithMetrics = corroborationCensus([
    { minute: 16, sessionId: "ses_off", generation: 1, evictions: 1 },
    { minute: 26, sessionId: "ses_full", generation: 1, evictions: 1 },
    { minute: 36, sessionId: "ses_lever", generation: 2, evictions: 1 },
  ])
  assert.deepEqual(uncorroboratedFullModeBlocks(offWithMetrics), ["1"], "an OFF block carrying metrics must be named")
  const onWithoutEvictions = corroborationCensus([
    { minute: 26, sessionId: "ses_full", generation: 1 },
    { minute: 36, sessionId: "ses_lever", generation: 2 },
  ])
  assert.deepEqual(uncorroboratedFullModeBlocks(onWithoutEvictions), ["2", "3"], "ON blocks without eviction-bearing lines must be named")
})

test("the corroboration flags every metrics-line leak class on an OFF block", () => {
  const dryModeLeak = corroborationCensus([
    { minute: 16, sessionId: "ses_off", generation: 2 },
    { minute: 26, sessionId: "ses_full", generation: 1, evictions: 1 },
    { minute: 36, sessionId: "ses_lever", generation: 2, evictions: 1 },
  ])
  assert.deepEqual(uncorroboratedFullModeBlocks(dryModeLeak), ["1"], "a dry-mode projection line on OFF is a leak")
  const quietFullModeLeak = corroborationCensus([
    { minute: 16, sessionId: "ses_off", generation: 1 },
    { minute: 26, sessionId: "ses_full", generation: 1, evictions: 1 },
    { minute: 36, sessionId: "ses_lever", generation: 2, evictions: 1 },
  ])
  assert.deepEqual(uncorroboratedFullModeBlocks(quietFullModeLeak), ["1"], "a quiet full-mode line on OFF is a leak")
})

test("computeEndpoints emits the lever profile's three contrasts in the pre-registered order", () => {
  const rows = [endpointRow("OFF", 40, 1, 1), endpointRow("ON-FULL", 60, 1, 2), endpointRow("LEVER", 44, 1, 3)]
  const { summaries, contrasts } = computeEndpoints(rows, LEVER1_PROFILE)
  assert.deepEqual(summaries.map((summary) => summary.arm), ["OFF", "ON-FULL", "LEVER"])
  assert.deepEqual(
    contrasts.map((contrast) => [contrast.firstArm, contrast.secondArm]),
    [
      ["LEVER", "OFF"],
      ["LEVER", "ON-FULL"],
      ["ON-FULL", "OFF"],
    ],
  )
  assert.ok(Math.abs(contrasts[0]!.creditsPerTurnDelta! - 4) < 1e-9)
  assert.ok(Math.abs(contrasts[1]!.creditsPerTurnDelta! + 16) < 1e-9)
  assert.ok(Math.abs(contrasts[2]!.creditsPerTurnDelta! - 20) < 1e-9)
})

const costedTurn = (minute: number, inputTokens: number, cacheReadTokens: number): TurnRow => ({ ...turn(minute), inputTokens, cacheReadTokens })

const analysisRow = (arm: Arm, blockNumber: number, turns: readonly TurnRow[]): CensusRow & { credits: number } => ({
  ...endpointRow(arm, 0, turns.length, blockNumber),
  turns: [...turns],
})

const metricsEventAt = (minute: number, evictedThisRun: boolean) => ({
  timestamp: at(minute),
  timestampMs: Date.parse(at(minute)),
  sessionId: "s",
  generation: 1 as const,
  evictedThisRun,
})

test("the per-turn primary averages promoted per-turn credits at position 21+ and contrasts with delta and ratio", () => {
  const offTurns = Array.from({ length: 25 }, (_, index) => costedTurn(index + 1, 100000, 0))
  const leverTurns = [...Array.from({ length: 20 }, (_, index) => costedTurn(index + 1, 100000, 0)), costedTurn(21, 200000, 0)]
  const rows = [analysisRow("OFF", 1, offTurns), analysisRow("LEVER", 3, leverTurns)]
  const { byArm, contrasts } = computeTurnPrimary(rows, LEVER1_PROFILE)
  assert.deepEqual(byArm.map((entry) => entry.arm), ["OFF", "ON-FULL", "LEVER"])
  const off = byArm[0]!
  const onFull = byArm[1]!
  const lever = byArm[2]!
  assert.equal(off.turns, 5, "only the positions 21+ turns enter the primary")
  assert.ok(Math.abs(off.creditsPerTurnMean! - 41.35) < 1e-9)
  assert.equal(onFull.turns, 0)
  assert.equal(onFull.creditsPerTurnMean, null)
  assert.equal(lever.turns, 1)
  assert.ok(Math.abs(lever.creditsPerTurnMean! - 75.85) < 1e-9)
  assert.deepEqual(contrasts.map((contrast) => [contrast.firstArm, contrast.secondArm]), [
    ["LEVER", "OFF"],
    ["LEVER", "ON-FULL"],
    ["ON-FULL", "OFF"],
  ])
  assert.ok(Math.abs(contrasts[0]!.creditsPerTurnDelta! - 34.5) < 1e-9)
  assert.ok(Math.abs(contrasts[0]!.creditsPerTurnRatio! - 1.834341) < 1e-5, "the ratio is the frozen rule's judged quantity")
  assert.equal(contrasts[1]!.creditsPerTurnDelta, null)
  assert.equal(contrasts[1]!.creditsPerTurnRatio, null)
  assert.equal(contrasts[2]!.creditsPerTurnDelta, null)
})

test("the per-turn primary buckets turns by per-session position, not the arm-concatenated index", () => {
  const firstRun = Array.from({ length: 25 }, (_, index) => costedTurn(index + 1, 100000, 0))
  const secondRun = [
    ...Array.from({ length: 20 }, (_, index) => costedTurn(index + 1, 10000, 0)),
    ...Array.from({ length: 5 }, (_, index) => costedTurn(index + 21, 300000, 0)),
  ]
  const rows = [analysisRow("LEVER", 3, firstRun), analysisRow("LEVER", 6, secondRun)]
  const { byArm } = computeTurnPrimary(rows, LEVER1_PROFILE)
  const lever = byArm.find((entry) => entry.arm === "LEVER")!
  assert.equal(lever.turns, 10, "each run contributes its own turns at per-session position 21+")
  assert.ok(Math.abs(lever.creditsPerTurnMean! - 75.85) < 1e-9, "the concatenated convention would drag the second run's early turns into the primary")
})

test("the depth-bucket table aggregates input, cache.read, share, and per-turn credits by turn position", () => {
  const turns = [
    ...Array.from({ length: 5 }, (_, index) => costedTurn(index + 1, 100000, 400000)),
    ...Array.from({ length: 15 }, (_, index) => costedTurn(index + 6, 50000, 150000)),
    ...Array.from({ length: 2 }, (_, index) => costedTurn(index + 21, 200000, 0)),
  ]
  const table = computeDepthBucketTable([analysisRow("LEVER", 3, turns)], LEVER1_PROFILE)
  assert.equal(table.length, 12, "three lever arms crossed with four buckets")
  assert.deepEqual(table.map((row) => row.arm), [...Array.from({ length: 4 }, () => "OFF"), ...Array.from({ length: 4 }, () => "ON-FULL"), ...Array.from({ length: 4 }, () => "LEVER")])
  const leverRows = table.filter((row) => row.arm === "LEVER")
  assert.deepEqual(leverRows.map((row) => row.bucket), ["1-5", "6-20", "21-50", "51+"])
  const early = leverRows[0]!
  assert.equal(early.turns, 5)
  assert.ok(Math.abs(early.inputTokensMean! - 100000) < 1e-9)
  assert.ok(Math.abs(early.cacheReadTokensMean! - 400000) < 1e-9)
  assert.ok(Math.abs(early.cacheShare! - 0.8) < 1e-9, "the share is pooled cache.read over input-side tokens")
  assert.ok(Math.abs(early.creditsPerTurnMean! - 41.35) < 1e-9)
  const mid = leverRows[1]!
  assert.equal(mid.turns, 15)
  assert.ok(Math.abs(mid.cacheShare! - 0.75) < 1e-9)
  assert.ok(Math.abs(mid.creditsPerTurnMean! - 24.1) < 1e-9)
  const deepBucket = leverRows[2]!
  assert.equal(deepBucket.turns, 2)
  assert.ok(Math.abs(deepBucket.cacheShare! - 0) < 1e-9)
  assert.ok(Math.abs(deepBucket.creditsPerTurnMean! - 75.85) < 1e-9)
  const empty = leverRows[3]!
  assert.equal(empty.turns, 0)
  assert.equal(empty.inputTokensMean, null)
  assert.equal(empty.cacheShare, null)
  assert.equal(empty.creditsPerTurnMean, null)
  for (const row of table.filter((entry) => entry.arm !== "LEVER")) {
    assert.equal(row.turns, 0)
    assert.equal(row.creditsPerTurnMean, null)
  }
})

test("the depth-bucket table buckets turns by per-session position, not the arm-concatenated index", () => {
  const firstRun = [...Array.from({ length: 5 }, (_, index) => costedTurn(index + 1, 100000, 0)), costedTurn(6, 200000, 0)]
  const secondRun = [costedTurn(1, 40000, 0), costedTurn(2, 40000, 0)]
  const table = computeDepthBucketTable([analysisRow("LEVER", 3, firstRun), analysisRow("LEVER", 6, secondRun)], LEVER1_PROFILE)
  const leverRows = table.filter((row) => row.arm === "LEVER")
  const early = leverRows[0]!
  assert.equal(early.turns, 7, "the second run's turns 1-2 join the first run's positions 1-5 in the early bucket")
  assert.ok(Math.abs(early.inputTokensMean! - 580000 / 7) < 1e-9)
  const mid = leverRows[1]!
  assert.equal(mid.turns, 1, "only the first run's own turn 6 sits at per-session position 6")
  assert.ok(Math.abs(mid.inputTokensMean! - 200000) < 1e-9)
})

test("the eviction-aligned view splits turns 2+ by an eviction in the prior inter-turn gap", () => {
  const turns = [costedTurn(10, 10000, 90000), costedTurn(20, 40000, 60000), costedTurn(30, 100000, 20000), costedTurn(40, 200000, 0)]
  const row: CensusRow = {
    ...endpointRow("LEVER", 0, turns.length, 3),
    turns,
    metricsEvents: [
      metricsEventAt(15, true),
      metricsEventAt(29, true),
      metricsEventAt(35, false),
      metricsEventAt(45, true),
      metricsEventAt(5, true),
    ],
  }
  const view = computeEvictionAlignedView([row], ["LEVER"])
  assert.equal(view.length, 1)
  const lever = view[0]!
  assert.equal(lever.postEviction.turns, 2, "the turns at 15 and the gap boundary 29 are post-eviction")
  assert.ok(Math.abs(lever.postEviction.inputMean! - 70000) < 1e-9)
  assert.ok(Math.abs(lever.postEviction.cacheReadMean! - 40000) < 1e-9)
  assert.ok(Math.abs(lever.postEviction.cacheShare! - 80000 / 220000) < 1e-9)
  assert.equal(lever.evictionClean.turns, 1, "the quiet gap leaves the turn eviction-clean; turn 1 and the stray evictions enter nothing")
  assert.ok(Math.abs(lever.evictionClean.inputMean! - 200000) < 1e-9)
  assert.ok(Math.abs(lever.evictionClean.cacheShare! - 0) < 1e-9)
  assert.deepEqual(fullModeArms(LEVER1_PROFILE), ["ON-FULL", "LEVER"])
  assert.deepEqual(fullModeArms(DEEP_PROFILE), ["ON-FULL"], "the dry arm is not a full-mode arm")
})

test("the event-aligned view splits turns 2+ by any metrics event in the prior inter-turn gap", () => {
  const turns = [costedTurn(10, 10000, 0), costedTurn(20, 20000, 0), costedTurn(30, 30000, 0), costedTurn(40, 40000, 0)]
  const row: CensusRow = {
    ...endpointRow("LEVER", 0, turns.length, 3),
    turns,
    metricsEvents: [metricsEventAt(15, true), metricsEventAt(25, false)],
  }
  const view = computeEvictionAlignedView([row], ["LEVER"])
  const lever = view[0]!
  assert.equal(lever.postEvent.turns, 2, "an eviction-bearing and a quiet metrics line both count as event gaps")
  assert.ok(Math.abs(lever.postEvent.inputMean! - 25000) < 1e-9)
  assert.equal(lever.eventClean.turns, 1, "the gap after the last event leaves the final turn event-clean")
  assert.ok(Math.abs(lever.eventClean.inputMean! - 40000) < 1e-9)
  assert.equal(lever.postEviction.turns, 1, "only the eviction-bearing gap is post-eviction")
  assert.ok(Math.abs(lever.postEviction.inputMean! - 20000) < 1e-9)
  assert.equal(lever.evictionClean.turns, 2, "the eviction-specific case survives alongside the any-event split")
  assert.ok(Math.abs(lever.evictionClean.inputMean! - 35000) < 1e-9)
})

test("decideNextBlock walks the lever schedule and refuses broken lever histories", () => {
  const afterThree = decideNextBlock(readDeepEra(flipLogText(LEVER_SCHEDULE.slice(0, 3)), LEVER1_PROFILE), false, false, LEVER1_PROFILE)
  assert.deepEqual(afterThree, { kind: "run", blockLabel: "4", arm: "LEVER" })
  const broken = decideNextBlock(readDeepEra(flipLogText(["OFF", "OFF"]), LEVER1_PROFILE), false, false, LEVER1_PROFILE)
  assert.equal(broken.kind === "refuse" ? broken.rc : -1, 11)
  assert.match(broken.kind === "refuse" ? broken.reason : "", /position 2 carries arm OFF, expected ON-FULL/)
  const full = decideNextBlock(readDeepEra(flipLogText(LEVER_SCHEDULE), LEVER1_PROFILE), false, false, LEVER1_PROFILE)
  assert.equal(full.kind, "completion-withheld")
})

test("resolveCliConfig selects the experiment profile from AB_EXPERIMENT and main refuses unknown values", async () => {
  assert.equal(EXPERIMENT_PROFILE_ENV, "AB_EXPERIMENT")
  assert.equal(resolveCliConfig([], { AB_EXPERIMENT: "lever1" }).profile, LEVER1_PROFILE)
  assert.equal(resolveCliConfig([], { AB_EXPERIMENT: "deep" }).profile, DEEP_PROFILE)
  assert.equal(resolveCliConfig([], {}).profile, DEEP_PROFILE)
  const temp = tempDir("ab-lever-env-")
  try {
    const exitCode = await runCli(["not-a-subcommand"], { AB_HOME: join(temp, "home"), AB_EXPERIMENT: "bogus" })
    assert.equal(exitCode, 1, "an unknown profile selection refuses with exit 1")
    assert.match(readFileSync(join(temp, "home", BLOCK_LOG_BASENAME), "utf8"), /invalid AB_EXPERIMENT: bogus/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("the refusal paths strip control characters from the echoed values", async () => {
  const ceilingTemp = tempDir("ab-lever-echo-ceiling-")
  const profileTemp = tempDir("ab-lever-echo-profile-")
  try {
    const ceilingExit = await runCli(["not-a-subcommand"], { AB_HOME: join(ceilingTemp, "home"), AB_CREDIT_CEILING: "bad\u0007value\nnext line" })
    assert.equal(ceilingExit, 1)
    const ceilingLog = readFileSync(join(ceilingTemp, "home", BLOCK_LOG_BASENAME), "utf8")
    assert.match(ceilingLog, /invalid AB_CREDIT_CEILING: badvaluenext line/)
    assert.equal(ceilingLog.includes("\u0007"), false)
    assert.equal(ceilingLog.split("\n").some((line) => line.includes("next line") && !line.includes("invalid")), false, "the injected newline must not open a forged log line")

    const profileExit = await runCli(["not-a-subcommand"], { AB_HOME: join(profileTemp, "home"), AB_EXPERIMENT: "bogus\u001b[31m" })
    assert.equal(profileExit, 1)
    const profileLog = readFileSync(join(profileTemp, "home", BLOCK_LOG_BASENAME), "utf8")
    assert.match(profileLog, /invalid AB_EXPERIMENT: bogus\[31m/)
    assert.equal(profileLog.includes("\u001b"), false)
  } finally {
    rmSync(ceilingTemp, { recursive: true, force: true })
    rmSync(profileTemp, { recursive: true, force: true })
  }
})

test("flipArmAndAssert asserts the lever seed under the lever profile and refuses the missing cacheAwareHints key", () => {
  const ok = tempDir("ab-lever-flip-ok-")
  const bad = tempDir("ab-lever-flip-bad-")
  try {
    assert.equal(FLIP_ARG_BY_ARM["LEVER"], "lever")
    for (const arm of ["OFF", "ON-FULL", "ON-DRY", "LEVER", CALIBRATION_ARM] as const) {
      assert.equal(ARM_BY_FLIP_ARG[FLIP_ARG_BY_ARM[arm]], arm, `the flip argument of ${arm} resolves back to it`)
    }
    withFakeEnv({ ABX_CONFIG: join(ok, "config.json"), ABX_FLIP_LOG: join(ok, FLIP_LOG_BASENAME) }, () => {
      const output = flipArmAndAssert(cliConfigFor(ok, { flipCmd: writeFakeFlip(ok, "correct"), profile: LEVER1_PROFILE }), "LEVER")
      assert.match(output ?? "", /flipped to lever/)
      assert.match(readFileSync(join(ok, BLOCK_LOG_BASENAME), "utf8"), /arm-assert: OK \(LEVER\)/)
      assert.match(readFileSync(join(ok, FLIP_LOG_BASENAME), "utf8"), / LEVER\n$/)
    })
    withFakeEnv({ ABX_CONFIG: join(bad, "config.json"), ABX_FLIP_LOG: join(bad, FLIP_LOG_BASENAME) }, () => {
      const output = flipArmAndAssert(cliConfigFor(bad, { flipCmd: writeFakeFlip(bad, "wrong-bool"), profile: LEVER1_PROFILE }), "LEVER")
      assert.equal(output, null, "the no-hints seed must fail the LEVER arm assertion")
      assert.match(readFileSync(join(bad, BLOCK_LOG_BASENAME), "utf8"), /arm-assert: FAILED \(live config does not match arm LEVER/)
    })
  } finally {
    rmSync(ok, { recursive: true, force: true })
    rmSync(bad, { recursive: true, force: true })
  }
})

test("the self flip applies the profile seed atomically and logs the flip line", () => {
  const temp = tempDir("ab-self-flip-")
  try {
    const configPath = join(temp, "config.json")
    writeFileSync(configPath, `${JSON.stringify({ model: "test-model", plugin: [] as unknown[] })}\n`)
    const config = cliConfigFor(temp, { configPath, profile: LEVER1_PROFILE, flipCmd: SELF_FLIP_COMMAND })
    // A real lever campaign's flip log anchors its era at the calibration
    // line; the self flip appends data flips after it.
    appendFileSync(join(temp, FLIP_LOG_BASENAME), `${formatFlipLine(new Date(Date.parse(T0)).toISOString(), CALIBRATION_ARM)}\n`)
    const output = flipArmAndAssert(config, "LEVER")
    assert.match(output ?? "", /flipped to lever \(self\)/)
    const blockLog = readFileSync(join(temp, BLOCK_LOG_BASENAME), "utf8")
    assert.match(blockLog, /flip: flipped to lever \(self\)/)
    assert.match(blockLog, /arm-assert: OK \(LEVER\)/)
    const seeded = JSON.parse(readFileSync(configPath, "utf8"))
    assert.equal(seeded.model, "test-model", "every non-plugin config key survives the self flip")
    assert.deepEqual(seeded.plugin, LEVER_ARM_PLUGIN_ENTRY)
    assert.equal(existsSync(`${configPath}.self-flip-staged`), false, "the staged write must be renamed into place")
    assert.match(readFileSync(join(temp, FLIP_LOG_BASENAME), "utf8"), / LEVER\n$/)
    assert.equal(eraDataCount(readDeepEra(readFileSync(join(temp, FLIP_LOG_BASENAME), "utf8"), LEVER1_PROFILE)), 1, "the self flip logs an era flip the decision reader consumes")
    const dry = flipArmAndAssert(config, "ON-DRY")
    assert.equal(dry, null, "an arm outside the profile refuses")
    assert.match(readFileSync(join(temp, BLOCK_LOG_BASENAME), "utf8"), /self-flip: FAILED \(arm ON-DRY carries no plugin seed in the lever1 profile\)/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("a failed self flip removes its staged file and labels the failure", () => {
  const temp = tempDir("ab-self-flip-litter-")
  try {
    const configPath = join(temp, "config.json")
    writeFileSync(configPath, `${JSON.stringify({ model: "m", plugin: [] as unknown[] })}\n`)
    const stagedPath = `${configPath}.self-flip-staged`
    writeFileSync(stagedPath, "stale staged content")
    chmodSync(stagedPath, 0o444)
    const config = cliConfigFor(temp, { configPath, profile: LEVER1_PROFILE, flipCmd: SELF_FLIP_COMMAND })
    assert.equal(flipArmAndAssert(config, "LEVER"), null, "the unwritable staged file fails the flip")
    assert.equal(existsSync(stagedPath), false, "the failed flip must not leave the staged file beside the live config")
    const blockLog = readFileSync(join(temp, BLOCK_LOG_BASENAME), "utf8")
    assert.match(blockLog, /self-flip: FAILED \(cannot write the flip:/)
    assert.equal(JSON.parse(readFileSync(configPath, "utf8")).model, "m", "the live config is untouched by the failed flip")
    assert.equal(flipFailureStatus(SELF_FLIP_COMMAND), "self-flip-failed")
    assert.equal(flipFailureStatus("/usr/local/bin/opencode-ab"), "arm-assert-failed")
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("the lever profile defaults the flip command to the self flip", () => {
  assert.equal(resolveCliConfig([], { AB_EXPERIMENT: "lever1" }).flipCmd, SELF_FLIP_COMMAND)
  assert.equal(resolveCliConfig([], { AB_EXPERIMENT: "lever1", AB_FLIP_CMD: "/bin/true" }).flipCmd, "/bin/true")
  assert.notEqual(resolveCliConfig([], {}).flipCmd, SELF_FLIP_COMMAND, "the frozen deep default keeps the legacy flip path")
})

// ---------------------------------------------------------------------------
// Lever-3 experiment profile (LRU-85-7).
// ---------------------------------------------------------------------------

test("the lever3 profile's LEVER seed carries the cumulative cache-aware stack byte-exactly", () => {
  assert.equal(
    JSON.stringify(LEVER3_ARM_PLUGIN_ENTRY),
    '[["./opencode-context-manager/plugin/context-manager.ts",{"manualMode":false,"watermarkTokens":12000,"agedReadEvictionMessages":30,"reasoningRetentionMessages":16,"cacheAwareHints":true,"mutationBatchCadence":3}]]',
    "the lever3 LEVER seed must stay byte-identical",
  )
  assert.deepEqual(LEVER3_ARM_PLUGIN_ENTRY[0]![1], {
    manualMode: false,
    watermarkTokens: 12000,
    agedReadEvictionMessages: 30,
    reasoningRetentionMessages: 16,
    cacheAwareHints: true,
    mutationBatchCadence: 3,
  })
  assert.equal(LEVER3_ARM_PLUGIN_ENTRY[0]![0], LEVER_ARM_PLUGIN_ENTRY[0]![0], "every lever seed points at the same plugin path")
  const lever3OnFull = LEVER3_PROFILE.pluginSeedByArm["ON-FULL"]!
  assert.deepEqual(lever3OnFull, LEVER_ON_FULL_PLUGIN_ENTRY, "the lever3 ON-FULL seed is the shared 12k geometry")
  assert.equal("cacheAwareHints" in lever3OnFull[0]![1], false, "the profile's ON-FULL seed carries no lever keys")
  assert.equal(LEVER3_PROFILE.pluginSeedByArm["CAL-ON-FULL"], LEVER3_PROFILE.pluginSeedByArm["ON-FULL"], "the calibration token maps to the profile's ON-FULL seed")
  assert.notEqual(LEVER3_PROFILE.pluginSeedByArm["LEVER"], LEVER1_PROFILE.pluginSeedByArm["LEVER"], "the lever profiles' LEVER seeds are distinct records")
  assert.deepEqual(LEVER3_PROFILE.dataArms, LEVER1_PROFILE.dataArms)
  assert.deepEqual(LEVER3_PROFILE.contrasts, LEVER1_PROFILE.contrasts)
  assert.equal(LEVER3_PROFILE.corroboratesFullModeMetrics, true)
  assert.equal(LEVER3_PROFILE.defaultsToSelfFlip, true)
})

test("configMatchesArm separates the lever profiles' series at the seed-assertion layer in both directions", () => {
  assert.equal(configMatchesArm({ plugin: LEVER3_ARM_PLUGIN_ENTRY }, "LEVER", LEVER3_PROFILE), true)
  assert.equal(configMatchesArm({ plugin: LEVER3_ARM_PLUGIN_ENTRY }, "LEVER", LEVER1_PROFILE), false, "the extra mutationBatchCadence key must fail the lever1 LEVER assertion")
  assert.equal(configMatchesArm({ plugin: LEVER_ARM_PLUGIN_ENTRY }, "LEVER", LEVER3_PROFILE), false, "the missing mutationBatchCadence key must fail the lever3 LEVER assertion")
  assert.equal(configMatchesArm({ plugin: LEVER3_ARM_PLUGIN_ENTRY }, "ON-FULL", LEVER3_PROFILE), false)
  assert.equal(configMatchesArm({ plugin: LEVER_ON_FULL_PLUGIN_ENTRY }, "ON-FULL", LEVER3_PROFILE), true)
  assert.equal(configMatchesArm({ plugin: LEVER_ON_FULL_PLUGIN_ENTRY }, CALIBRATION_ARM, LEVER3_PROFILE), true, "the calibration token maps to the profile's ON-FULL seed")
  assert.equal(configMatchesArm({ plugin: [] }, "OFF", LEVER3_PROFILE), true)
  assert.equal(configMatchesArm({ plugin: LEVER3_ARM_PLUGIN_ENTRY }, "OFF", LEVER3_PROFILE), false)
  assert.equal(configMatchesArm({ plugin: ON_PLUGIN_ENTRY }, "ON-FULL", LEVER3_PROFILE), false, "the frozen 250k seed is not a lever-profile seed")
  assert.equal(configMatchesArm(null, "LEVER", LEVER3_PROFILE), false)
})

test("applyArmToConfig applies the lever3 profile's seeds and refuses arms outside the profile", () => {
  const flipped = applyArmToConfig({ model: "test-model", theme: "dark", plugin: [] as unknown[] }, "LEVER", LEVER3_PROFILE) as { model: string; theme: string; plugin: unknown }
  assert.equal(flipped.model, "test-model")
  assert.equal(flipped.theme, "dark")
  assert.deepEqual(flipped.plugin, LEVER3_ARM_PLUGIN_ENTRY)
  const onFull = applyArmToConfig({ plugin: [] }, "ON-FULL", LEVER3_PROFILE) as { plugin: unknown }
  assert.deepEqual(onFull.plugin, LEVER_ON_FULL_PLUGIN_ENTRY)
  const off = applyArmToConfig({ plugin: LEVER3_ARM_PLUGIN_ENTRY }, "OFF", LEVER3_PROFILE) as { plugin: unknown }
  assert.deepEqual(off.plugin, [])
  assert.throws(() => applyArmToConfig({ plugin: [] }, "ON-DRY", LEVER3_PROFILE), /no plugin seed in the lever3 profile/)
})

test("the lever3 profile rides the identical mirrored 18-block schedule as lever1", () => {
  const lever3Schedule = Array.from({ length: TOTAL_DATA_BLOCKS }, (_, index) => armForDataBlock(index + 1, LEVER3_PROFILE))
  assert.deepEqual(lever3Schedule, [...LEVER_SCHEDULE])
  assert.deepEqual(Array.from({ length: TOTAL_DATA_BLOCKS }, (_, index) => armForDataBlock(index + 1, LEVER1_PROFILE)), lever3Schedule, "the lever profiles ride one shared schedule")
  for (const arm of new Set<string>(LEVER_SCHEDULE)) {
    const indices = lever3Schedule.map((scheduleArm, index) => (scheduleArm === arm ? index + 1 : 0)).filter((index) => index > 0)
    assert.equal(indices.length, 6, `arm ${arm} holds six runs`)
    const mean = indices.reduce((sum, index) => sum + index, 0) / indices.length
    assert.equal(mean, 9.5, `arm ${arm} mean run index`)
  }
})

test("readDeepEra separates the lever3 series from the frozen era in both directions", () => {
  const lever3Era = readDeepEra(flipLogText(LEVER_SCHEDULE), LEVER3_PROFILE)
  assert.equal(eraDataCount(lever3Era), 18)
  assert.equal(validateDeepRotation(lever3Era, LEVER3_PROFILE), null)
  const frozenReaderOnLever3Log = readDeepEra(flipLogText(LEVER_SCHEDULE))
  assert.equal(validateDeepRotation(frozenReaderOnLever3Log) === null, false, "the frozen reader must refuse a lever3 history")
  const lever3ReaderOnFrozenLog = readDeepEra(flipLogText(SCHEDULE), LEVER3_PROFILE)
  assert.equal(validateDeepRotation(lever3ReaderOnFrozenLog, LEVER3_PROFILE) === null, false, "the lever3 reader must refuse a frozen deep history")
})

test("resolveCliConfig selects lever3 with the self-flip default and the archived lever2 name is not a profile", () => {
  const config = resolveCliConfig([], { AB_EXPERIMENT: "lever3" })
  assert.equal(config.profile, LEVER3_PROFILE)
  assert.equal(config.flipCmd, SELF_FLIP_COMMAND, "a lever profile defaults to the self flip")
  assert.equal(resolveCliConfig([], { AB_EXPERIMENT: "lever3", AB_FLIP_CMD: "/bin/true" }).flipCmd, "/bin/true")
  assert.equal(isExperimentProfileName("lever3"), true)
  assert.equal(isExperimentProfileName("lever2"), false, "the reverted lever2 era name must not resolve to a profile")
})

test("main refuses the archived lever2 experiment name", async () => {
  const temp = tempDir("ab-lever3-archived-")
  try {
    const exitCode = await runCli(["not-a-subcommand"], { AB_HOME: join(temp, "home"), AB_EXPERIMENT: "lever2" })
    assert.equal(exitCode, 1, "the archived lever2 name refuses with exit 1")
    assert.match(readFileSync(join(temp, "home", BLOCK_LOG_BASENAME), "utf8"), /invalid AB_EXPERIMENT: lever2/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("the flip subcommand applies the active profile's seed and refuses unknown or out-of-profile arms", async () => {
  const temp = tempDir("ab-flip-cmd-")
  try {
    const configPath = join(temp, "config.json")
    writeFileSync(configPath, `${JSON.stringify({ model: "test-model", plugin: [] as unknown[] })}\n`)
    const env = { AB_HOME: join(temp, "home"), AB_CONFIG: configPath, AB_EXPERIMENT: "lever1", AB_WORK_CMD: "/bin/true", OPENCODE_BIN: "/bin/true" }
    assert.equal(await runCli(["flip", "lever"], env), 0)
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).plugin, LEVER_ARM_PLUGIN_ENTRY)
    assert.match(readFileSync(join(temp, "home", FLIP_LOG_BASENAME), "utf8"), / LEVER\n$/)
    assert.equal(existsSync(`${configPath}.self-flip-staged`), false)
    assert.equal(await runCli(["flip", "on-dry"], env), 1, "ON-DRY has no seed under the lever profile")
    assert.equal(await runCli(["flip", "bogus"], env), 1, "an unknown flip argument refuses")
    assert.equal(await runCli(["flip"], env), 1, "a missing flip argument refuses")
    // AB_FLIP_CMD is pinned so the tools gate never depends on a
    // host-installed legacy flip tool (the CI runner has none); the flip
    // subcommand calls the self flip regardless of the flip command.
    const deepEnv = { ...env, AB_EXPERIMENT: undefined, AB_FLIP_CMD: "/bin/true" }
    assert.equal(await runCli(["flip", "lever"], deepEnv), 1, "the deep profile has no LEVER arm")
    assert.match(readFileSync(join(temp, "home", BLOCK_LOG_BASENAME), "utf8"), /self-flip: FAILED \(arm LEVER carries no plugin seed in the deep profile\)/)
    assert.equal(await runCli(["flip", "on-full"], deepEnv), 0, "a deep arm flips through the self flip with the deep seed")
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).plugin, ON_PLUGIN_ENTRY)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("the lever readout emits the three contrasts and reports corroboration failures as caveats", () => {
  const temp = tempDir("ab-lever-readout-")
  try {
    const dbPath = join(temp, "opencode.db")
    const blocks = [
      { label: "1", arm: "OFF", sessionId: "ses_off", minute: 15 },
      { label: "2", arm: "ON-FULL", sessionId: "ses_full", minute: 25 },
      { label: "3", arm: "LEVER", sessionId: "ses_lever", minute: 35 },
    ]
    buildOpencodeDb(
      dbPath,
      blocks.map((block) => ({ sessionId: block.sessionId, minute: block.minute + 1, modelId: "glm-5.3", input: 100000, output: 10000, cacheWrite: 5000 })),
    )
    writeFileSync(join(temp, FLIP_LOG_BASENAME), flipLogText(blocks.map((block) => block.arm)))
    writeFileSync(
      join(temp, SPAWN_LOG_BASENAME),
      spawnLogText(blocks.map((block) => ({ label: block.label, arm: block.arm, sessionId: block.sessionId, exit: 0, minute: block.minute }))),
    )
    writeFileSync(
      join(temp, WORK_LOG_DEEP_BASENAME),
      workLogText(blocks.map((block) => ({ label: block.label, passed: 57, failed: 0, minute: block.minute + 1 }))),
    )
    const config = cliConfigFor(temp, { dbPath, profile: LEVER1_PROFILE })
    const healthyMetrics = metricsLogText([
      { minute: 26, sessionId: "ses_full", generation: 1, evictions: 1 },
      { minute: 36, sessionId: "ses_lever", generation: 2, evictions: 1 },
    ])
    writeFileSync(join(temp, METRICS_LOG_BASENAME), healthyMetrics)
    const healthy = readFileSync(runReadout(config), "utf8")
    assert.match(healthy, /\| 3 \| LEVER \|/)
    assert.match(healthy, /- contrast LEVER - OFF: creditsPerTurn delta=/)
    assert.match(healthy, /- contrast LEVER - ON-FULL: creditsPerTurn delta=/)
    assert.match(healthy, /- contrast ON-FULL - OFF: creditsPerTurn delta=/)
    assert.match(healthy, /### per-turn primary \(credits per turn, turns 21\+\)/)
    assert.match(healthy, /- primary contrast LEVER\/OFF: creditsPerTurn delta=n\/a ratio=n\/a/)
    assert.match(healthy, /\| arm \| bucket \| turns \| input\/turn \| cache.read\/turn \| cache share \| credits\/turn \|/)
    assert.match(healthy, /\| LEVER \| 1-5 \| 1 \| 100000 \| 0 \| 0\.0% \| 41\.35 \|/)
    assert.match(healthy, /\| LEVER \| post-event \| 0 \| n\/a \| n\/a \| n\/a \|/)
    assert.match(healthy, /\| ON-FULL \| event-clean \| 0 \| n\/a \| n\/a \| n\/a \|/)
    assert.match(healthy, /\| LEVER \| post-eviction \| 0 \| n\/a \| n\/a \| n\/a \|/)
    assert.match(healthy, /### event-aligned view \(turns 2\+, full-mode arms\)/)
    assert.equal(healthy.includes("corroboration"), false, "a corroborating series carries no corroboration caveat")
    writeFileSync(
      join(temp, METRICS_LOG_BASENAME),
      metricsLogText([
        { minute: 16, sessionId: "ses_off", generation: 1, evictions: 1 },
        { minute: 26, sessionId: "ses_full", generation: 1, evictions: 1 },
        { minute: 36, sessionId: "ses_lever", generation: 2, evictions: 1 },
      ]),
    )
    runReadout(config)
    assert.match(readFileSync(join(temp, "abx-readout.md"), "utf8"), /caveat: full-mode metrics corroboration failed for blocks: 1/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("excluded census rows keep their table row but never enter the endpoint population", () => {
  const temp = tempDir("ab-lever-gate-")
  try {
    const dbPath = join(temp, "opencode.db")
    buildOpencodeDb(dbPath, [
      { sessionId: "ses_off", minute: 16, modelId: "glm-5.3", input: 100000, output: 10000, cacheWrite: 5000 },
      { sessionId: "ses_full", minute: 26, modelId: "glm-5.3", input: 100000, output: 10000, cacheWrite: 5000 },
      ...Array.from({ length: 25 }, (_, index) => ({
        sessionId: "ses_lever",
        minute: 36 + index,
        modelId: "glm-5.3",
        input: 100000,
        output: 10000,
        cacheWrite: 5000,
      })),
    ])
    writeFileSync(join(temp, FLIP_LOG_BASENAME), flipLogText(["OFF", "ON-FULL", "LEVER"]))
    writeFileSync(
      join(temp, SPAWN_LOG_BASENAME),
      spawnLogText([
        { label: "1", arm: "OFF", sessionId: "ses_off", exit: 0, minute: 15 },
        { label: "2", arm: "ON-FULL", sessionId: "ses_full", exit: 0, minute: 25 },
        { label: "3", arm: "LEVER", sessionId: "ses_lever", exit: 0, minute: 35 },
      ]),
    )
    // Block 3's verify is red: the census classifies it incomplete-run and
    // its 25 turns (5 of them at position 21+) must not reach any endpoint.
    writeFileSync(
      join(temp, WORK_LOG_DEEP_BASENAME),
      workLogText([
        { label: "1", passed: 57, failed: 0, minute: 16 },
        { label: "2", passed: 57, failed: 0, minute: 26 },
        { label: "3", passed: 0, failed: 57, minute: 36 },
      ]),
    )
    writeFileSync(
      join(temp, METRICS_LOG_BASENAME),
      metricsLogText([
        { minute: 26, sessionId: "ses_full", generation: 1, evictions: 1 },
        { minute: 40, sessionId: "ses_lever", generation: 2, evictions: 1 },
      ]),
    )
    const content = readFileSync(runReadout(cliConfigFor(temp, { dbPath, profile: LEVER1_PROFILE })), "utf8")
    assert.match(content, /\| 3 \| LEVER \| 25 \| \d+\.\d{4} \| 0\/1 \| incomplete-run \|/, "the excluded block keeps its census table row with its credits")
    assert.match(content, /- LEVER: n=0 creditsPerTurn mean=n\/a/, "the red block is out of the arm summaries")
    assert.match(content, /- contrast LEVER - OFF: creditsPerTurn delta=n\/a/)
    assert.match(content, /- primary LEVER: turns=0 creditsPerTurn mean=n\/a/, "the red block's 21+ turns are out of the per-turn primary")
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Lever-4 experiment profile (LRU-85-7 pattern, lever-4 dispatch).
// ---------------------------------------------------------------------------

test("the lever4 profile's seeds carry the cumulative stack plus the eviction multiplier byte-exactly", () => {
  assert.equal(
    JSON.stringify(LEVER4_ARM_PLUGIN_ENTRY),
    '[["./opencode-context-manager/plugin/context-manager.ts",{"manualMode":false,"watermarkTokens":12000,"agedReadEvictionMessages":30,"reasoningRetentionMessages":16,"cacheAwareHints":true,"mutationBatchCadence":3,"evictionBatchMultiplier":2,"metricsMinLineIntervalMs":0}]]',
    "the lever4 LEVER seed must stay byte-identical",
  )
  assert.deepEqual(LEVER4_ARM_PLUGIN_ENTRY[0]![1], {
    manualMode: false,
    watermarkTokens: 12000,
    agedReadEvictionMessages: 30,
    reasoningRetentionMessages: 16,
    cacheAwareHints: true,
    mutationBatchCadence: 3,
    evictionBatchMultiplier: 2,
    metricsMinLineIntervalMs: 0,
  })
  assert.equal(LEVER4_ARM_PLUGIN_ENTRY[0]![0], LEVER_ARM_PLUGIN_ENTRY[0]![0], "every lever seed points at the same plugin path")
  const lever4OnFull = LEVER4_PROFILE.pluginSeedByArm["ON-FULL"]!
  assert.equal(
    JSON.stringify(lever4OnFull),
    '[["./opencode-context-manager/plugin/context-manager.ts",{"manualMode":false,"watermarkTokens":12000,"agedReadEvictionMessages":30,"reasoningRetentionMessages":16,"metricsMinLineIntervalMs":0}]]',
    "the lever4 ON-FULL seed must stay byte-identical",
  )
  assert.equal("cacheAwareHints" in lever4OnFull[0]![1], false, "the profile's ON-FULL seed carries no lever keys")
  assert.equal("mutationBatchCadence" in lever4OnFull[0]![1], false, "the profile's ON-FULL seed carries no lever keys")
  assert.equal("evictionBatchMultiplier" in lever4OnFull[0]![1], false, "the profile's ON-FULL seed carries no lever keys")
  assert.equal(LEVER4_PROFILE.pluginSeedByArm["CAL-ON-FULL"], LEVER4_PROFILE.pluginSeedByArm["ON-FULL"], "the calibration token maps to the profile's ON-FULL seed")
  assert.notEqual(LEVER4_PROFILE.pluginSeedByArm["LEVER"], LEVER3_PROFILE.pluginSeedByArm["LEVER"], "the lever profiles' LEVER seeds are distinct records")
  assert.notEqual(lever4OnFull, LEVER3_PROFILE.pluginSeedByArm["ON-FULL"], "the lever4 ON-FULL seed is its own record: the interval rider separates it from the shared series 1-3 geometry")
  assert.deepEqual(LEVER4_PROFILE.dataArms, LEVER1_PROFILE.dataArms)
  assert.deepEqual(LEVER4_PROFILE.contrasts, LEVER1_PROFILE.contrasts)
  assert.equal(LEVER4_PROFILE.corroboratesFullModeMetrics, true)
  assert.equal(LEVER4_PROFILE.defaultsToSelfFlip, true)
})

test("configMatchesArm separates the lever4 series from the earlier profiles in both directions", () => {
  assert.equal(configMatchesArm({ plugin: LEVER4_ARM_PLUGIN_ENTRY }, "LEVER", LEVER4_PROFILE), true)
  assert.equal(configMatchesArm({ plugin: LEVER4_ARM_PLUGIN_ENTRY }, "LEVER", LEVER1_PROFILE), false, "the extra stack keys must fail the lever1 LEVER assertion")
  assert.equal(configMatchesArm({ plugin: LEVER4_ARM_PLUGIN_ENTRY }, "LEVER", LEVER3_PROFILE), false, "the extra multiplier and interval keys must fail the lever3 LEVER assertion")
  assert.equal(configMatchesArm({ plugin: LEVER3_ARM_PLUGIN_ENTRY }, "LEVER", LEVER4_PROFILE), false, "the missing multiplier and interval keys must fail the lever4 LEVER assertion")
  assert.equal(configMatchesArm({ plugin: LEVER_ARM_PLUGIN_ENTRY }, "LEVER", LEVER4_PROFILE), false, "the series-1 seed is not a lever4 seed")
  const lever4OnFull = LEVER4_PROFILE.pluginSeedByArm["ON-FULL"]!
  assert.equal(configMatchesArm({ plugin: LEVER4_ARM_PLUGIN_ENTRY }, "ON-FULL", LEVER4_PROFILE), false)
  assert.equal(configMatchesArm({ plugin: lever4OnFull }, "ON-FULL", LEVER4_PROFILE), true)
  assert.equal(configMatchesArm({ plugin: lever4OnFull }, "ON-FULL", LEVER1_PROFILE), false, "the interval rider must fail the lever1 ON-FULL assertion")
  assert.equal(configMatchesArm({ plugin: lever4OnFull }, "ON-FULL", LEVER3_PROFILE), false, "the interval rider must fail the lever3 ON-FULL assertion")
  assert.equal(configMatchesArm({ plugin: LEVER_ON_FULL_PLUGIN_ENTRY }, "ON-FULL", LEVER4_PROFILE), false, "the shared series 1-3 ON-FULL seed lacks the interval rider")
  assert.equal(configMatchesArm({ plugin: lever4OnFull }, CALIBRATION_ARM, LEVER4_PROFILE), true, "the calibration token maps to the profile's ON-FULL seed")
  assert.equal(configMatchesArm({ plugin: [] }, "OFF", LEVER4_PROFILE), true)
  assert.equal(configMatchesArm({ plugin: LEVER4_ARM_PLUGIN_ENTRY }, "OFF", LEVER4_PROFILE), false)
  assert.equal(configMatchesArm({ plugin: ON_PLUGIN_ENTRY }, "ON-FULL", LEVER4_PROFILE), false, "the frozen 250k seed is not a lever-profile seed")
  assert.equal(configMatchesArm(null, "LEVER", LEVER4_PROFILE), false)
})

test("applyArmToConfig applies the lever4 profile's seeds and refuses arms outside the profile", () => {
  const flipped = applyArmToConfig({ model: "test-model", theme: "dark", plugin: [] as unknown[] }, "LEVER", LEVER4_PROFILE) as { model: string; theme: string; plugin: unknown }
  assert.equal(flipped.model, "test-model")
  assert.equal(flipped.theme, "dark")
  assert.deepEqual(flipped.plugin, LEVER4_ARM_PLUGIN_ENTRY)
  const onFull = applyArmToConfig({ plugin: [] }, "ON-FULL", LEVER4_PROFILE) as { plugin: unknown }
  assert.deepEqual(onFull.plugin, LEVER4_PROFILE.pluginSeedByArm["ON-FULL"])
  const off = applyArmToConfig({ plugin: LEVER4_ARM_PLUGIN_ENTRY }, "OFF", LEVER4_PROFILE) as { plugin: unknown }
  assert.deepEqual(off.plugin, [])
  assert.throws(() => applyArmToConfig({ plugin: [] }, "ON-DRY", LEVER4_PROFILE), /no plugin seed in the lever4 profile/)
})

test("the lever4 profile rides the identical mirrored 18-block schedule as the other lever profiles", () => {
  const lever4Schedule = Array.from({ length: TOTAL_DATA_BLOCKS }, (_, index) => armForDataBlock(index + 1, LEVER4_PROFILE))
  assert.deepEqual(lever4Schedule, [...LEVER_SCHEDULE])
  assert.deepEqual(Array.from({ length: TOTAL_DATA_BLOCKS }, (_, index) => armForDataBlock(index + 1, LEVER1_PROFILE)), lever4Schedule, "the lever profiles ride one shared schedule")
  for (const arm of new Set<string>(LEVER_SCHEDULE)) {
    const indices = lever4Schedule.map((scheduleArm, index) => (scheduleArm === arm ? index + 1 : 0)).filter((index) => index > 0)
    assert.equal(indices.length, 6, `arm ${arm} holds six runs`)
    const mean = indices.reduce((sum, index) => sum + index, 0) / indices.length
    assert.equal(mean, 9.5, `arm ${arm} mean run index`)
  }
})

test("readDeepEra separates the lever4 series from the frozen era in both directions", () => {
  const lever4Era = readDeepEra(flipLogText(LEVER_SCHEDULE), LEVER4_PROFILE)
  assert.equal(eraDataCount(lever4Era), 18)
  assert.equal(validateDeepRotation(lever4Era, LEVER4_PROFILE), null)
  const frozenReaderOnLever4Log = readDeepEra(flipLogText(LEVER_SCHEDULE))
  assert.equal(validateDeepRotation(frozenReaderOnLever4Log) === null, false, "the frozen reader must refuse a lever4 history")
  const lever4ReaderOnFrozenLog = readDeepEra(flipLogText(SCHEDULE), LEVER4_PROFILE)
  assert.equal(validateDeepRotation(lever4ReaderOnFrozenLog, LEVER4_PROFILE) === null, false, "the lever4 reader must refuse a frozen deep history")
})

test("resolveCliConfig selects lever4 with the self-flip default and the archived lever2 name stays unresolvable", () => {
  const config = resolveCliConfig([], { AB_EXPERIMENT: "lever4" })
  assert.equal(config.profile, LEVER4_PROFILE)
  assert.equal(config.flipCmd, SELF_FLIP_COMMAND, "a lever profile defaults to the self flip")
  assert.equal(resolveCliConfig([], { AB_EXPERIMENT: "lever4", AB_FLIP_CMD: "/bin/true" }).flipCmd, "/bin/true")
  assert.equal(isExperimentProfileName("lever4"), true)
  assert.equal(isExperimentProfileName("lever2"), false, "the reverted lever2 era name must not resolve to a profile")
})

test("the lever4 census join and readout contrasts run the lever series shape end to end", () => {
  const temp = tempDir("ab-lever4-readout-")
  try {
    const dbPath = join(temp, "opencode.db")
    const blocks = [
      { label: "1", arm: "OFF", sessionId: "ses_off", minute: 15 },
      { label: "2", arm: "ON-FULL", sessionId: "ses_full", minute: 25 },
      { label: "3", arm: "LEVER", sessionId: "ses_lever", minute: 35 },
    ]
    buildOpencodeDb(
      dbPath,
      blocks.map((block) => ({ sessionId: block.sessionId, minute: block.minute + 1, modelId: "glm-5.3", input: 100000, output: 10000, cacheWrite: 5000 })),
    )
    writeFileSync(join(temp, FLIP_LOG_BASENAME), flipLogText(blocks.map((block) => block.arm)))
    writeFileSync(
      join(temp, SPAWN_LOG_BASENAME),
      spawnLogText(blocks.map((block) => ({ label: block.label, arm: block.arm, sessionId: block.sessionId, exit: 0, minute: block.minute }))),
    )
    writeFileSync(
      join(temp, WORK_LOG_DEEP_BASENAME),
      workLogText(blocks.map((block) => ({ label: block.label, passed: 57, failed: 0, minute: block.minute + 1 }))),
    )
    writeFileSync(
      join(temp, METRICS_LOG_BASENAME),
      metricsLogText([
        { minute: 26, sessionId: "ses_full", generation: 1, evictions: 1 },
        { minute: 36, sessionId: "ses_lever", generation: 2, evictions: 1 },
      ]),
    )
    const content = readFileSync(runReadout(cliConfigFor(temp, { dbPath, profile: LEVER4_PROFILE })), "utf8")
    assert.match(content, /profile lever4,/, "the readout stamps the lever4 profile")
    assert.match(content, /\| 2 \| ON-FULL \|/, "the census join labels the ON-FULL block by era position")
    assert.match(content, /\| 3 \| LEVER \|/, "the census join labels the LEVER block by era position")
    assert.match(content, /- contrast LEVER - OFF: creditsPerTurn delta=/)
    assert.match(content, /- contrast LEVER - ON-FULL: creditsPerTurn delta=/)
    assert.match(content, /- contrast ON-FULL - OFF: creditsPerTurn delta=/)
    assert.equal(content.includes("caveat: full-mode metrics corroboration failed"), false, "a corroborating lever4 series carries no corroboration caveat")
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
