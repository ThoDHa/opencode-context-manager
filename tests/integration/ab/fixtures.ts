/**
 * Fixtures for the hermetic A/B apparatus suite: log-text builders, the
 * fake flip/work doubles (bash, written into per-case temp dirs), the
 * in-memory opencode DB builder over node:sqlite, and the frozen 18-block
 * schedule literal from the LRU-82 protocol.
 */

import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

// The pinned mirrored rotation, written out literally as the proof's
// independent statement of it (proof.sh's SCHEDULE array). Every arm's mean
// run index is exactly 9.5.
export const SCHEDULE = [
  "OFF", "ON-FULL", "ON-DRY", "ON-DRY", "ON-FULL", "OFF",
  "OFF", "ON-FULL", "ON-DRY", "ON-DRY", "ON-FULL", "OFF",
  "OFF", "ON-FULL", "ON-DRY", "ON-DRY", "ON-FULL", "OFF",
] as const

export const T0 = "2026-10-04T10:00:00.000Z"

// Formats a fixture timestamp as offset minutes from T0.
export const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * 60000).toISOString()

/**
 * Builds a flip-log text: an optional LRU-81 pre-era tail, the calibration
 * line, then the given data arms with park markers interleaved (a `"PARKED"`
 * entry cancels the preceding arm).
 *
 * @param arms the data-arm and "PARKED" token sequence after calibration
 * @param options preEra true adds two LRU-81-era lines before the
 *   calibration
 * @returns the flip-log text
 */
export const flipLogText = (arms: readonly string[], options: { preEra?: boolean } = {}): string => {
  const lines: string[] = []
  if (options.preEra) {
    lines.push(`${at(-90)} ON-FULL`, `${at(-80)} OFF`)
  }
  lines.push(`${at(0)} CAL-ON-FULL`)
  let minute = 10
  for (const arm of arms) {
    lines.push(`${at(minute)} ${arm}`)
    minute += 10
  }
  return lines.join("\n") + "\n"
}

export type SpawnLine = { label: string; arm: string; sessionId: string; exit: number; minute: number }

/**
 * Builds a spawn-log text from block summaries, optionally carrying the
 * completion marker.
 *
 * @param entries the spawn summaries in log order
 * @param options completion true appends the experiment-complete marker
 * @returns the spawn-log text
 */
export const spawnLogText = (entries: readonly SpawnLine[], options: { completion?: boolean } = {}): string => {
  const lines = entries.map(
    (entry) => `${at(entry.minute)} block=${entry.label} arm=${entry.arm} started=${at(entry.minute - 1)} solve-session=${entry.sessionId} exit=${entry.exit}`,
  )
  if (options.completion) lines.push(`${at(999)} experiment-complete`)
  return lines.join("\n") + "\n"
}

/**
 * Builds a work-log text (verify lines per block, optionally a tamper line).
 *
 * @param verifies the pass/fail figures per block label, in log order
 * @returns the work-log text
 */
export const workLogText = (verifies: readonly { label: string; passed: number; failed: number; minute: number; exit?: number }[]): string =>
  verifies
    .map((entry) => `${at(entry.minute)} verify: pass=${entry.passed} fail=${entry.failed} (exit ${entry.exit ?? 0})`)
    .join("\n") + "\n"

export type MetricsLineOptions = { minute: number; sessionId: string; generation: 1 | 2 }

/**
 * Builds a metrics JSONL text: one event per option, generation 2 carrying
 * `wouldEvictThisRun`.
 *
 * @param events the events to emit
 * @returns the metrics-log text
 */
export const metricsLogText = (events: readonly MetricsLineOptions[]): string =>
  events
    .map((event) =>
      JSON.stringify({
        ts: at(event.minute),
        session: event.sessionId,
        modelContextTokens: 1000000,
        estimatedTokens: 50000,
        modelContextTokensSource: "model",
        ...(event.generation === 2 ? { wouldEvictThisRun: 0, wouldEvictBytesThisRun: 0 } : { watermarkTokens: 500000, deficitTokens: -450000 }),
        evictedThisRun: [],
        totals: { evictions: 0 },
      }),
    )
    .join("\n") + "\n"

