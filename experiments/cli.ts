#!/usr/bin/env node
/**
 * Operational entry point for the standardized-experiment framework:
 * subcommands `calibrate`, `chain`, `readout`, and the default single-block
 * run. The operational shell is thin on purpose: it derives the next block
 * from the flip log (the pure decision in `decideNextBlock`), flips the arm,
 * asserts the live config, resets the exercise, spawns the solve, gates on
 * quota parks and the credit ceiling, and appends the per-block log. Real
 * spawns, real flips, live DB reads, and cron wiring are operational-only;
 * the hermetic suite proves the deterministic core against doubles.
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import {
  armForDataBlock,
  BLOCK_LOCK_BASENAME,
  BLOCK_LOG_BASENAME,
  CALIBRATION_ARM,
  CALIBRATION_COMPLETE_MARKER,
  CHAIN_COMPLETE_MARKER,
  configMatchesArm,
  countEraFlips,
  eraDataCount,
  FLIP_ARG_BY_ARM,
  FLIP_LOG_BASENAME,
  formatParkLine,
  PARK_REASON_QUOTA,
  readDeepEra,
  RC,
  SPAWN_LOG_BASENAME,
  TOTAL_DATA_BLOCKS,
  validateDeepRotation,
  WORK_LOG_DEEP_BASENAME,
  type BlockLabel,
  type DeepEra,
  type FlipArm,
} from "./arms.ts"
import {
  buildSolveArgv,
  classifySpawnOutcome,
  extractSessionId,
  formatCompletionLine,
  formatSpawnLogLine,
  hasCompletionMarker,
  QUOTA_TAIL_LINES,
  solveLogBasename,
  SOLVE_MODEL_DEFAULT,
  SPAWN_KILL_AFTER_MS,
  SPAWN_TIMEOUT_MS,
  TIMEOUT_EXIT_STATUS,
} from "./spawn.ts"
import { buildCensus, openTurnDatabase } from "./census.ts"
import { computeCredits, computeEndpoints, CreditsError, formatCredits } from "./endpoints.ts"
import { renderReadout, writeReadoutFile, type ReadoutInputs } from "./report.ts"

export const AB_HOME_DEFAULT = join(homedir(), ".local", "share", "opencode")
export const CONFIG_PATH_DEFAULT = join(homedir(), ".config", "opencode", "opencode.json")
export const DB_PATH_DEFAULT = join(AB_HOME_DEFAULT, "opencode.db")
export const WORK_DIR_DEFAULT = "/tmp/opencode/ab-work-deep"
export const LOCAL_BIN_DIR = join(homedir(), ".local", "bin")
export const OPENCODE_INSTALL_DIR = join(homedir(), ".opencode", "bin")
export const REDCHECK_SCRATCH_PREFIX = "ab-redcheck"
export const SPAWN_SCRATCH_PREFIX = "ab-spawn-"
export const SCRATCH_DIR = "/tmp/opencode"
export const SETTLE_SECONDS_DEFAULT = 5
// The exit code `flock -n -E` reports when the lock is held by another
// instance; distinct from every nested CLI exit so a refusal is recognizable.
export const FLOCK_CONFLICT_EXIT = 99
const LOCK_HELD_ENV = "ABX_LOCKED"

export type CliConfig = {
  home: string
  configPath: string
  dbPath: string
  workDir: string
  flipCmd: string
  workCmd: string
  opencodeBin: string
  solveModel: string
  spawnTimeout: string
  spawnKillAfter: string
  creditCeiling: string
  settleSeconds: number
  chainMode: boolean
  calibrationMode: boolean
}

const envOr = (value: string | undefined, fallback: string): string => (value === undefined || value.length === 0 ? fallback : value)

// Formats milliseconds as the timeout(1) duration string (2h, 5m) the frozen
// spawn geometry uses.
const durationString = (ms: number): string => {
  const minutes = Math.round(ms / 60000)
  if (minutes >= 60) return `${minutes / 60}h`
  return `${minutes}m`
}

/**
 * Resolves a command: an executable found on PATH, then a fallback install
 * dir for cron environments whose PATH misses user bin dirs.
 *
 * @param name the command name
 * @param fallbackDir the extra directory checked after PATH
 * @returns the resolved path, or the empty string when unresolvable
 */
