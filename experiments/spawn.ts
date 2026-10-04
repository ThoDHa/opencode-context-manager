/**
 * Spawn control for the standardized-experiment framework: the frozen solve
 * spawn geometry (fresh `opencode run` with the model pin), the quota gate
 * with its boundary-anchored marker set and tail-only scan, session-id
 * extraction, and the spawn-log line format. Ported from the bash apparatus
 * (`experiments/legacy/opencode-ab-block`). Real spawns stay operational-only
 * (they cost credits); the suite proves the deterministic decisions here.
 */

import {
  CALIBRATION_ARM,
  COMPLETION_MARKER,
  SOLVE_LOG_CAL_LABEL,
  SOLVE_LOG_PREFIX,
  SOLVE_LOG_SUFFIX,
  type BlockLabel,
  type FlipArm,
} from "./arms.ts"

export const SOLVE_MODEL_DEFAULT = "zai-coding-plan/glm-5.3-flash"
export const SESSION_TITLE_PREFIX = "ab-solve block"
// Frozen spawn time limits: the calibration duration sets the data-chain
// timeout at launch in the operational shell (max(2h, 2x calibration)); these
// are the pre-registered defaults.
export const SPAWN_TIMEOUT_MS = 2 * 60 * 60 * 1000
export const SPAWN_KILL_AFTER_MS = 5 * 60 * 1000
export const TIMEOUT_EXIT_STATUS = 124
// The failure tail of the solve log scanned for quota markers (lines); solve
// prose earlier in the session cannot trigger a park.
export const QUOTA_TAIL_LINES = 40

// Pinned quota markers. The 429 alternative is anchored to non-digit
// boundaries so numbers like 1429 or 4290 cannot fire; the remaining
// alternatives cover the provider's quota, rate-limit, usage-limit, and
// credit-exhaustion error shapes. Case-insensitive.
export const QUOTA_MARKER_REGEX_SOURCE =
  "(^|[^0-9])429([^0-9]|$)|quota|rate.?limit|usage.?limit|credits? (exhausted|exceeded)|exceeded your"

/**
 * Decides the quota-park outcome from the spawn evidence: a nonzero spawn
 * exit (the timeout kill excluded; it is its own never-retry class) plus a
 * pinned quota marker in the failure tail (the last QUOTA_TAIL_LINES lines)
 * of the solve log, which carries the captured spawn stderr at its end.
 * Matching is per line and case-insensitive, mirroring `grep -qiE`.
 *
 * @param solveLogText the full solve-log content
 * @param spawnStatus the spawn process exit status
 * @returns true when the evidence pins quota/limit exhaustion
 */
export const isQuotaFailure = (solveLogText: string, spawnStatus: number): boolean => {
  if (spawnStatus === 0) return false
  if (spawnStatus === TIMEOUT_EXIT_STATUS) return false
  // A file's trailing newline terminates its last line; it does not open an
  // empty 41st line. Strip exactly one so the tail slice covers 40 real
  // lines, matching `tail -n 40`.
  const body = solveLogText.endsWith("\n") ? solveLogText.slice(0, -1) : solveLogText
  const markerRegex = new RegExp(QUOTA_MARKER_REGEX_SOURCE, "i")
  return body.split("\n").slice(-QUOTA_TAIL_LINES).some((line) => markerRegex.test(line))
}

export type SpawnOutcome = "park" | "consume"

/**
 * Classifies the spawn outcome for the park/resume semantics: quota evidence
 * parks the chain BEFORE the next flip (the block stays unconsumed and the
 * resume re-runs the same arm position); any other failure class keeps the
 * never-retry semantics (the block counts collected and the analysis
 * proceeds at achieved n).
 *
 * @param solveLogText the full solve-log content
 * @param spawnStatus the spawn process exit status
 * @returns "park" when the block must be parked, "consume" otherwise
 */
export const classifySpawnOutcome = (solveLogText: string, spawnStatus: number): SpawnOutcome =>
  isQuotaFailure(solveLogText, spawnStatus) ? "park" : "consume"

/**
 * Builds the solve spawn argv: `run --format json -m <model> --title "ab-
 * solve block <n>" --dir <workDir> <prompt>`, in that exact order, with no
 * `--pure` (it would disable the plugin under test).
 *
 * @param options the model pin, 1-based data block number or "cal" label,
 *   solve work tree, and the frozen paste prompt
 * @returns the argv following the opencode binary
 */
