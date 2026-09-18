import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const METRICS_DIR_SEGMENTS = [".local", "share", "opencode"]
const METRICS_FILE_BASENAME = "lru-metrics.jsonl"
export const DEFAULT_METRICS_PATH = join(homedir(), ...METRICS_DIR_SEGMENTS, METRICS_FILE_BASENAME)

const LIVE_STATE_DIR_BASENAME = "lru-state"
export const DEFAULT_LIVE_STATE_DIR = join(homedir(), ...METRICS_DIR_SEGMENTS, LIVE_STATE_DIR_BASENAME)
const SNAPSHOT_FILE_SUFFIX = ".json"

export const DEFAULT_RECENT_EVICTIONS = 8

const BYTES_PER_KILOBYTE = 1024
const TOKENS_PER_KILOTOKEN = 1000
const TOKENS_PER_MEGATOKEN = TOKENS_PER_KILOTOKEN * TOKENS_PER_KILOTOKEN
const KILOBYTE_DECIMALS = 1
const KILOTOKEN_DECIMALS = 1
const MEGATOKEN_DECIMALS = 2

const BUDGET_SOURCE_OVERRIDE = "override"
const BUDGET_SOURCE_MODEL = "model"
const BUDGET_SOURCE_DEFAULT = "default"
const BUDGET_SOURCE_UNKNOWN = "unknown"
const BUDGET_SOURCE_LABEL_OVERRIDE = "per-model override"
const BUDGET_SOURCE_LABEL_MODEL = "per-model limit"
const BUDGET_SOURCE_LABEL_DEFAULT = "plugin default"
const BUDGET_SOURCE_LABEL_UNKNOWN = "inactive (no budget)"
const MODE_LABEL_MANUAL = "mode: manual"
const MODE_LABEL_AUTO = "mode: auto"
const HOT_SUBJECTS_ROW_LABEL = "hot subjects:"
const STASH_OCCUPANCY_SEPARATOR = ", occupancy: "

export type PanelEvictedEntry = {
  tool: string
  subject: string
  bytes: number
  messagesAgo: number
}

export type PanelTotals = {
  evictions: number
  bytesReclaimed: number
  stashHits: number
  stashMisses: number
  stashDropped: number
  deduped: number
  reasoningExpired: number
  reasoningBytesExpired: number
  fenceEvicted: number
  postEvictionTouches: number
}

export type PanelMetricsLine = {
  session: string
  ts: string
  modelContextTokens: number | null
  modelContextTokensSource: string
  estimatedTokens: number
  watermarkTokens: number | null
  deficitTokens: number | null
  evictedThisRun: PanelEvictedEntry[]
  totals: PanelTotals
}

export type PanelSnapshotStash = { entries: number; capacity: number }

export type PanelSnapshot = {
  ts: string
  session: string
  manualMode: boolean
  modelContextTokens: number | null
  modelContextTokensSource: string
  lastRun: { estimatedTokens: number; watermarkTokens: number | null; deficitTokens: number | null }
  totals: PanelTotals
  stash: PanelSnapshotStash
  hotSubjects: string[]
}

export type SessionPanel = {
  session: string
  runs: number
  budgetTokens: number | null
  budgetSource: string
  lastRun: { estimatedTokens: number; watermarkTokens: number | null; deficitTokens: number | null }
  totals: PanelTotals
  stashReads: number
  recentEvictions: PanelEvictedEntry[]
  manualMode?: boolean
  stash?: PanelSnapshotStash
  hotSubjects?: string[]
}

export type GlobalTotals = {
  sessions: number
  runs: number
  evictions: number
  bytesReclaimed: number
  deduped: number
  postEvictionTouches: number
  stashReads: number
}

export type PanelData = {
  source: string
  activeSession: string | undefined
  current: SessionPanel | undefined
  global: GlobalTotals
  error: string | undefined
}