export const resolveCmd = (name: string, fallbackDir: string): string => {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  const fallback = join(fallbackDir, name)
  return existsSync(fallback) ? fallback : ""
}

/**
 * Resolves the CLI configuration from the environment, with the live
 * experiment paths as defaults: AB_HOME, AB_CONFIG, AB_DB_PATH,
 * AB_WORK_DIR, AB_FLIP_CMD, AB_WORK_CMD, OPENCODE_BIN, AB_SOLVE_MODEL,
 * AB_SPAWN_TIMEOUT, AB_SPAWN_KILL_AFTER, AB_CREDIT_CEILING,
 * AB_SETTLE_SECONDS, plus the --chain/--calibration flags (CHAIN=1 and
 * AB_CALIBRATION=1 accepted as aliases).
 *
 * @param argv the CLI argument vector
 * @param env the process environment
 * @returns the resolved configuration
 */
export const resolveCliConfig = (argv: readonly string[], env: NodeJS.ProcessEnv): CliConfig => {
  let chainMode = env.CHAIN === "1"
  let calibrationMode = env.AB_CALIBRATION === "1"
  for (const arg of argv) {
    if (arg === "--chain") chainMode = true
    if (arg === "--calibration") calibrationMode = true
  }
  const home = envOr(env.AB_HOME, AB_HOME_DEFAULT)
  return {
    home,
    configPath: envOr(env.AB_CONFIG, CONFIG_PATH_DEFAULT),
    dbPath: envOr(env.AB_DB_PATH, DB_PATH_DEFAULT),
    workDir: envOr(env.AB_WORK_DIR, WORK_DIR_DEFAULT),
    flipCmd: envOr(env.AB_FLIP_CMD, resolveCmd("opencode-ab", LOCAL_BIN_DIR)),
    workCmd: envOr(env.AB_WORK_CMD, resolveCmd("opencode-ab-work-deep", LOCAL_BIN_DIR)),
    opencodeBin: envOr(env.OPENCODE_BIN, resolveCmd("opencode", OPENCODE_INSTALL_DIR)),
    solveModel: envOr(env.AB_SOLVE_MODEL, SOLVE_MODEL_DEFAULT),
    spawnTimeout: envOr(env.AB_SPAWN_TIMEOUT, durationString(SPAWN_TIMEOUT_MS)),
    spawnKillAfter: envOr(env.AB_SPAWN_KILL_AFTER, durationString(SPAWN_KILL_AFTER_MS)),
    creditCeiling: envOr(env.AB_CREDIT_CEILING, ""),
    settleSeconds: Number(envOr(env.AB_SETTLE_SECONDS, String(SETTLE_SECONDS_DEFAULT))),
    chainMode,
    calibrationMode,
  }
}

const flipLogPath = (config: CliConfig): string => join(config.home, FLIP_LOG_BASENAME)
const blockLogPath = (config: CliConfig): string => join(config.home, BLOCK_LOG_BASENAME)
const spawnLogPath = (config: CliConfig): string => join(config.home, SPAWN_LOG_BASENAME)

const logBlock = (config: CliConfig, line: string): void => {
  appendFileSync(blockLogPath(config), `${line}\n`)
}

const nowIso = (): string => new Date().toISOString()

const readTextOrEmpty = (path: string): string => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return ""
  }
}

export type NextBlockDecision =
  | { kind: "run"; blockLabel: BlockLabel; arm: FlipArm }
  | { kind: "completion-withheld" }
  | { kind: "refuse"; rc: number; reason: string }