export const buildSolveArgv = (options: { model: string; blockLabel: BlockLabel; workDir: string; prompt: string }): string[] => [
  "run",
  "--format",
  "json",
  "-m",
  options.model,
  "--title",
  `${SESSION_TITLE_PREFIX} ${options.blockLabel}`,
  "--dir",
  options.workDir,
  options.prompt,
]

/**
 * Extracts the session id from captured JSON event lines: the first line
 * that parses as an object carrying a non-null sessionID. Prints "unknown"
 * when nothing parseable is found.
 *
 * @param spawnStdoutText the captured spawn stdout
 * @returns the session id, or the "unknown" sentinel
 */
export const extractSessionId = (spawnStdoutText: string): string => {
  for (const line of spawnStdoutText.split("\n")) {
    if (line.trim().length === 0) continue
    try {
      const event: unknown = JSON.parse(line)
      const sessionId = (event as { sessionID?: unknown } | null)?.sessionID
      if (sessionId !== null && sessionId !== undefined) return String(sessionId)
    } catch {
      // Event lines that do not parse carry no session id; keep scanning.
    }
  }
  return "unknown"
}

export type SpawnLogEntry = {
  timestamp: string
  blockLabel: BlockLabel
  arm: FlipArm
  started: string
  sessionId: string
  exit: number
}

const SPAWN_LOG_LINE_PATTERN = /^(.*) block=(\S+) arm=(\S+) started=(.*) solve-session=(\S+) exit=(\d+)$/

/**
 * Parses a spawn log's text. The `block=<label> arm=<ARM>` summary lines
 * produced by the runner become entries; the completion-marker line and any
 * unparseable line are skipped here (the marker is read separately).
 *
 * @param spawnLogText the raw spawn-log content
 * @returns the parsed spawn entries in log order
 */
export const parseSpawnLog = (spawnLogText: string): SpawnLogEntry[] => {
  const entries: SpawnLogEntry[] = []
  for (const line of spawnLogText.split("\n")) {
    const match = SPAWN_LOG_LINE_PATTERN.exec(line)
    if (!match) continue
    entries.push({
      timestamp: match[1] ?? "",
      blockLabel: match[2] ?? "",
      arm: (match[3] ?? "") as FlipArm,
      started: match[4] ?? "",
      sessionId: match[5] ?? "unknown",
      exit: Number(match[6]),
    })
  }
  return entries
}

/**
 * Detects the experiment completion marker line (`<timestamp>
 * experiment-complete`) in a spawn log's text: the marker exists only when
 * every data block's spawn is on record.
 *
 * @param spawnLogText the raw spawn-log content
 * @returns true when the completion marker is present
 */
export const hasCompletionMarker = (spawnLogText: string): boolean =>
  spawnLogText.split("\n").some((line) => line.endsWith(` ${COMPLETION_MARKER}`))

/**
 * Formats one spawn-log summary line:
 * `<timestamp> block=<label> arm=<ARM> started=<timestamp> solve-session=<id> exit=<code>`.
 *
 * @param entry the spawn summary fields
 * @returns the spawn-log line without its trailing newline
 */
export const formatSpawnLogLine = (entry: Omit<SpawnLogEntry, "blockLabel"> & { blockLabel: BlockLabel }): string =>
  `${entry.timestamp} block=${entry.blockLabel} arm=${entry.arm} started=${entry.started} solve-session=${entry.sessionId} exit=${entry.exit}`

/**
 * Formats the completion-marker line appended to the spawn log after the
 * final data block's coverage gate passes.
 *
 * @param timestamp the ISO-8601 completion time
 * @returns the completion-marker line without its trailing newline
 */
export const formatCompletionLine = (timestamp: string): string => `${timestamp} ${COMPLETION_MARKER}`

/**
 * The solve log file name for a block: `ab-solve-<label>.log`, where the
 * calibration block uses the `cal` label.
 *
 * @param blockLabel the block label
 * @returns the solve log basename
 */
export const solveLogBasename = (blockLabel: BlockLabel): string => {
  const label = blockLabel === CALIBRATION_ARM ? SOLVE_LOG_CAL_LABEL : blockLabel
  return `${SOLVE_LOG_PREFIX}${label}${SOLVE_LOG_SUFFIX}`
}