export type LoadPanelDataOptions = {
  path?: string
  stateDir?: string
  sessionID?: string
  recentEvictions?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

const isOptionalFiniteNumber = (value: unknown): value is number | null => value === null || isFiniteNumber(value)

const parseEvictedEntry = (value: unknown): PanelEvictedEntry | undefined => {
  if (!isRecord(value)) return undefined
  if (typeof value["tool"] !== "string") return undefined
  if (typeof value["subject"] !== "string") return undefined
  if (!isFiniteNumber(value["bytes"])) return undefined
  if (!isFiniteNumber(value["messagesAgo"])) return undefined
  return {
    tool: value["tool"],
    subject: value["subject"],
    bytes: value["bytes"],
    messagesAgo: value["messagesAgo"],
  }
}

const parseEvictedEntries = (value: unknown): PanelEvictedEntry[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const entries: PanelEvictedEntry[] = []
  for (const raw of value) {
    const entry = parseEvictedEntry(raw)
    if (entry === undefined) return undefined
    entries.push(entry)
  }
  return entries
}

const parseTotals = (value: unknown): PanelTotals | undefined => {
  if (!isRecord(value)) return undefined
  if (!isFiniteNumber(value["evictions"])) return undefined
  if (!isFiniteNumber(value["bytesReclaimed"])) return undefined
  if (!isFiniteNumber(value["stashHits"])) return undefined
  if (!isFiniteNumber(value["stashMisses"])) return undefined
  if (!isFiniteNumber(value["stashDropped"])) return undefined
  if (!isFiniteNumber(value["deduped"])) return undefined
  if (!isFiniteNumber(value["reasoningExpired"])) return undefined
  if (!isFiniteNumber(value["reasoningBytesExpired"])) return undefined
  if (!isFiniteNumber(value["fenceEvicted"])) return undefined
  if (!isFiniteNumber(value["postEvictionTouches"])) return undefined
  return {
    evictions: value["evictions"],
    bytesReclaimed: value["bytesReclaimed"],
    stashHits: value["stashHits"],
    stashMisses: value["stashMisses"],
    stashDropped: value["stashDropped"],
    deduped: value["deduped"],
    reasoningExpired: value["reasoningExpired"],
    reasoningBytesExpired: value["reasoningBytesExpired"],
    fenceEvicted: value["fenceEvicted"],
    postEvictionTouches: value["postEvictionTouches"],
  }
}

export const parseMetricsLine = (raw: string): PanelMetricsLine | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  if (typeof parsed["session"] !== "string") return undefined
  if (typeof parsed["ts"] !== "string") return undefined
  if (!isOptionalFiniteNumber(parsed["modelContextTokens"])) return undefined
  if (typeof parsed["modelContextTokensSource"] !== "string") return undefined
  if (!isFiniteNumber(parsed["estimatedTokens"])) return undefined
  if (!isOptionalFiniteNumber(parsed["watermarkTokens"])) return undefined
  if (!isOptionalFiniteNumber(parsed["deficitTokens"])) return undefined
  const evictedThisRun = parseEvictedEntries(parsed["evictedThisRun"])
  if (evictedThisRun === undefined) return undefined
  const totals = parseTotals(parsed["totals"])
  if (totals === undefined) return undefined
  return {
    session: parsed["session"],
    ts: parsed["ts"],
    modelContextTokens: parsed["modelContextTokens"],
    modelContextTokensSource: parsed["modelContextTokensSource"],
    estimatedTokens: parsed["estimatedTokens"],
    watermarkTokens: parsed["watermarkTokens"],
    deficitTokens: parsed["deficitTokens"],
    evictedThisRun,
    totals,
  }
}

export const parseMetricsLog = (content: string): PanelMetricsLine[] => {
  const lines: PanelMetricsLine[] = []
  for (const raw of content.split("\n")) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const line = parseMetricsLine(trimmed)
    if (line !== undefined) lines.push(line)
  }
  return lines
}

export const readMetricsLog = async (path: string): Promise<PanelMetricsLine[]> => {
  let content: string
  try {
    content = await readFile(path, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === "ENOENT") return []
    throw error
  }
  return parseMetricsLog(content)
}

const parseSnapshotStash = (value: unknown): PanelSnapshotStash | undefined => {
  if (!isRecord(value)) return undefined
  if (!isFiniteNumber(value["entries"])) return undefined
  if (!isFiniteNumber(value["capacity"])) return undefined
  return { entries: value["entries"], capacity: value["capacity"] }
}

const parseSnapshotLastRun = (value: unknown): PanelSnapshot["lastRun"] | undefined => {
  if (!isRecord(value)) return undefined
  if (!isFiniteNumber(value["estimatedTokens"])) return undefined
  if (!isOptionalFiniteNumber(value["watermarkTokens"])) return undefined
  if (!isOptionalFiniteNumber(value["deficitTokens"])) return undefined
  return {
    estimatedTokens: value["estimatedTokens"],
    watermarkTokens: value["watermarkTokens"],
    deficitTokens: value["deficitTokens"],
  }
}