/**
 * The pure block decision: derives the next block, a completion-withheld
 * re-check, or the refusal from the parsed deep era, the invocation mode,
 * and the completion-marker presence alone. The pre-registered rules: the
 * calibration runs exactly once before any data block; the self-limit is the
 * flip-log state (18 data blocks); every historical data flip is validated
 * against the mirrored rotation (a deleted or duplicated mid-log line
 * refuses rather than passes); a full flip log without the completion marker
 * withholds completion (never claims it); the same position parking twice
 * without progress escalates to the operator.
 *
 * @param era the parsed deep era of the flip log
 * @param calibrationMode true for a --calibration invocation
 * @param completionLogged whether the spawn log carries the completion
 *   marker
 * @returns the run decision (label and arm), the withheld-completion
 *   re-check, or the refusal (rc and reason)
 */
export const decideNextBlock = (era: DeepEra, calibrationMode: boolean, completionLogged: boolean): NextBlockDecision => {
  if (era.doubleParked) {
    return {
      kind: "refuse",
      rc: RC.PARK_ESCALATION,
      reason: `the same position parked twice without progress (or stray park markers present: ${era.parkedCount} park markers in the flip log); inspect the provider situation and the flip log before re-invoking`,
    }
  }
  const calDone = countEraFlips(era, CALIBRATION_ARM)
  const dataDone = eraDataCount(era)
  if (calibrationMode) {
    if (calDone > 0) {
      return { kind: "refuse", rc: RC.SEQ_COMPLETE, reason: "calibration already ran (CAL-ON-FULL flip logged); it runs exactly once" }
    }
    if (dataDone > 0) {
      return { kind: "refuse", rc: RC.NOT_ALTERNATING, reason: "deep data blocks already exist; calibration runs before any data block and cannot run after" }
    }
    return { kind: "run", blockLabel: "cal", arm: CALIBRATION_ARM }
  }
  if (calDone === 0) {
    return {
      kind: "refuse",
      rc: RC.NOT_ALTERNATING,
      reason: "no calibration flip in the flip log; the CAL-ON-FULL calibration block must run before any data block",
    }
  }
  if (calDone > 1) {
    return {
      kind: "refuse",
      rc: RC.NOT_ALTERNATING,
      reason: `multiple calibration flips (${calDone} CAL-ON-FULL lines in the deep era); inspect before continuing`,
    }
  }
  if (dataDone >= TOTAL_DATA_BLOCKS) {
    if (completionLogged) {
      return { kind: "refuse", rc: RC.SEQ_COMPLETE, reason: `all ${TOTAL_DATA_BLOCKS} data blocks already ran and completion is logged` }
    }
    return { kind: "completion-withheld" }
  }
  const mismatch = validateDeepRotation(era)
  if (mismatch !== null) {
    return {
      kind: "refuse",
      rc: RC.NOT_ALTERNATING,
      reason: `flip log position ${mismatch.position} carries arm ${mismatch.carried}, expected ${mismatch.expected} per the pre-registered rotation; inspect before continuing`,
    }
  }
  return { kind: "run", blockLabel: String(dataDone + 1), arm: armForDataBlock(dataDone + 1) }
}

/**
 * The contamination guard: a leftover redcheck scratch tree or spawn event
 * file means a previous run was interrupted mid-write; the block must not
 * spawn.
 *
 * @param scratchDir the directory scanned (the operational /tmp/opencode)
 * @returns the leftover path, or null when clean
 */
export const findScratchLeftover = (scratchDir: string): string | null => {
  let entries: string[] = []
  try {
    entries = readdirSync(scratchDir)
  } catch {
    return null
  }
  const leftover = entries
    .filter((entry) => entry.startsWith(REDCHECK_SCRATCH_PREFIX) || entry.startsWith(SPAWN_SCRATCH_PREFIX))
    .sort()
    .at(0)
  return leftover === undefined ? null : join(scratchDir, leftover)
}

/**
 * Runs the flip command for the arm and asserts the live config matches the
 * arm's seed entry (deep equality carries the manualMode boolean and every
 * companion key). Exported for the hermetic suite's runner-shell cases
 * against doubles.
 *
 * @param config the resolved CLI configuration
 * @param arm the arm to flip to
 * @returns the flip command's output, or null after logging the failure
 */
