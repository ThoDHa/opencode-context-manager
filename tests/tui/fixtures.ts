import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import type { PanelMetricsLine } from "../../plugin/panel-data.ts"
import { makeSnapshot, serialize, writeSnapshot } from "../panel-fixtures.ts"

// The seam: the plugin derives DEFAULT_METRICS_PATH and DEFAULT_LIVE_STATE_DIR
// from os.homedir() at its first module load, so a suite reading those paths
// under fixtures must point HOME at a temp tree before its first plugin import
// and hold it for the constants' frozen lifetime (module eval to suite end),
// importing the plugin dynamically behind the override. A scoped override
// helper cannot serve that: static and top-level imports evaluate before any
// callback could run, so a callback-scoped HOME never covers a suite's own
// module eval. Importing this module is safe at eval order: it evaluates no
// plugin module (the panel-data import is a fully elided `import type`).

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