const ON_ENTRY_TEXT =
  '[["./opencode-context-manager/plugin/context-manager.ts",{"manualMode":false,"watermarkTokens":250000,"agedReadEvictionMessages":30,"reasoningRetentionMessages":16}]]'
const ON_DRY_ENTRY_TEXT =
  '[["./opencode-context-manager/plugin/context-manager.ts",{"manualMode":true,"watermarkTokens":250000,"agedReadEvictionMessages":30,"reasoningRetentionMessages":16}]]'

export type FakeFlipMode = "correct" | "wrong-bool" | "swapped"

/**
 * Writes the fake flip double (a bash script) into a temp bin dir. The fake
 * writes the arm's plugin entry into the ABX_CONFIG config file, appends the
 * arm-named line to ABX_FLIP_LOG, and prints a success line: the observable
 * effects the post-flip assertion reads. Modes inject the miswrite classes
 * (inverted manualMode, swapped arm entries).
 *
 * @param binDir the temp bin directory
 * @param mode the fake's behavior mode
 * @returns the fake's path
 */
export const writeFakeFlip = (binDir: string, mode: FakeFlipMode): string => {
  const path = join(binDir, "fake-flip")
  writeFileSync(
    path,
    `#!/usr/bin/env bash
set -euo pipefail
CONFIG="$ABX_CONFIG"
LOG="$ABX_FLIP_LOG"
log_flip() { printf '%s %s\\n' "$(date -Iseconds)" "$1" >> "$LOG"; }
write_entry() { printf '{"model":"test-model","plugin":%s}\\n' "$1" > "$CONFIG"; }
case "${mode}" in
  wrong-bool)
    case "$1" in
      on-full) write_entry '${ON_DRY_ENTRY_TEXT}'; log_flip "ON-FULL"; echo "flipped to on-full" ;;
      on-dry) write_entry '${ON_ENTRY_TEXT}'; log_flip "ON-DRY"; echo "flipped to on-dry" ;;
      cal-on-full) write_entry '[]'; log_flip "CAL-ON-FULL"; echo "flipped to cal-on-full" ;;
      off) write_entry '${ON_ENTRY_TEXT}'; log_flip "OFF"; echo "flipped to off" ;;
    esac
    exit 0
    ;;
  swapped)
    case "$1" in
      on-full|cal-on-full) write_entry '${ON_DRY_ENTRY_TEXT}' ;;
      on-dry|off) write_entry '${ON_ENTRY_TEXT}' ;;
    esac
    case "$1" in
      on-full) log_flip "ON-FULL"; echo "flipped to on-full" ;;
      on-dry) log_flip "ON-DRY"; echo "flipped to on-dry" ;;
      cal-on-full) log_flip "CAL-ON-FULL"; echo "flipped to cal-on-full" ;;
      off) log_flip "OFF"; echo "flipped to off" ;;
    esac
    exit 0
    ;;
esac
case "$1" in
  on-full) write_entry '${ON_ENTRY_TEXT}'; log_flip "ON-FULL"; echo "flipped to on-full" ;;
  on-dry) write_entry '${ON_DRY_ENTRY_TEXT}'; log_flip "ON-DRY"; echo "flipped to on-dry" ;;
  cal-on-full) write_entry '${ON_ENTRY_TEXT}'; log_flip "CAL-ON-FULL"; echo "flipped to cal-on-full" ;;
  off) write_entry '[]'; log_flip "OFF"; echo "flipped to off" ;;
  *) echo "fake-flip: usage" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  )
  return path
}

export type FakeWorkOptions = { resetStatus?: number; promptLines?: string[]; verifyStatus?: number; verifyPass?: number; verifyFail?: number }

/**
 * Writes the fake work double (a bash script) into a temp bin dir: reset
 * prints the configured prompt lines and exits with the configured status;
 * verify prints runner summary lines and exits with its configured status;
 * both append to the ABX_WORK_LOG work log like the real apparatus.
 *
 * @param binDir the temp bin directory
 * @param options the failure injections
 * @returns the fake's path
 */
export const writeFakeWork = (binDir: string, options: FakeWorkOptions = {}): string => {
  const path = join(binDir, "fake-work")
  const prompt = options.promptLines ?? ["Complete the deep coding task in the work tree: frozen prompt line."]
  const resetStatus = options.resetStatus ?? 0
  const verifyStatus = options.verifyStatus ?? 0
  const verifyPass = options.verifyPass ?? 57
  const verifyFail = options.verifyFail ?? 0
  writeFileSync(
    path,
    `#!/usr/bin/env bash
set -uo pipefail
case "$1" in
  reset)
    printf '%s reset\\n' "$(date -Iseconds)" >> "$ABX_WORK_LOG"
    printf '${prompt.join("\\n")}\\n'
    exit ${resetStatus}
    ;;
  verify)
    printf 'ℹ tests ${verifyPass + verifyFail}\\nℹ pass ${verifyPass}\\nℹ fail ${verifyFail}\\n'
    printf '%s verify: pass=${verifyPass} fail=${verifyFail}\\n' "$(date -Iseconds)" >> "$ABX_WORK_LOG"
    exit ${verifyStatus}
    ;;
  *) echo "fake-work: usage" >&2; exit 2 ;;
