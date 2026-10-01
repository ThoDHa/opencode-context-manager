import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { PanelMetricsLine } from "../../plugin/panel-data.ts"
import {
  DEFAULT_LIVE_STATE_DIR_BASENAME,
  DEFAULT_METRICS_DIR_SEGMENTS,
  DEFAULT_METRICS_FILE_BASENAME,
} from "../../plugin/schema.ts"
import { makeSnapshot, serialize, writeSnapshot } from "../panel-fixtures.ts"

export type TuiHome = {
  home: string
  metricsPath: string
  stateDir: string
}

// The seam: the plugin derives DEFAULT_METRICS_PATH and DEFAULT_LIVE_STATE_DIR
// from os.homedir() at its first module load, so readers of those paths need
// HOME pointing at fixtures before that load. Importing this module is safe at
// eval order: its plugin imports elide or carry no home-derived state (the
// elided `import type` never loads panel-data.ts; schema.ts is pure constants
// with no imports). The override lives exactly for the callback's scope, so it
// cannot cover a suite's own module eval (static and top-level imports evaluate
// before any callback runs) or a suite-lifetime HOME (the override ends and the
// tree is removed on exit); suites with either keep their own module-eval
// override and import the plugin dynamically behind it.
export const withTuiHome = async (run: (paths: TuiHome) => Promise<void>): Promise<void> => {
  const home = mkdtempSync(join(tmpdir(), "ctx-tui-home-"))
  const previousHome = process.env.HOME
  process.env.HOME = home
  const metricsDir = join(home, ...DEFAULT_METRICS_DIR_SEGMENTS)
  const metricsPath = join(metricsDir, DEFAULT_METRICS_FILE_BASENAME)
  const stateDir = join(metricsDir, DEFAULT_LIVE_STATE_DIR_BASENAME)
  try {
    await run({ home, metricsPath, stateDir })
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
    rmSync(home, { recursive: true, force: true })
  }
}

// Writes a JSONL metrics log under the temp HOME, creating parent dirs.
export const writeMetricsLog = (metricsPath: string, lines: PanelMetricsLine[]): void => {
  mkdirSync(dirname(metricsPath), { recursive: true })
  writeFileSync(metricsPath, serialize(lines))
}

// Writes one session's live-state snapshot under the temp HOME.
export const writeSessionSnapshot = (stateDir: string, sessionID: string, overrides: Record<string, unknown> = {}): void => {
  mkdirSync(stateDir, { recursive: true })
  writeSnapshot(stateDir, sessionID, makeSnapshot(overrides))
}
