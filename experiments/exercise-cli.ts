#!/usr/bin/env node
/**
 * Operational exercise tool for the standardized-experiment framework:
 * `reset`, `verify`, and `redcheck` over the committed exercise fixtures.
 * Deployed as `opencode-abx-work` by `make ab-install`; usage:
 * `opencode-abx-work <rotator|deep> reset|verify|redcheck`. The contracts
 * mirror the legacy bash apparatus (`experiments/legacy/opencode-ab-work`,
 * `experiments/legacy/opencode-ab-work-deep`): reset lays a pristine work
 * tree and prints the single-line frozen paste prompt, verify byte-checks
 * the frozen spec files and runs the suite, redcheck proves stub-red and
 * reference-green in one freshly copied scratch tree. Log lines land in
 * AB_HOME's per-exercise work log (ab-work.log / ab-work-deep.log).
 */

import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { checkSpecIntegrity, corpusManifest, resolveExercise, treeManifest, type ExerciseName } from "./exercise.ts"
import { WORK_LOG_BASENAME, WORK_LOG_DEEP_BASENAME } from "./arms.ts"

export const WORK_DIR_BY_EXERCISE: Readonly<Record<ExerciseName, string>> = {
  rotator: "/tmp/opencode/ab-work",
  deep: "/tmp/opencode/ab-work-deep",
}

export const SCRATCH_DIR = "/tmp/opencode"

export type ExerciseCliOptions = {
  home: string
  scratchDir: string
  workDir: string
  nodeBin: string
}

/**
 * Resolves the exercise tool's environment: AB_HOME for the work log, the
 * work tree per exercise, and the node binary (NODE_BIN override, then a
 * PATH probe, then a shell-lookup fallback for spawnSync's bare-command
 * limitation).
 *
 * @param exercise the exercise name
 * @param env the process environment
 * @returns the resolved options
 */
export const resolveExerciseOptions = (exercise: ExerciseName, env: NodeJS.ProcessEnv): ExerciseCliOptions => {
  const defaultHome = join(homedir(), ".local", "share", "opencode")
  let nodeBin = env.NODE_BIN ?? ""
  if (nodeBin === "") {
    for (const dir of (env.PATH ?? "").split(delimiter)) {
      if (dir.length === 0) continue
      const candidate = join(dir, "node")
      if (existsSync(candidate)) {
        nodeBin = candidate
        break
      }
    }
  }
  if (nodeBin === "" && existsSync("/usr/bin/env")) {
    // Fallback: ask the shell's own lookup (spawnSync without a shell cannot
    // resolve a bare command name itself).
    const probed = spawnSync("/usr/bin/env", ["node", "-e", "process.stdout.write(process.execPath)"], { encoding: "utf8" })
    if (probed.status === 0 && probed.stdout) nodeBin = probed.stdout.trim()
  }
  return {
    home: envOr(env.AB_HOME, defaultHome),
    scratchDir: envOr(env.AB_SCRATCH_DIR, SCRATCH_DIR),
    workDir: WORK_DIR_BY_EXERCISE[exercise],
    nodeBin,
  }
}

const envOr = (value: string | undefined, fallback: string): string => (value === undefined || value.length === 0 ? fallback : value)

const workLogBasename = (exercise: ExerciseName): string => (exercise === "deep" ? WORK_LOG_DEEP_BASENAME : WORK_LOG_BASENAME)

const logLine = (options: ExerciseCliOptions, exercise: ExerciseName, line: string): void => {
  mkdirSync(options.home, { recursive: true })
  appendFileSync(join(options.home, workLogBasename(exercise)), `${nowIso()} ${line}\n`)
}

const nowIso = (): string => new Date().toISOString()

// The nested node --test children must not inherit a host test runner's
// child-context env: NODE_TEST_CONTEXT makes the nested run report over IPC
// and exit 0 regardless of failures.
const childEnv = (): NodeJS.ProcessEnv => {
  const { NODE_TEST_CONTEXT: _stripped, ...rest } = process.env
  return rest
}

/**
 * Writes one work-log line into the exercise's per-experiment log under the
 * home: `<ISO timestamp> <line>`. Exported because it is the tool's only
 * log-write path; the suite drives it to prove the written lines round-trip
 * through the census's `parseWorkLog`.
 *
 * @param options the resolved options (home carries the log)
 * @param exercise the exercise name (picks ab-work.log vs ab-work-deep.log)
 * @param line the line body (reset, verify, or tamper text)
 */
export const writeWorkLogLine = (options: ExerciseCliOptions, exercise: ExerciseName, line: string): void => {
  logLine(options, exercise, line)
}

/**
 * The suite files of an exercise tree: every `tests/*.test.mjs`, globbed at
 * run time like the legacy apparatus's `node --test tests/*.test.mjs`, so a
 * solver-added test file runs (and can fail) under verify too.
 *
 * @param treeDir the exercise tree root
 * @returns the suite file paths relative to the tree root, sorted
 */