esac
`,
    { mode: 0o755 },
  )
  return path
}

export type DbMessage = { sessionId: string; minute: number; modelId: string; input: number; output: number; cacheWrite: number; cacheRead?: number; updatedMinute?: number }

/**
 * Builds an opencode-shaped SQLite DB at the given path over node:sqlite
 * (the `message` table: id, session_id, time_created, time_updated, and the
 * JSON `data` document carrying role, modelID, tokens, and time.created).
 *
 * @param dbPath the DB file to create
 * @param messages the assistant messages to insert
 */
export const buildOpencodeDb = (dbPath: string, messages: readonly DbMessage[]): void => {
  const db = new DatabaseSync(dbPath)
  db.exec(
    "CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)",
  )
  const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)")
  messages.forEach((message, index) => {
    insert.run(
      `m${index + 1}`,
      message.sessionId,
      Date.parse(T0) + message.minute * 60000,
      Date.parse(T0) + (message.updatedMinute ?? message.minute) * 60000,
      JSON.stringify({
        role: "assistant",
        modelID: message.modelId,
        tokens: { input: message.input, output: message.output, cache: { write: message.cacheWrite, read: message.cacheRead ?? 0 } },
        time: { created: Date.parse(T0) + message.minute * 60000 },
      }),
    )
  })
  db.close()
}

/**
 * Runs one exercise suite in its tree with the current node and returns the
 * parsed runner summary figures plus the raw output.
 *
 * @param treeDir the exercise tree whose tests/ directory holds the suite
 * @param suiteFile the suite file path, repo-relative to the tree
 * @returns the tests/pass/fail figures and the output text
 */
export const runExerciseSuite = (treeDir: string, suiteFile: string): { tests: number; pass: number; fail: number; status: number; output: string } => {
  // A nested node --test must not inherit the outer runner's
  // NODE_TEST_CONTEXT: a runner child-context env makes the nested run
  // report over IPC and exit 0 regardless of failures.
  const { NODE_TEST_CONTEXT: _stripped, ...childEnv } = process.env
  const result = spawnSync(process.execPath, ["--test", suiteFile], { cwd: treeDir, encoding: "utf8", env: childEnv })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  const figure = (name: string): number => Number(new RegExp(`^ℹ ${name} (\\d+)`, "m").exec(output)?.[1] ?? -1)
  return { tests: figure("tests"), pass: figure("pass"), fail: figure("fail"), status: result.status ?? 1, output }
}