const parseSnapshotHotSubjects = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const subjects: string[] = []
  for (const subject of value) {
    if (typeof subject !== "string") return undefined
    subjects.push(subject)
  }
  return subjects
}

export const parseStateSnapshot = (raw: string): PanelSnapshot | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  if (typeof parsed["ts"] !== "string") return undefined
  if (typeof parsed["session"] !== "string") return undefined
  if (typeof parsed["manualMode"] !== "boolean") return undefined
  if (!isOptionalFiniteNumber(parsed["modelContextTokens"])) return undefined
  if (typeof parsed["modelContextTokensSource"] !== "string") return undefined
  const lastRun = parseSnapshotLastRun(parsed["lastRun"])
  if (lastRun === undefined) return undefined
  const totals = parseTotals(parsed["totals"])
  if (totals === undefined) return undefined
  const stash = parseSnapshotStash(parsed["stash"])
  if (stash === undefined) return undefined
  const hotSubjects = parseSnapshotHotSubjects(parsed["hotSubjects"])
  if (hotSubjects === undefined) return undefined
  return {
    ts: parsed["ts"],
    session: parsed["session"],
    manualMode: parsed["manualMode"],
    modelContextTokens: parsed["modelContextTokens"],
    modelContextTokensSource: parsed["modelContextTokensSource"],
    lastRun,
    totals,
    stash,
    hotSubjects,
  }
}

export const readStateSnapshot = async (path: string, sessionID: string): Promise<PanelSnapshot | undefined> => {
  let content: string
  try {
    content = await readFile(path, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === "ENOENT") return undefined
    throw error
  }
  const snapshot = parseStateSnapshot(content)
  return snapshot !== undefined && snapshot.session === sessionID ? snapshot : undefined
}

const timestampMsOf = (ts: string): number | undefined => {
  const ms = Date.parse(ts)
  return Number.isNaN(ms) ? undefined : ms
}

const newestSessionLineOf = (lines: PanelMetricsLine[], sessionID: string): PanelMetricsLine | undefined => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].session === sessionID) return lines[index]
  }
  return undefined
}

const isLogNewerThanSnapshot = (snapshot: PanelSnapshot, lines: PanelMetricsLine[], sessionID: string): boolean => {
  const newest = newestSessionLineOf(lines, sessionID)
  if (newest === undefined) return false
  const snapshotMs = timestampMsOf(snapshot.ts)
  const lineMs = timestampMsOf(newest.ts)
  return snapshotMs !== undefined && lineMs !== undefined && lineMs > snapshotMs
}

export const snapshotSessionPanel = (
  snapshot: PanelSnapshot,
  lines: PanelMetricsLine[],
  sessionID: string,
  recentEvictionsLimit: number = DEFAULT_RECENT_EVICTIONS,
): SessionPanel => {
  const history = sessionPanelData(lines, sessionID, recentEvictionsLimit)
  const logNewer = history !== undefined && isLogNewerThanSnapshot(snapshot, lines, sessionID) ? history : undefined
  const totals = logNewer !== undefined ? logNewer.totals : snapshot.totals
  return {
    session: sessionID,
    runs: history?.runs ?? 0,
    budgetTokens: logNewer !== undefined ? logNewer.budgetTokens : snapshot.modelContextTokens,
    budgetSource: logNewer !== undefined ? logNewer.budgetSource : snapshot.modelContextTokensSource,
    lastRun: logNewer !== undefined ? logNewer.lastRun : snapshot.lastRun,
    totals,
    stashReads: totals.stashHits + totals.stashMisses,
    recentEvictions: history?.recentEvictions ?? [],
    manualMode: snapshot.manualMode,
    stash: snapshot.stash,
    hotSubjects: snapshot.hotSubjects,
  }
}

export const linesForSession = (lines: PanelMetricsLine[], sessionID: string): PanelMetricsLine[] =>
  lines.filter((line) => line.session === sessionID)