export const suiteFilesOf = (treeDir: string): string[] =>
  readdirSync(join(treeDir, "tests"))
    .filter((entry) => entry.endsWith(".test.mjs"))
    .sort()
    .map((entry) => join("tests", entry))

// The redcheck scratch prefixes of both apparatus generations: the
// framework's per-exercise prefixes and the legacy bash scripts' fixed
// names (opencode-ab-work's ab-redcheck*, opencode-ab-work-deep's
// ab-deep-redcheck*). A leftover from either generation means the work-tree
// lineage is not pristine.
export const REDCHECK_SCRATCH_PREFIXES = ["ab-redcheck", "ab-deep-redcheck"] as const

/**
 * The contamination guard: leftover redcheck scratch trees beside the
 * exercise tree mean the work-tree lineage is not pristine. The guard scans
 * both apparatus generations' prefixes (framework and legacy), so it does
 * not vary by exercise.
 *
 * @param options the resolved options (scratchDir is scanned)
 * @returns the leftover path, or null when clean
 */
export const findRedcheckLeftover = (options: ExerciseCliOptions): string | null => {
  try {
    const leftover = readdirSync(options.scratchDir)
      .sort()
      .find((entry) => REDCHECK_SCRATCH_PREFIXES.some((prefix) => entry.startsWith(prefix)))
    return leftover === undefined ? null : join(options.scratchDir, leftover)
  } catch {
    return null
  }
}

/**
 * reset: lays down a pristine exercise tree and prints the frozen paste
 * prompt (single line). The deep exercise regenerates its corpus from the
 * seeded generator and asserts it byte-matches the committed manifest, so
 * generator drift dies loudly instead of shipping.
 *
 * @param exercise the resolved exercise
 * @param options the resolved options
 * @returns the prompt line, or null after the die-loudly paths
 */
export const resetTree = (exerciseSpec: ReturnType<typeof resolveExercise>, options: ExerciseCliOptions): string | null => {
  const leftover = findRedcheckLeftover(options)
  if (leftover !== null) die(`redcheck scratch present: ${leftover} (contamination guard)`)
  if (!existsSync(join(exerciseSpec.templateDir, exerciseSpec.entryModule))) die(`template missing at ${exerciseSpec.templateDir}`)
  if (exerciseSpec.name === "deep") {
    // The deep corpus is regenerated from the template's seeded generator
    // and asserted against the committed manifest, so the generator must
    // ship with the template (the corpus itself is regenerable and pinned
    // by experiments/fixtures/deep/corpus-manifest.txt).
    if (!existsSync(join(exerciseSpec.templateDir, "tools", "generate.mjs"))) die(`template missing the corpus generator at ${exerciseSpec.templateDir}`)
  }
  rmSync(options.workDir, { recursive: true, force: true })
  cpSync(exerciseSpec.templateDir, options.workDir, { recursive: true })
  if (exerciseSpec.name === "deep") {
    const generated = spawnSync(options.nodeBin || "node", [join(exerciseSpec.templateDir, "tools", "generate.mjs"), options.workDir], { encoding: "utf8" })
    if (generated.status !== 0) die("corpus generation failed")
    if (!existsSync(join(options.workDir, "data"))) die("generated corpus missing from the work copy")
    const regenerated = treeManifest(join(options.workDir, "data"))
      .split("\n")
      .map((line) => line.replace(/^([0-9a-f]+)  /, "$1  data/"))
      .join("\n")
    if (regenerated !== corpusManifest()) {
      die("regenerated corpus differs from the committed corpus manifest")
    }
  }
  const referenceMarker = join(options.workDir, "reference")
  if (existsSync(referenceMarker)) die("reference dir leaked inside the work copy")
  const referenceEntry = join(exerciseSpec.referenceDir, exerciseSpec.entryModule)
  if (existsSync(referenceEntry)) {
    const laidBytes = readFileSync(join(options.workDir, exerciseSpec.entryModule))
    if (laidBytes.equals(readFileSync(referenceEntry))) die("reference solution leaked inside the work copy")
  }
  logLine(options, exerciseSpec.name, "reset")
  return exerciseSpec.pastePrompt
}

/**
 * verify: byte-checks the frozen spec files, runs the suite, prints the
 * runner's summary lines, and logs the counts.
 *
 * @param exercise the resolved exercise
 * @param options the resolved options
 * @returns the suite's exit status (the die paths exit the process directly)
 */
