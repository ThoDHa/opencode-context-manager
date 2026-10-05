import test from "node:test"
import assert from "node:assert/strict"
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, isAbsolute, relative } from "node:path"
import { spawnSync } from "node:child_process"

import {
  applyArmToConfig,
  armForDataBlock,
  BLOCK_LOG_BASENAME,
  CALIBRATION_ARM,
  WORK_LOG_DEEP_BASENAME,
  WORK_LOG_BASENAME,
  configMatchesArm,
  countEraFlips,
  eraDataCount,
  FLIP_ARG_BY_ARM,
  formatFlipLine,
  formatParkLine,
  ON_DRY_PLUGIN_ENTRY,
  ON_PLUGIN_ENTRY,
  readDeepEra,
  TOTAL_DATA_BLOCKS,
  validateDeepRotation,
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
  openTurnDatabase,
  parseMetricsLog,
  parseWorkLog,
  type CensusRow,
  type TurnRow,
  type TurnSource,
} from "../../../experiments/census.ts"
import {
  computeCredits,
  computeEndpoints,
  contrastArms,
  depthBucket,
  formatCredits,
  gatePrimaryEndpoint,
  summarizeArm,
  CreditsError,
} from "../../../experiments/endpoints.ts"
import { renderReadout, writeReadoutFile, type ReadoutInputs } from "../../../experiments/report.ts"
import { checkSpecIntegrity, corpusManifest, resolveExercise, treeManifest } from "../../../experiments/exercise.ts"
import { findRedcheckLeftover, resetTree, suiteFilesOf, verifyTree, writeWorkLogLine, REDCHECK_SCRATCH_PREFIXES, type ExerciseCliOptions } from "../../../experiments/exercise-cli.ts"
import { decideNextBlock, flipArmAndAssert, main as runCli, missingCoverageBlocks, resetExercise, type CliConfig } from "../../../experiments/cli.ts"
import {
  buildOpencodeDb,
  flipLogText,
  metricsLogText,
  runExerciseSuite,
  spawnLogText,
  SCHEDULE,
  T0,
  workLogText,
  at,
  writeFakeFlip,
  writeFakeWork,
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

const endpointRow = (arm: "OFF" | "ON-FULL" | "ON-DRY", credits: number, turnCount: number, blockNumber: number | null): CensusRow & { credits: number } => ({
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