export const flipArmAndAssert = (config: CliConfig, arm: FlipArm): string | null => {
  const flipped = spawnSync(config.flipCmd, [FLIP_ARG_BY_ARM[arm]], { encoding: "utf8" })
  if (flipped.status !== 0) {
    logBlock(config, `flip: FAILED (exit ${flipped.status})`)
    logBlock(config, `${flipped.stdout ?? ""}${flipped.stderr ?? ""}`)
    return null
  }
  const output = flipped.stdout ?? ""
  logBlock(config, `flip: ${output.trimEnd()}`)
  let liveConfig: unknown = null
  try {
    liveConfig = JSON.parse(readFileSync(config.configPath, "utf8"))
  } catch {
    liveConfig = null
  }
  if (!configMatchesArm(liveConfig, arm)) {
    logBlock(config, `arm-assert: FAILED (live config does not match arm ${arm}; manualMode or companion keys differ)`)
    return null
  }
  logBlock(config, `arm-assert: OK (${arm})`)
  return output
}

/**
 * Runs one exercise reset and validates the paste prompt: a reset must exit
 * 0 and print a single nonempty line (the frozen prompt).
 *
 * @param config the resolved CLI configuration
 * @returns the prompt line, or null after logging the reset failure
 */
export const resetExercise = (config: CliConfig): string | null => {
  const reset = spawnSync(config.workCmd, ["reset"], { encoding: "utf8" })
  const prompt = (reset.stdout ?? "").trimEnd()
  if (reset.status !== 0 || prompt.length === 0 || prompt.includes("\n")) {
    logBlock(config, `reset: FAILED (exit ${reset.status}, output not a single-line prompt)`)
    logBlock(config, `${reset.stdout ?? ""}${reset.stderr ?? ""}`)
    return null
  }
  logBlock(config, `reset: prompt="${prompt}"`)
  return prompt
}

/**
 * Computes one session's credits from the opencode DB, with the frozen
 * failure contract: a DB read failure and a zero-row session are both
 * credits infra failures (never a phantom zero).
 *
 * @param config the resolved CLI configuration
 * @param sessionId the spawn session id
 * @returns the credits value, or null after logging the credits error
 */
