import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const METRICS_DIR_SEGMENTS = [".local", "share", "opencode"]
const METRICS_FILE_BASENAME = "lru-metrics.jsonl"
export const DEFAULT_METRICS_PATH = join(homedir(), ...METRICS_DIR_SEGMENTS, METRICS_FILE_BASENAME)

export const DEFAULT_RECENT_EVICTIONS = 8

const BYTES_PER_KILOBYTE = 1024
const TOKENS_PER_KILOTOKEN = 1000
const TOKENS_PER_MEGATOKEN = TOKENS_PER_KILOTOKEN * TOKENS_PER_KILOTOKEN
const KILOBYTE_DECIMALS = 1
const KILOTOKEN_DECIMALS = 1
const MEGATOKEN_DECIMALS = 2

const BUDGET_SOURCE_MODEL = "model"
const BUDGET_SOURCE_DEFAULT = "default"
const BUDGET_SOURCE_UNKNOWN = "unknown"
const BUDGET_SOURCE_LABEL_MODEL = "per-model limit"
const BUDGET_SOURCE_LABEL_DEFAULT = "plugin default"
const BUDGET_SOURCE_LABEL_UNKNOWN = "inactive (no budget)"

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
  postEvictionTouches: number
}

export type PanelMetricsLine = {
  session: string
  modelContextTokens: number | null
  modelContextTokensSource: string
  estimatedTokens: number
  watermarkTokens: number | null
  deficitTokens: number | null
  evictedThisRun: PanelEvictedEntry[]
  totals: PanelTotals
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
  if (!isFiniteNumber(value["postEvictionTouches"])) return undefined
  return {
    evictions: value["evictions"],
    bytesReclaimed: value["bytesReclaimed"],
    stashHits: value["stashHits"],
    stashMisses: value["stashMisses"],
    stashDropped: value["stashDropped"],
    deduped: value["deduped"],
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

export const loadPanelData = async (options: LoadPanelDataOptions = {}): Promise<PanelData> => {
  const path = options.path ?? DEFAULT_METRICS_PATH
  const sessionID = options.sessionID
  const recentEvictionsLimit = options.recentEvictions ?? DEFAULT_RECENT_EVICTIONS
  let lines: PanelMetricsLine[]
  try {
    lines = await readMetricsLog(path)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { source: path, activeSession: sessionID, current: undefined, global: globalTotals([]), error: message }
  }
  const current = sessionID === undefined ? undefined : sessionPanelData(lines, sessionID, recentEvictionsLimit)
  return { source: path, activeSession: sessionID, current, global: globalTotals(lines), error: undefined }
}

export const budgetSourceLabel = (source: string): string => {
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
  if (current.lastRun.watermarkTokens === null) return `last run: ${estimate}, no watermark (unknown budget)`
  const watermark = `~${formatTokenCount(current.lastRun.watermarkTokens)} watermark`
  if (current.lastRun.deficitTokens === null) return `last run: ${estimate} vs ${watermark}`
  if (current.lastRun.deficitTokens > 0) {
    return `last run: ${estimate} vs ${watermark} (over by ~${formatTokenCount(current.lastRun.deficitTokens)})`
  }
  return `last run: ${estimate} vs ${watermark} (within watermark)`
}

const countersText = (current: SessionPanel): string =>
  `evictions: ${current.totals.evictions} (${formatBytes(current.totals.bytesReclaimed)} reclaimed), dedup: ${current.totals.deduped}, touches: ${current.totals.postEvictionTouches}`

const stashText = (current: SessionPanel): string =>
  `stash reads: ${current.stashReads} (${current.totals.stashHits} hits / ${current.totals.stashMisses} misses), dropped: ${current.totals.stashDropped}`

const evictionText = (entry: PanelEvictedEntry): string =>
  `${entry.tool} ${entry.subject} (${formatBytes(entry.bytes)}, ${entry.messagesAgo} msgs ago)`

const historyText = (totals: GlobalTotals): string =>
  `history: ${totals.sessions} sessions, ${totals.runs} runs, ${totals.evictions} evictions, ${totals.deduped} dedup`

export const panelRows = (data: PanelData): PanelRow[] => {
  const rows: PanelRow[] = [{ text: "LRU context manager", tone: "header" }]
  if (data.error !== undefined) {
    rows.push({ text: `metrics log unreadable: ${data.error}`, tone: "warning" })
    return rows
  }
  const current = data.current
  if (current === undefined) {
    const emptyText = data.activeSession === undefined ? "no active session" : "no metrics recorded for this session yet"
    rows.push({ text: emptyText, tone: "muted" })
  } else {
    rows.push({ text: `session: ${current.session}`, tone: "muted" })
    rows.push({ text: budgetText(current), tone: "normal" })
    rows.push({ text: lastRunText(current), tone: "normal" })
    rows.push({ text: countersText(current), tone: "normal" })
    rows.push({ text: stashText(current), tone: "normal" })
    if (current.recentEvictions.length > 0) {
      rows.push({ text: "recently evicted:", tone: "muted" })
      for (const entry of current.recentEvictions) {
        rows.push({ text: evictionText(entry), tone: "normal" })
      }
    }
  }
  rows.push({ text: historyText(data.global), tone: "muted" })
  return rows
}