export const sessionPanelData = (
  lines: PanelMetricsLine[],
  sessionID: string,
  recentEvictionsLimit: number = DEFAULT_RECENT_EVICTIONS,
): SessionPanel | undefined => {
  const sessionLines = linesForSession(lines, sessionID)
  const last = sessionLines[sessionLines.length - 1]
  if (last === undefined) return undefined
  const recentEvictions: PanelEvictedEntry[] = []
  const bound = Math.max(0, recentEvictionsLimit)
  for (let index = sessionLines.length - 1; index >= 0; index -= 1) {
    const evicted = sessionLines[index].evictedThisRun
    for (let entryIndex = evicted.length - 1; entryIndex >= 0; entryIndex -= 1) {
      if (recentEvictions.length >= bound) break
      recentEvictions.push(evicted[entryIndex])
    }
    if (recentEvictions.length >= bound) break
  }
  return {
    session: sessionID,
    runs: sessionLines.length,
    budgetTokens: last.modelContextTokens,
    budgetSource: last.modelContextTokensSource,
    lastRun: {
      estimatedTokens: last.estimatedTokens,
      watermarkTokens: last.watermarkTokens,
      deficitTokens: last.deficitTokens,
    },
    totals: last.totals,
    stashReads: last.totals.stashHits + last.totals.stashMisses,
    recentEvictions,
  }
}

export const globalTotals = (lines: PanelMetricsLine[]): GlobalTotals => {
  const lastLineBySession = new Map<string, PanelMetricsLine>()
  for (const line of lines) lastLineBySession.set(line.session, line)
  const totals: GlobalTotals = {
    sessions: lastLineBySession.size,
    runs: lines.length,
    evictions: 0,
    bytesReclaimed: 0,
    deduped: 0,
    postEvictionTouches: 0,
    stashReads: 0,
  }
  for (const line of lastLineBySession.values()) {
    totals.evictions += line.totals.evictions
    totals.bytesReclaimed += line.totals.bytesReclaimed
    totals.deduped += line.totals.deduped
    totals.postEvictionTouches += line.totals.postEvictionTouches
    totals.stashReads += line.totals.stashHits + line.totals.stashMisses
  }
  return totals
}

const readSessionSnapshot = async (stateDir: string, sessionID: string): Promise<PanelSnapshot | undefined> => {
  try {
    return await readStateSnapshot(join(stateDir, `${sessionID}${SNAPSHOT_FILE_SUFFIX}`), sessionID)
  } catch {
    return undefined
  }
}

export const loadPanelData = async (options: LoadPanelDataOptions = {}): Promise<PanelData> => {
  const path = options.path ?? DEFAULT_METRICS_PATH
  const stateDir = options.stateDir ?? DEFAULT_LIVE_STATE_DIR
  const sessionID = options.sessionID
  const recentEvictionsLimit = options.recentEvictions ?? DEFAULT_RECENT_EVICTIONS
  const snapshot = sessionID === undefined ? undefined : await readSessionSnapshot(stateDir, sessionID)
  let lines: PanelMetricsLine[]
  try {
    lines = await readMetricsLog(path)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const current =
      snapshot !== undefined && sessionID !== undefined ? snapshotSessionPanel(snapshot, [], sessionID, recentEvictionsLimit) : undefined
    return { source: path, activeSession: sessionID, current, global: globalTotals([]), error: message }
  }
  let current: SessionPanel | undefined
  if (sessionID !== undefined) {
    current =
      snapshot === undefined
        ? sessionPanelData(lines, sessionID, recentEvictionsLimit)
        : snapshotSessionPanel(snapshot, lines, sessionID, recentEvictionsLimit)
  }
  return { source: path, activeSession: sessionID, current, global: globalTotals(lines), error: undefined }
}

export const budgetSourceLabel = (source: string): string => {
  if (source === BUDGET_SOURCE_OVERRIDE) return BUDGET_SOURCE_LABEL_OVERRIDE
  if (source === BUDGET_SOURCE_MODEL) return BUDGET_SOURCE_LABEL_MODEL
  if (source === BUDGET_SOURCE_DEFAULT) return BUDGET_SOURCE_LABEL_DEFAULT
  return BUDGET_SOURCE_LABEL_UNKNOWN
}

const compactNumber = (value: number, divisor: number, decimals: number, suffix: string): string =>
  `${parseFloat((value / divisor).toFixed(decimals))}${suffix}`

export const formatTokenCount = (tokens: number): string => {
  if (!Number.isFinite(tokens)) return String(tokens)
  if (Math.abs(tokens) < TOKENS_PER_KILOTOKEN) return String(tokens)
  if (Math.abs(tokens) < TOKENS_PER_MEGATOKEN) return compactNumber(tokens, TOKENS_PER_KILOTOKEN, KILOTOKEN_DECIMALS, "k")
  return compactNumber(tokens, TOKENS_PER_MEGATOKEN, MEGATOKEN_DECIMALS, "M")
}

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes)) return String(bytes)
  if (Math.abs(bytes) < BYTES_PER_KILOBYTE) return `${bytes} B`
  return compactNumber(bytes, BYTES_PER_KILOBYTE, KILOBYTE_DECIMALS, " kB")
}