export const sessionCredits = (config: CliConfig, sessionId: string): number | null => {
  try {
    const turns = openTurnDatabase(config.dbPath).assistantTurns(sessionId)
    return computeCredits(turns)
  } catch (error) {
    const detail =
      error instanceof CreditsError ? error.message : `sqlite error for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
    logBlock(config, `credits: ERROR (${detail})`)
    return null
  }
}

const VALID_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const CREDIT_CEILING_PATTERN = /^[0-9]+([.][0-9]+)?$/

/**
 * The spawn-log coverage gate: every data block 1..18 must have a spawn-log
 * entry.
 *
 * @param spawnLogText the raw spawn-log content
 * @returns the 1-based block numbers missing an entry, in order
 */
export const missingCoverageBlocks = (spawnLogText: string): number[] => {
  const present = new Set<string>()
  for (const line of spawnLogText.split("\n")) {
    const match = / block=(\d+) arm=/.exec(line)
    if (match) present.add(match[1] ?? "")
  }
  const missing: number[] = []
  for (let block = 1; block <= TOTAL_DATA_BLOCKS; block++) {
    if (!present.has(String(block))) missing.push(block)
  }
  return missing
}

/**
 * Runs the block pipeline: decision, contamination guard, flip and
 * assertion, flip-advance guard, reset, spawn, verify, quota gate, credit
 * ceiling, and the final block's coverage gate. Real spawns happen here;
 * every deterministic decision is delegated to the pure functions the suite
 * pins.
 *
 * @param config the resolved CLI configuration
 * @returns the block's return code (the bash RC_* semantics)
 */
export const runBlock = (config: CliConfig): number => {
  const era = readDeepEra(readTextOrEmpty(flipLogPath(config)))
  const completionLogged = hasCompletionMarker(readTextOrEmpty(spawnLogPath(config)))
  const decision = decideNextBlock(era, config.calibrationMode, completionLogged)
  if (decision.kind === "refuse") {
    logBlock(config, `=== refused ${nowIso()} reason: ${decision.reason} ===`)
    process.stdout.write(`refused: ${decision.reason}\n`)
    return decision.rc
  }
  if (decision.kind === "completion-withheld") {
    const missing = missingCoverageBlocks(readTextOrEmpty(spawnLogPath(config)))
    if (missing.length > 0) {
      for (const block of missing) {
        logBlock(config, `completion-check: FAILED (spawn log has no entry for block ${block}; completion marker withheld)`)
      }
      logBlock(config, `=== completion-withheld ${nowIso()}: flip log says ${TOTAL_DATA_BLOCKS} data blocks but spawn-log coverage has gaps; inspect the logs before any completion ===`)
    } else {
      logBlock(config, `=== completion-withheld ${nowIso()}: coverage complete but the completion marker is missing (interrupted final block); inspect and resolve manually ===`)
    }
    process.stdout.write("refused: all 18 data blocks already ran but the completion marker is missing\n")
    return RC.LOG_INCONSISTENT
  }
  const { blockLabel, arm } = decision

  const leftover = findScratchLeftover(SCRATCH_DIR)
  if (leftover !== null) {
    logBlock(config, `infra-error=${nowIso()} scratch leftover present: ${leftover}; clean it before running a block`)
    process.stderr.write(`scratch leftover present: ${leftover}; clean it before running a block\n`)
    return RC.SCRATCH_LEFTOVER
  }

  logBlock(config, "================================================================================")
  logBlock(config, `=== block=${blockLabel} arm=${arm} start=${nowIso()} ===`)

  if (flipArmAndAssert(config, arm) === null) {
    logBlock(config, `=== block=${blockLabel} end=${nowIso()} status=arm-assert-failed ===`)
    return RC.FLIP_FAILED
  }

  const eraAfter = readDeepEra(readTextOrEmpty(flipLogPath(config)))
  const flipsAfter = config.calibrationMode ? countEraFlips(eraAfter, CALIBRATION_ARM) : eraDataCount(eraAfter)
  const expectedAfter = config.calibrationMode ? 1 : Number(blockLabel)
  if (flipsAfter !== expectedAfter) {
    logBlock(config, `flip: NO-OP detected (flip count ${flipsAfter}, expected ${expectedAfter}); treating as flip failure`)
    logBlock(config, `=== block=${blockLabel} end=${nowIso()} status=flip-failed ===`)
    return RC.FLIP_FAILED
  }

  const prompt = resetExercise(config)
  if (prompt === null) {
    logBlock(config, `=== block=${blockLabel} end=${nowIso()} status=reset-failed ===`)
    return RC.RESET_FAILED
  }

  const spawnStart = nowIso()
  const spawned = spawnSync(
    "timeout",
    ["--kill-after", config.spawnKillAfter, config.spawnTimeout, config.opencodeBin, ...buildSolveArgv({ model: config.solveModel, blockLabel, workDir: config.workDir, prompt })],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
    },
  )
  const spawnStatus = spawned.status ?? -1
  const sessionId = extractSessionId(spawned.stdout ?? "")
  const solveLog = join(config.home, solveLogBasename(blockLabel))
  appendFileSync(
    solveLog,
    `block=${blockLabel} arm=${arm} started=${spawnStart}\n${spawned.stdout ?? ""}\n--- stderr ---\n${spawned.stderr ?? ""}`,
  )
  appendFileSync(
    spawnLogPath(config),
    `${formatSpawnLogLine({ timestamp: nowIso(), blockLabel, arm, started: spawnStart, sessionId, exit: spawnStatus })}\n`,
  )
  if (spawnStatus === TIMEOUT_EXIT_STATUS) {
    logBlock(config, `spawn: TIMEOUT after ${config.spawnTimeout} (kill-after ${config.spawnKillAfter}); solve-session=${sessionId} solve-log=${solveLog}`)
  }
  logBlock(config, `spawn: exit=${spawnStatus} session=${sessionId} solve-log=${solveLog}`)

  const verified = spawnSync(config.workCmd, ["verify"], { encoding: "utf8" })
  const verifyStatus = verified.status ?? -1
  logBlock(config, `verify: exit=${verifyStatus}`)
  logBlock(config, verified.stdout ?? "")

  const solveLogText = readTextOrEmpty(solveLog)
  if (classifySpawnOutcome(solveLogText, spawnStatus) === "park") {
    logBlock(config, `quota-gate: MARKED (spawn exit ${spawnStatus} matched the pinned quota markers in the failure tail of ${solveLog})`)
    appendFileSync(flipLogPath(config), `${formatParkLine(nowIso(), PARK_REASON_QUOTA)}\n`)
    logBlock(config, `park: quota/limit exhaustion detected (spawn exit ${spawnStatus}, markers in ${solveLog}); PARKED marker written, block ${blockLabel} NOT consumed; re-invoke the driver to resume this arm position`)
    logBlock(config, `=== block=${blockLabel} end=${nowIso()} status=parked ===`)
    logBlock(config, "================================================================================")
    return RC.PARKED
  }
  if (spawnStatus !== 0 && spawnStatus !== TIMEOUT_EXIT_STATUS) {
    logBlock(config, `quota-gate: no-marker-in-tail (spawn exit ${spawnStatus} carried no pinned quota markers in the last ${QUOTA_TAIL_LINES} lines of ${solveLog}; never-retry applies; if this was really a quota failure the census must catch it as a flag)`)
  }

  if (config.creditCeiling.length > 0) {
    if (sessionId !== "unknown" && VALID_SESSION_ID_PATTERN.test(sessionId)) {
      const credits = sessionCredits(config, sessionId)
      if (credits === null) return RC.CREDITS_FAILED
      logBlock(config, `ceiling-check: session=${sessionId} credits=${formatCredits(credits)} ceiling=${config.creditCeiling}`)
      if (credits > Number(config.creditCeiling)) {
        logBlock(config, `ceiling-abort=${nowIso()} session=${sessionId} credits=${formatCredits(credits)} ceiling=${config.creditCeiling} (per-run credit ceiling exceeded; aborting before the next flip)`)
        return RC.CREDIT_ABORT
      }
    } else {
      logBlock(config, "ceiling-check: skipped (no parseable solve session id)")
    }
  } else {
    logBlock(config, "ceiling-check: skipped (AB_CREDIT_CEILING unset)")
  }

  if (!config.calibrationMode && blockLabel === String(TOTAL_DATA_BLOCKS)) {
    const missing = missingCoverageBlocks(readTextOrEmpty(spawnLogPath(config)))
    if (missing.length > 0) {
      for (const block of missing) {
        logBlock(config, `completion-check: FAILED (spawn log has no entry for block ${block}; completion marker withheld)`)
      }
      return RC.LOG_INCONSISTENT
    }
    appendFileSync(spawnLogPath(config), `${formatCompletionLine(nowIso())}\n`)
    logBlock(config, `=== experiment-complete ${nowIso()}: ${TOTAL_DATA_BLOCKS} data blocks ran (${arm} finished last) ===`)
    process.stdout.write(`experiment-complete: all ${TOTAL_DATA_BLOCKS} data blocks ran; final block=${blockLabel} arm=${arm} spawn-exit=${spawnStatus} verify-exit=${verifyStatus}\n`)
    return RC.SEQ_COMPLETE
  }

  logBlock(config, `=== block=${blockLabel} end=${nowIso()} status=spawn-exit=${spawnStatus} verify-exit=${verifyStatus} ===`)
  logBlock(config, "================================================================================")
  return RC.BLOCK_OK
}

const sleepSeconds = async (seconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

/**
 * Takes the single-instance lock: re-executes this CLI under `flock -n -E`
 * so the lock spans the whole invocation (chain mode included); the nested
 * execution is marked by ABX_LOCKED=1. A held lock refuses benignly (exit 0)
 * exactly like the bash driver; a missing flock binary is an infra error.
 *
 * @param config the resolved CLI configuration
 * @param argv the original CLI argument vector
 * @param env the process environment
 * @returns the process exit code to use, or null when the lock was taken
 *   and the nested run already happened
 */
export const acquireLockOrRefuse = (config: CliConfig, argv: readonly string[], env: NodeJS.ProcessEnv): number | null => {
  if (env[LOCK_HELD_ENV] === "1") return null
  if (resolveCmd("flock", "") === "") {
    logBlock(config, `infra-error=${nowIso()} missing required tool: flock`)
    process.stderr.write("missing required tool: flock\n")
    return 1
  }
  const lockPath = join(config.home, BLOCK_LOCK_BASENAME)
  closeSync(openSync(lockPath, "a"))
  const scriptPath = process.argv[1]
  if (scriptPath === undefined) {
    // No script context (an embedded caller): forking a lock wrapper cannot
    // re-enter this CLI, so refuse the fork path loudly instead of hanging
    // on a stdin-less nested node.
    logBlock(config, `infra-error=${nowIso()} single-instance lock requires a script entry point`)
    process.stderr.write("single-instance lock requires a script entry point\n")
    return 1
  }
  const nested = spawnSync("flock", ["-n", "-E", String(FLOCK_CONFLICT_EXIT), lockPath, process.execPath, ...process.execArgv, scriptPath, ...argv], {
    stdio: "inherit",
    env: { ...env, [LOCK_HELD_ENV]: "1" },
  })
  if (nested.status === FLOCK_CONFLICT_EXIT) {
    logBlock(config, `=== refused ${nowIso()} reason: another driver instance is active (lock: ${lockPath}) ===`)
    process.stdout.write(`refused: another driver instance is active (lock: ${lockPath})\n`)
    return 0
  }
  return nested.status ?? 1
}

/**
 * Renders and deposits the readout: the census over the live logs and DB,
 * the per-arm endpoints, and the Report File Template shape, written under
 * the experiment home as `abx-readout.md`.
 *
 * @param config the resolved CLI configuration
 * @returns the deposit path
 */
export const runReadout = (config: CliConfig): string => {
  const creditsByBlock = new Map<string, number>()
  const rowsWithCredits: Parameters<typeof computeEndpoints>[0] = []
  const census = buildCensus({
    flipLogText: readTextOrEmpty(flipLogPath(config)),
    spawnLogText: readTextOrEmpty(spawnLogPath(config)),
    workLogText: readTextOrEmpty(join(config.home, WORK_LOG_DEEP_BASENAME)),
    metricsLogText: readTextOrEmpty(join(config.home, "context-metrics.jsonl")),
    turns: openTurnDatabase(config.dbPath),
  })
  for (const row of census) {
    try {
      const credits = computeCredits(row.turns)
      creditsByBlock.set(row.blockLabel, credits)
      rowsWithCredits.push({ ...row, credits })
    } catch {
      // Blocks without computable credits (incomplete runs) stay in the
      // census table and out of the endpoint summaries.
    }
  }
  const { summaries, contrasts } = computeEndpoints(rowsWithCredits)
  const inputs: ReadoutInputs = {
    taskFileBasename: "LRU-83",
    slug: "readout",
    from: "opencode-abx",
    date: nowIso().slice(0, 16).replace("T", " "),
    title: `A/B readout over ${census.length} census rows (generated ${nowIso()}).`,
    rows: census,
    creditsByBlock,
    summaries,
    contrasts,
    caveats: [],
  }
  const depositPath = join(config.home, "abx-readout.md")
  mkdirSync(config.home, { recursive: true })
  writeReadoutFile(depositPath, renderReadout(inputs))
  return depositPath
}

const CANDIDATE_TOOLS: readonly [string, (config: CliConfig) => string][] = [
  ["opencode-ab (arm flip)", (config) => config.flipCmd],
  ["opencode-ab-work-deep (exercise apparatus)", (config) => config.workCmd],
  ["opencode (solve session)", (config) => config.opencodeBin],
]

const usage = (): string => "usage: opencode-abx {calibrate|chain|readout} (default: single block)"

/**
 * The CLI main: resolves the configuration and subcommand, validates the
 * ceiling, requires the operational tools, takes the lock, then calibrates,
 * chains, reads out, or runs a single block.
 *
 * @param argv the argument vector
 * @param env the process environment
 * @returns the process exit code
 */
export const main = async (argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> => {
  const subcommand = argv.find((arg) => arg === "calibrate" || arg === "chain" || arg === "readout") ?? ""
  const config = resolveCliConfig(argv, env)
  // Every logging and lock path lands under the experiment home; a fresh
  // environment may not have it yet, so the first touch must create it.
  mkdirSync(config.home, { recursive: true })
  if (config.creditCeiling.length > 0 && !CREDIT_CEILING_PATTERN.test(config.creditCeiling)) {
    logBlock(config, `infra-error=${nowIso()} invalid AB_CREDIT_CEILING: ${config.creditCeiling}`)
    process.stderr.write(`invalid AB_CREDIT_CEILING: ${config.creditCeiling}\n`)
    return 1
  }
  for (const [what, resolve] of CANDIDATE_TOOLS) {
    if (resolve(config) === "") {
      logBlock(config, `infra-error=${nowIso()} missing required tool: ${what}`)
      process.stderr.write(`missing required tool: ${what}\n`)
      return 1
    }
  }
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  if (subcommand === "calibrate") config.calibrationMode = true
  if (subcommand === "chain") config.chainMode = true

  if (subcommand === "readout") {
    process.stdout.write(`${runReadout(config)}\n`)
    return 0
  }

  const lockResult = acquireLockOrRefuse(config, argv, env)
  if (lockResult !== null) return lockResult

  if (config.chainMode) {
    for (;;) {
      const rc = runBlock(config)
      if (rc === RC.BLOCK_OK) {
        if (config.calibrationMode) {
          logBlock(config, `=== ${CALIBRATION_COMPLETE_MARKER} ${nowIso()}: calibration flip exists in the flip log ===`)
          process.stdout.write("calibration-complete: the calibration block ran; price the series from it and commit arms at the user gate\n")
          return 0
        }
        await sleepSeconds(config.settleSeconds)
        continue
      }
      if (rc === RC.SEQ_COMPLETE) {
        if (config.calibrationMode) {
          logBlock(config, `=== ${CALIBRATION_COMPLETE_MARKER} ${nowIso()}: calibration flip exists in the flip log ===`)
        } else {
          logBlock(config, `=== ${CHAIN_COMPLETE_MARKER} ${nowIso()}: ${TOTAL_DATA_BLOCKS} data blocks exist in the flip log (calibration included) ===`)
        }
        process.stdout.write("chain-complete: nothing left to run\n")
        return 0
      }
      if (rc === RC.PARKED) {
        logBlock(config, `=== chain-parked ${nowIso()}: quota/limit exhaustion; the current block is not consumed; re-invoke the driver to resume the same arm position ===`)
        return RC.PARKED
      }
      logBlock(config, `=== chain-stopped ${nowIso()} rc=${rc} ===`)
      return rc
    }
  }

  const rc = runBlock(config)
  switch (rc) {
    case RC.BLOCK_OK:
    case RC.SEQ_COMPLETE:
    case RC.NOT_ALTERNATING:
      return 0
    case RC.PARKED:
      return RC.PARKED
    case RC.PARK_ESCALATION:
      return RC.PARK_ESCALATION
    case RC.LOG_INCONSISTENT:
      return RC.LOG_INCONSISTENT
    default:
      return 1
  }
}

// The entry guard: invoked directly (the ab-install symlink runs this file
// with the pinned node), the CLI main's result becomes the exit status.
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith("opencode-abx"))
if (invokedDirectly) {
  const exitCode = await main(process.argv.slice(2), process.env)
  process.exit(exitCode)
}