export const verifyTree = (exerciseSpec: ReturnType<typeof resolveExercise>, options: ExerciseCliOptions): number => {
  if (!existsSync(options.workDir)) die(`no exercise tree at ${options.workDir}; run reset first`)
  const tamper = checkSpecIntegrity(exerciseSpec.templateDir, options.workDir, exerciseSpec.workdirSpecFiles)
  if (!tamper.ok) {
    logLine(options, exerciseSpec.name, `verify: spec tampered: ${tamper.file} differs from template`)
    process.stderr.write(`opencode-abx-work: spec tampered: ${tamper.file} differs from template\n`)
    process.exit(1)
  }
  const suite = spawnSync(options.nodeBin || "node", ["--test", ...suiteFilesOf(options.workDir)], {
    cwd: options.workDir,
    encoding: "utf8",
    env: childEnv(),
  })
  const output = `${suite.stdout ?? ""}${suite.stderr ?? ""}`
  const summary = output.split("\n").filter((line) => /^ℹ (tests|pass|fail|cancelled|skipped|todo) /.test(line))
  for (const line of summary) process.stdout.write(`${line}\n`)
  const passed = /ℹ pass (\d+)/.exec(output)?.[1]
  const failed = /ℹ fail (\d+)/.exec(output)?.[1]
  const status = suite.status ?? 1
  if (passed !== undefined && failed !== undefined) {
    logLine(options, exerciseSpec.name, `verify: pass=${passed} fail=${failed} (exit ${status})`)
  } else {
    logLine(options, exerciseSpec.name, `verify: unreadable runner summary (exit ${status})`)
  }
  return status
}

/**
 * redcheck: determinism proof in one freshly copied scratch tree: the
 * template's stub module must fail the suite, and the reference solution
 * must pass it. The scratch tree is removed on both paths.
 *
 * @param exercise the resolved exercise
 * @param options the resolved options
 * @returns the process exit code (0 proven, 1 broken)
 */
export const redcheckTree = (exerciseSpec: ReturnType<typeof resolveExercise>, options: ExerciseCliOptions): number => {
  const referenceEntry = join(exerciseSpec.referenceDir, exerciseSpec.entryModule)
  if (!existsSync(referenceEntry)) die(`reference solution missing at ${referenceEntry}`)
  if (!existsSync(join(exerciseSpec.templateDir, exerciseSpec.entryModule))) die(`template missing at ${exerciseSpec.templateDir}`)
  mkdirSync(options.scratchDir, { recursive: true })
  const scratch = mkdtempSync(join(options.scratchDir, `${REDCHECK_SCRATCH_PREFIXES[0]}${exerciseSpec.name}.`))
  try {
    cpSync(exerciseSpec.referenceDir, scratch, { recursive: true })
    cpSync(join(exerciseSpec.templateDir, exerciseSpec.entryModule), join(scratch, exerciseSpec.entryModule))
    const red = spawnSync(options.nodeBin || "node", ["--test", ...suiteFilesOf(scratch)], {
      cwd: scratch,
      encoding: "utf8",
      env: childEnv(),
    })
    const redStatus = red.status ?? 1
    if (redStatus === 0) {
      process.stdout.write("redcheck: FAIL - stubs unexpectedly passed\n")
      return 1
    }
    process.stdout.write(`redcheck: OK - stubs fail as required\n\n`)
    cpSync(referenceEntry, join(scratch, exerciseSpec.entryModule))
    const green = spawnSync(options.nodeBin || "node", ["--test", ...suiteFilesOf(scratch)], {
      cwd: scratch,
      encoding: "utf8",
      env: childEnv(),
    })
    const greenStatus = green.status ?? 1
    if (greenStatus !== 0) {
      process.stdout.write("redcheck: FAIL - reference solution unexpectedly failed\n")
      return 1
    }
    process.stdout.write(`redcheck: OK - reference passes\n\n`)
    process.stdout.write("redcheck: determinism proven (stub red, reference green)\n")
    return 0
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const die = (message: string): never => {
  process.stderr.write(`opencode-abx-work: ${message}\n`)
  process.exit(1)
}

const usage = "usage: opencode-abx-work <rotator|deep> reset|verify|redcheck"

const EXERCISE_NAMES: readonly ExerciseName[] = ["rotator", "deep"]

const isExerciseName = (value: string): value is ExerciseName => EXERCISE_NAMES.includes(value as ExerciseName)

// The entry guard: only when invoked directly does this file act as a CLI;
// imports (the hermetic suite) get the pure helpers only. The installed
// name (opencode-abx-work, via make ab-install's symlink) guards too.
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith("opencode-abx-work"))
if (invokedDirectly) {
  const [exerciseArg, command] = process.argv.slice(2)
  if (!isExerciseName(exerciseArg ?? "") || !command) {
    process.stderr.write(`${usage}\n`)
    process.exit(2)
  }
  const exercise = resolveExercise(exerciseArg)
  const options = resolveExerciseOptions(exerciseArg, process.env)
  if (command === "reset") {
    const prompt = resetTree(exercise, options)
    if (prompt === null) process.exit(1)
    process.stdout.write(`${prompt}\n`)
    process.exit(0)
  }
  if (command === "verify") process.exit(verifyTree(exercise, options))
  if (command === "redcheck") process.exit(redcheckTree(exercise, options))
  process.stderr.write(`${usage}\n`)
  process.exit(2)
}