export type PanelRowTone = "header" | "normal" | "muted" | "warning"

export type PanelRow = {
  text: string
  tone: PanelRowTone
}

const budgetText = (current: SessionPanel): string => {
  const label = budgetSourceLabel(current.budgetSource)
  return current.budgetTokens === null
    ? `budget: ${label}`
    : `budget: ~${formatTokenCount(current.budgetTokens)} tokens (${label})`
}

const lastRunText = (current: SessionPanel): string => {
  const estimate = `~${formatTokenCount(current.lastRun.estimatedTokens)} estimated`
  if (current.lastRun.watermarkTokens === null || current.lastRun.deficitTokens === null) return `last run: ${estimate}, no watermark`
  const watermark = `~${formatTokenCount(current.lastRun.watermarkTokens)} watermark`
  if (current.lastRun.deficitTokens > 0) {
    return `last run: ${estimate} vs ${watermark} (over by ~${formatTokenCount(current.lastRun.deficitTokens)})`
  }
  return `last run: ${estimate} vs ${watermark} (within watermark)`
}

const countersText = (current: SessionPanel): string =>
  `evictions: ${current.totals.evictions} (${formatBytes(current.totals.bytesReclaimed)} reclaimed), fences: ${current.totals.fenceEvicted}, dedup: ${current.totals.deduped}, reasoning: ${current.totals.reasoningExpired} (${formatBytes(current.totals.reasoningBytesExpired)}), touches: ${current.totals.postEvictionTouches}`

const modeText = (current: SessionPanel): string => (current.manualMode === true ? MODE_LABEL_MANUAL : MODE_LABEL_AUTO)

const stashText = (current: SessionPanel): string => {
  const reads = `stash reads: ${current.stashReads} (${current.totals.stashHits} hits / ${current.totals.stashMisses} misses), dropped: ${current.totals.stashDropped}`
  return current.stash === undefined ? reads : `${reads}${STASH_OCCUPANCY_SEPARATOR}${current.stash.entries}/${current.stash.capacity}`
}

const hotSubjectsText = (subjects: string[]): string => `${HOT_SUBJECTS_ROW_LABEL} ${subjects.join(", ")}`

const evictionText = (entry: PanelEvictedEntry): string =>
  `${entry.tool} ${entry.subject} (${formatBytes(entry.bytes)}, ${entry.messagesAgo} msgs ago)`

const historyText = (totals: GlobalTotals): string =>
  `history: ${totals.sessions} sessions, ${totals.runs} runs, ${totals.evictions} evictions, ${totals.deduped} dedup`

export const panelRows = (data: PanelData): PanelRow[] => {
  const rows: PanelRow[] = [{ text: "LRU context manager", tone: "header" }]
  const current = data.current
  if (data.error !== undefined) {
    rows.push({ text: `metrics log unreadable: ${data.error}`, tone: "warning" })
    if (current === undefined) return rows
  }
  if (current === undefined) {
    const emptyText = data.activeSession === undefined ? "no active session" : "no metrics recorded for this session yet"
    rows.push({ text: emptyText, tone: "muted" })
  } else {
    rows.push({ text: `session: ${current.session}`, tone: "muted" })
    if (current.manualMode !== undefined) rows.push({ text: modeText(current), tone: "muted" })
    rows.push({ text: budgetText(current), tone: "normal" })
    rows.push({ text: lastRunText(current), tone: "normal" })
    rows.push({ text: countersText(current), tone: "normal" })
    rows.push({ text: stashText(current), tone: "normal" })
    if (current.hotSubjects !== undefined && current.hotSubjects.length > 0) {
      rows.push({ text: hotSubjectsText(current.hotSubjects), tone: "muted" })
    }
    if (current.recentEvictions.length > 0) {
      rows.push({ text: "recently evicted:", tone: "muted" })
      for (const entry of current.recentEvictions) {
        rows.push({ text: evictionText(entry), tone: "normal" })
      }
    }
  }
  if (data.error === undefined) rows.push({ text: historyText(data.global), tone: "muted" })
  return rows
}
