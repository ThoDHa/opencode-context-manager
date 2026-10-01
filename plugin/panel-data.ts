import { open, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { DEFAULT_LIVE_STATE_DIR_BASENAME, DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_METRICS_FILE_BASENAME, TOTALS_KEYS, type TotalsKey } from "./schema.ts"

export const DEFAULT_METRICS_PATH = join(homedir(), ...DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_METRICS_FILE_BASENAME)

export const DEFAULT_LIVE_STATE_DIR = join(homedir(), ...DEFAULT_METRICS_DIR_SEGMENTS, DEFAULT_LIVE_STATE_DIR_BASENAME)
const SNAPSHOT_FILE_SUFFIX = ".json"

export const DEFAULT_RECENT_EVICTIONS = 8

export const DEFAULT_SIDEBAR_ENABLED = true

export const resolveSidebarEnabled = (value: unknown): boolean =>
  typeof value === "boolean" ? value : DEFAULT_SIDEBAR_ENABLED

export const DEFAULT_SIDEBAR_SUBAGENTS = false

export const resolveSidebarSubagents = (value: unknown): boolean =>
  typeof value === "boolean" ? value : DEFAULT_SIDEBAR_SUBAGENTS

// True when the host TUI api object actually exposes the slots registry the
// sidebar needs. The .tsx cannot export logic that node can load, so the
// predicate lives here and the TUI imports it: a host without the slots
// API (or with a non-callable register) gets no sidebar registration and
// no error, matching the README's degradation promise.
export const canRegisterSidebar = (api: unknown): boolean => {
  if (isRecord(api) === false) return false
  let slots: unknown
  try {
    slots = api["slots"]
  } catch {
    return false
  }
  if (isRecord(slots) === false) return false
  try {
    return typeof slots["register"] === "function"
  } catch {
    return false
  }
}

// Same guarded detection for the keymap registry the panel command needs:
// a missing or hostile keymap means no command registration, never a
// throw into the TUI mount path.
export const canRegisterKeymap = (api: unknown): boolean => {
  if (isRecord(api) === false) return false
  let keymap: unknown
  try {
    keymap = api["keymap"]
  } catch {
    return false
  }
  if (isRecord(keymap) === false) return false
  try {
    return typeof keymap["registerLayer"] === "function"
  } catch {
    return false
  }
}

export const SUBAGENT_FALLBACK_TYPE = "subagent"

export type SubagentChild = {
  id: string
  type: string
  updatedAtMs: number
  archived: boolean
}

export const filterSubagentChildren = (children: readonly SubagentChild[]): SubagentChild[] =>
  children.filter((child) => !child.archived)

const subagentChildFrom = (raw: unknown): SubagentChild | undefined => {
  if (!isRecord(raw)) return undefined
  if (typeof raw["id"] !== "string" || raw["id"].length === 0) return undefined
  const time = raw["time"]
  if (!isRecord(time)) return undefined
  if (!isFiniteNumber(time["updated"])) return undefined
  return {
    id: raw["id"],
    type: typeof raw["agent"] === "string" ? raw["agent"] : SUBAGENT_FALLBACK_TYPE,
    updatedAtMs: time["updated"],
    archived: time["archived"] !== undefined,
  }
}

// The live host surface behind the children fetch cannot be verified from the
// stale plugin typings, so every access below is guarded: whatever the fetch
// resolves to (or throws), the worst outcome is an empty group for this tick,
// never an exception escaping into the sidebar's refresh loop.
export const resolveSubagentChildren = async (fetchResult: unknown): Promise<SubagentChild[]> => {
  let result: unknown
  try {
    result = await fetchResult
  } catch {
    return []
  }
  if (!isRecord(result)) return []
  if (result["error"] !== undefined) return []
  const data = result["data"]
  if (!Array.isArray(data)) return []
  const children: SubagentChild[] = []
  for (const raw of data) {
    let child: SubagentChild | undefined
    try {
      child = subagentChildFrom(raw)
    } catch {
      child = undefined
    }
    if (child !== undefined) children.push(child)
  }
  return children
}

const BYTES_PER_KILOBYTE = 1024
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE
const BYTES_PER_GIGABYTE = BYTES_PER_MEGABYTE * BYTES_PER_KILOBYTE
const TOKENS_PER_KILOTOKEN = 1000
const TOKENS_PER_MEGATOKEN = TOKENS_PER_KILOTOKEN * TOKENS_PER_KILOTOKEN
const KILOBYTE_DECIMALS = 1
const MEGABYTE_DECIMALS = 1
const GIGABYTE_DECIMALS = 1
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
const PANEL_TITLE = "Context Manager"
const MANUAL_MODE_TITLE_SUFFIX = " (manual)"
// The /context panel command's registration identity, declared here so the
// node-loadable data layer pins the name the TUI registers (the .tsx itself
// only resolves inside the opencode runtime).
export const PANEL_COMMAND_NAMESPACE = "palette"
export const PANEL_COMMAND_NAME = "context.panel"
export const PANEL_COMMAND_TITLE = PANEL_TITLE
export const PANEL_COMMAND_DESCRIPTION = "Open the Context Manager's session panel"
export const PANEL_COMMAND_CATEGORY = "Context"
export const PANEL_COMMAND_SLASH_NAME = "context"
const COUNTERS_ROW_LABEL = "counters:"
const LAST_EVICTION_ROW_LABEL = "last evicted:"
const NO_SESSION_ROW_TEXT = "no active session"
const NO_RUNS_ROW_TEXT = "no metrics recorded for this session yet"
const METRICS_UNREADABLE_PREFIX = "metrics log unreadable: "

export type PanelEvictedEntry = {
  tool: string
  subject: string
  bytes: number
  messagesAgo: number
}

// Derived from the shared schema key list, so a key added in schema.ts
// appears here and in the producer's totals without a second edit.
export type PanelTotals = { [K in TotalsKey]: number }

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

export type SubagentPanelEntry = { id: string; panel: SessionPanel | undefined }

export type PanelData = {
  source: string
  activeSession: string | undefined
  current: SessionPanel | undefined
  global: GlobalTotals
  error: string | undefined
  subagentPanels?: SubagentPanelEntry[]
}

export type LoadPanelDataOptions = {
  path?: string
  stateDir?: string
  sessionID?: string
  recentEvictions?: number
  childSessionIDs?: readonly string[]
  // A stateful incremental reader over one log path. Callers ticking the
  // same path repeatedly (the sidebar poll) should hold one reader across
  // calls so each load parses only appended bytes; without one, each call
  // creates a fresh reader and behaves as a full read, today's behavior.
  reader?: MetricsLogReader
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

// Every totals key is required and must be a finite number, with one
// transitional exception: `dedupedBytes` postdates the other raw counters,
// and rotation now holds weeks of records written before it existed, so an
// absent `dedupedBytes` defaults to 0 while a present non-finite value
// still rejects the record.
const TRANSITIONAL_ABSENT_ZERO_KEYS: readonly TotalsKey[] = ["dedupedBytes"]

const parseTotals = (value: unknown): PanelTotals | undefined => {
  if (!isRecord(value)) return undefined
  const totals = {} as PanelTotals
  for (const key of TOTALS_KEYS) {
    const raw = value[key]
    if (raw === undefined && TRANSITIONAL_ABSENT_ZERO_KEYS.includes(key)) {
      totals[key] = 0
      continue
    }
    if (!isFiniteNumber(raw)) return undefined
    totals[key] = raw
  }
  return totals
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

// A session carrying a line the strict parser rejects (totals missing a
// schema key, malformed evicted entries, a missing or mistyped field:
// anything strict parsing fails on) contributes only its newest parseable
// line, while a session whose every line parses strict keeps all of them,
// so its runs count and the eviction history recentEvictions walks
// backward through stay intact. A rejected line that JSON-parses far
// enough to name its session scopes the tolerance to that session; a line
// that does not parse at all contributes nothing. The strict parser
// itself stays strict; tolerance lives only here.
// The tolerant aggregation, shared by the whole-file reader and the
// incremental reader so there is one implementation and no lockstep pair:
// raw lines are ingested into the caller's line list, and a stale session
// (one carrying a line the strict parser rejects, whatever the reason)
// collapses to its newest parseable line via one backward walk over the
// retained list. `staleSessions` persists across incremental calls on the
// reader: once a session is marked stale it stays stale, matching a cold
// full read of the same content, where the marking line keeps rejecting
// on every later re-read.
const ingestLines = (content: string, lines: PanelMetricsLine[], staleSessions: Set<string>): void => {
  for (const raw of content.split("\n")) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const line = parseMetricsLine(trimmed)
    if (line === undefined) {
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (isRecord(parsed) && typeof parsed["session"] === "string") staleSessions.add(parsed["session"])
      continue
    }
    lines.push(line)
  }
  if (staleSessions.size === 0) return
  const seenNewest = new Set<string>()
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const session = lines[index].session
    if (staleSessions.has(session) === false) continue
    if (seenNewest.has(session)) {
      lines.splice(index, 1)
      continue
    }
    seenNewest.add(session)
  }
}

const tolerantMetricsLines = (content: string): PanelMetricsLine[] => {
  const lines: PanelMetricsLine[] = []
  ingestLines(content, lines, new Set())
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
  return tolerantMetricsLines(content)
}

// Stateful incremental reader over one metrics log: each load stats the
// file and reads only the bytes appended since the previous load, parsing
// only the new lines; a shrink, an offset past the size, or an inode
// change (rotation renamed the file, or a fresh file replaced it — the
// size test alone misses a new generation larger than the old offset)
// falls back to a full read from zero. The retained state is the full
// parsed line list plus the persistent stale-session set: preserving
// today's rendered output exactly (global runs = every parsed line,
// session runs = the session's parsed line count, recentEvictions walking
// the session's lines backward) requires the whole list, but only the NEW
// bytes are re-parsed per load, and the parse was the cost the whole-file
// read paid. ENOENT keeps the accumulated state, unbounded by design: it
// covers the rotation rename tick, and a permanently deleted log leaves
// the retained lines rendering in the sidebar until the TUI remounts —
// accepted, since the snapshot path covers the session block meanwhile.
// Tail-following limits accepted with it: an inode recycled by
// delete-plus-recreate between ticks reads as an inode change (full
// re-read, correct), and an in-place truncation regrown past the stored
// offset between ticks reads as an append (the pre-truncation tail plus
// regrown bytes ingest as parseable or rejected lines; the plugin's own
// writers only append and rotate-by-rename, so neither occurs in
// production).
// A chunk ending mid-line (a torn append) makes that tail an unparseable
// orphan naming no session, so it contributes nothing; the line's
// remainder arrives in the next chunk as another orphan, and the whole
// line recovers on the next full read (rotation bounds the loss to one
// line's context in the panel views, whose snapshot path covers quiet
// runs).
export type MetricsLogReader = { load: () => Promise<PanelMetricsLine[]> }

export const createMetricsLogReader = (path: string): MetricsLogReader => {
  let lines: PanelMetricsLine[] = []
  const staleSessions = new Set<string>()
  let offset = 0
  let inode: number | undefined = undefined
  return {
    load: async (): Promise<PanelMetricsLine[]> => {
      try {
        const handle = await open(path, "r")
        try {
          const info = await handle.stat()
          const sameFile = inode !== undefined && info.ino === inode
          if (sameFile && info.size >= offset) {
            const length = info.size - offset
            if (length > 0) {
              const buffer = Buffer.alloc(length)
              await handle.read(buffer, 0, length, offset)
              ingestLines(buffer.toString("utf8"), lines, staleSessions)
            }
            offset = info.size
          } else {
            // The full branch commits the offset from the bytes actually
            // read: the file can grow between the stat above and the read,
            // and committing stat's size would make the next incremental
            // load skip the growth. Committing byteLength re-ingests any
            // growth as an ordinary append instead.
            const buffer = await handle.readFile()
            lines = []
            staleSessions.clear()
            const content = buffer.toString("utf8")
            ingestLines(content, lines, staleSessions)
            offset = Buffer.byteLength(content, "utf8")
          }
          inode = info.ino
        } finally {
          await handle.close()
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | null)?.code
        if (code !== "ENOENT") throw error
      }
      return lines
    },
  }
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
  const childSessionIDs = options.childSessionIDs
  const recentEvictionsLimit = options.recentEvictions ?? DEFAULT_RECENT_EVICTIONS
  const reader = options.reader ?? createMetricsLogReader(path)
  const snapshot = sessionID === undefined ? undefined : await readSessionSnapshot(stateDir, sessionID)
  const childSnapshots = childSessionIDs === undefined ? [] : await Promise.all(childSessionIDs.map((childID) => readSessionSnapshot(stateDir, childID)))
  const childPanels = (lines: PanelMetricsLine[]): SubagentPanelEntry[] | undefined =>
    childSessionIDs?.map((childID, index) => {
      const childSnapshot = childSnapshots[index]
      return {
        id: childID,
        panel:
          childSnapshot === undefined
            ? sessionPanelData(lines, childID, recentEvictionsLimit)
            : snapshotSessionPanel(childSnapshot, lines, childID, recentEvictionsLimit),
      }
    })
  let lines: PanelMetricsLine[]
  try {
    lines = await reader.load()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const current =
      snapshot !== undefined && sessionID !== undefined ? snapshotSessionPanel(snapshot, [], sessionID, recentEvictionsLimit) : undefined
    return { source: path, activeSession: sessionID, current, global: globalTotals([]), error: message, subagentPanels: childPanels([]) }
  }
  let current: SessionPanel | undefined
  if (sessionID !== undefined) {
    current =
      snapshot === undefined
        ? sessionPanelData(lines, sessionID, recentEvictionsLimit)
        : snapshotSessionPanel(snapshot, lines, sessionID, recentEvictionsLimit)
  }
  return { source: path, activeSession: sessionID, current, global: globalTotals(lines), error: undefined, subagentPanels: childPanels(lines) }
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
  if (Math.abs(bytes) < BYTES_PER_MEGABYTE) return compactNumber(bytes, BYTES_PER_KILOBYTE, KILOBYTE_DECIMALS, " kB")
  if (Math.abs(bytes) < BYTES_PER_GIGABYTE) return compactNumber(bytes, BYTES_PER_MEGABYTE, MEGABYTE_DECIMALS, " MB")
  return compactNumber(bytes, BYTES_PER_GIGABYTE, GIGABYTE_DECIMALS, " GB")
}

export type PanelRowTone = "header" | "normal" | "warning" | "success" | "info"

export type PanelRow = {
  text: string
  tone: PanelRowTone
  // Overrides the renderer's default accent label color for a "Label:
  // value" row; set on the subagents group's agent-type rows.
  labelTone?: PanelRowTone
  // Marks the label span of a "Label: value" row as bold in the TUI. Set
  // only by the subagents group's per-type rows; absent everywhere else.
  labelBold?: boolean
}

export type SplitRowText = { label: string; value: string }

const LABEL_VALUE_SEPARATOR = ": "

// Same seam as canRegisterSidebar: the .tsx cannot export logic that node
// can load, so the split predicate lives here and the TUI imports it. A row
// has the "Label: value" shape only when the first ": " is preceded by a
// non-empty label and followed by a non-empty value; anything else
// (headers, separators, continuation lines) stays whole-line.
export const splitRowText = (text: string): SplitRowText | undefined => {
  const separatorIndex = text.indexOf(LABEL_VALUE_SEPARATOR)
  if (separatorIndex < 0) return undefined
  const label = text.slice(0, separatorIndex)
  const value = text.slice(separatorIndex + LABEL_VALUE_SEPARATOR.length)
  if (label.length === 0 || value.length === 0) return undefined
  return { label, value }
}

const capitalizeLabel = (label: string): string =>
  label.length === 0 ? label : `${label[0].toUpperCase()}${label.slice(1)}`

const budgetText = (current: SessionPanel): string => {
  const label = budgetSourceLabel(current.budgetSource)
  return current.budgetTokens === null
    ? `budget: ${label}`
    : `budget: ${formatTokenCount(current.budgetTokens)} tokens (${label})`
}

const lastRunText = (current: SessionPanel): string => {
  const estimate = `${formatTokenCount(current.lastRun.estimatedTokens)} estimated`
  if (current.lastRun.watermarkTokens === null || current.lastRun.deficitTokens === null) return `last run: ${estimate}, no watermark`
  const watermark = `${formatTokenCount(current.lastRun.watermarkTokens)} watermark`
  if (current.lastRun.deficitTokens > 0) {
    return `last run: ${estimate} vs ${watermark} (over by ${formatTokenCount(current.lastRun.deficitTokens)})`
  }
  return `last run: ${estimate} vs ${watermark} (within watermark)`
}

const countersText = (current: SessionPanel): string =>
  `${COUNTERS_ROW_LABEL} ${current.totals.evictions} evictions (${formatBytes(current.totals.bytesReclaimed)} reclaimed, ${formatTokenCount(current.totals.evictionTokensSaved)} tokens saved), ${current.totals.dedupedUnique} dedup (${formatTokenCount(current.totals.dedupTokensSaved)} tokens saved), ${current.stashReads} stash reads (${current.totals.stashHits} hits)`

const evictionText = (entry: PanelEvictedEntry): string =>
  `${entry.tool} ${entry.subject} (${formatBytes(entry.bytes)}, ${entry.messagesAgo} msgs ago)`

const headerText = (current: SessionPanel | undefined): string =>
  current?.manualMode === true ? `${PANEL_TITLE}${MANUAL_MODE_TITLE_SUFFIX}` : PANEL_TITLE

const emptyStateText = (data: PanelData): string =>
  data.activeSession === undefined ? NO_SESSION_ROW_TEXT : NO_RUNS_ROW_TEXT

export const panelRows = (data: PanelData): PanelRow[] => {
  const current = data.current
  const rows: PanelRow[] = [{ text: headerText(current), tone: "header" }]
  if (data.error !== undefined) {
    rows.push({ text: `${METRICS_UNREADABLE_PREFIX}${data.error}`, tone: "warning" })
    if (current === undefined) return rows
  }
  if (current === undefined) {
    rows.push({ text: emptyStateText(data), tone: "normal" })
    return rows
  }
  rows.push({ text: budgetText(current), tone: "normal" })
  rows.push({ text: lastRunText(current), tone: "normal" })
  rows.push({ text: countersText(current), tone: "normal" })
  const newestEviction = current.recentEvictions[0]
  if (newestEviction !== undefined) {
    rows.push({ text: `${LAST_EVICTION_ROW_LABEL} ${evictionText(newestEviction)}`, tone: "info" })
  }
  return rows
}

// A space, not an empty string: opentui sizes a text element by its content
// lines, so zero-length text collapses to no line and the group spacing
// would silently vanish.
const SIDEBAR_BLANK_ROW: PanelRow = { text: " ", tone: "normal" }

export const SIDEBAR_COLUMN_LIMIT = 42
const ELLIPSIS_MARKER = "…"

const truncateToWidth = (text: string, maxWidth: number): string =>
  text.length > maxWidth ? `${text.slice(0, maxWidth - ELLIPSIS_MARKER.length)}${ELLIPSIS_MARKER}` : text

const SIDEBAR_BUDGET_LABEL = "Budget"
const SIDEBAR_WATERMARK_LABEL = "Watermark"
const SIDEBAR_OVER_BY_LABEL = "Over by"
const SIDEBAR_EVICTIONS_LABEL = "Evictions"
const SIDEBAR_DEDUPED_LABEL = "Deduped"
const SIDEBAR_REASONING_LABEL = "Reasoning expired"
const SIDEBAR_STASH_READS_LABEL = "Stash reads"
const SIDEBAR_TOKENS_UNIT = "tokens"
const SIDEBAR_HITS_UNIT = "hits"
const SIDEBAR_BUDGET_INACTIVE_TEXT = `${SIDEBAR_BUDGET_LABEL}: inactive (no budget)`
const SIDEBAR_WATERMARK_MISSING_TEXT = `${SIDEBAR_WATERMARK_LABEL}: none`
const SIDEBAR_SUBAGENTS_LEAD_LABEL = "Subagents"
// Fixed positions, not recency: a delegation burst would otherwise reshuffle the type blocks on every tick.
const FLEET_SUBAGENT_TYPE_ORDER = ["worker", "verifier", "reviewer", "planner"]
const SUBAGENT_AGENT_SINGULAR = "agent"
const SUBAGENT_AGENTS_UNIT = "agents"
const SUBAGENT_NO_DATA_TEXT = "no data yet"

const sidebarBudgetText = (current: SessionPanel): string =>
  current.budgetTokens === null ? SIDEBAR_BUDGET_INACTIVE_TEXT : `${SIDEBAR_BUDGET_LABEL}: ${formatTokenCount(current.budgetTokens)}`

const sidebarWatermarkText = (current: SessionPanel): string => {
  if (current.lastRun.watermarkTokens === null || current.lastRun.deficitTokens === null) return SIDEBAR_WATERMARK_MISSING_TEXT
  return `${SIDEBAR_WATERMARK_LABEL}: ${formatTokenCount(current.lastRun.watermarkTokens)}`
}

const sidebarOverByRow = (current: SessionPanel): PanelRow | undefined => {
  if (current.lastRun.deficitTokens === null || current.lastRun.deficitTokens <= 0) return undefined
  return { text: `${SIDEBAR_OVER_BY_LABEL}: ${formatTokenCount(current.lastRun.deficitTokens)}`, tone: "warning" }
}

const savingsStatText = (label: string, count: number, tokensSaved: number): string =>
  `${label}: ${count}, ${formatTokenCount(tokensSaved)} ${SIDEBAR_TOKENS_UNIT}`

const stashReadsStatText = (stashReads: number, stashHits: number): string =>
  `${SIDEBAR_STASH_READS_LABEL}: ${stashReads}, ${stashHits} ${SIDEBAR_HITS_UNIT}`

// The deduped and reasoning-expired counts are unique-event lifetime
// figures (first tombstone per pair, first crossing per reasoning part,
// identical content counted once in count and bytes alike); the token
// savings divide those same first-crossing byte totals, so the pair each
// row shows is one coherent distinct-work statement.
const sidebarCountersGroup = (current: SessionPanel): PanelRow[] => [
  { text: savingsStatText(SIDEBAR_EVICTIONS_LABEL, current.totals.evictions, current.totals.evictionTokensSaved), tone: "success" },
  { text: savingsStatText(SIDEBAR_DEDUPED_LABEL, current.totals.dedupedUnique, current.totals.dedupTokensSaved), tone: "success" },
  { text: savingsStatText(SIDEBAR_REASONING_LABEL, current.totals.reasoningExpiredUnique, current.totals.reasoningTokensSaved), tone: "success" },
  { text: stashReadsStatText(current.stashReads, current.totals.stashHits), tone: "success" },
]

const sidebarEvictionGroup = (entry: PanelEvictedEntry): PanelRow[] => [
  { text: truncateToWidth(`Last evicted: ${entry.tool} ${entry.subject}`, SIDEBAR_COLUMN_LIMIT), tone: "info" },
  { text: `${formatBytes(entry.bytes)}, ${entry.messagesAgo} messages ago`, tone: "info" },
]

const withBlankSeparators = (groups: PanelRow[][]): PanelRow[] =>
  groups.flatMap((group, index) => (index === 0 ? group : [SIDEBAR_BLANK_ROW, ...group]))

const fleetSubagentTypeRank = (type: string): number => {
  const fleetIndex = FLEET_SUBAGENT_TYPE_ORDER.indexOf(type.toLowerCase())
  return fleetIndex === -1 ? FLEET_SUBAGENT_TYPE_ORDER.length : fleetIndex
}

export const sidebarSubagentsGroup = (children: readonly SubagentChild[], data: PanelData): PanelRow[] => {
  const kept = filterSubagentChildren(children)
  if (kept.length === 0) return []
  const panelByID = new Map<string, SessionPanel>()
  for (const entry of data.subagentPanels ?? []) {
    if (entry.panel !== undefined) panelByID.set(entry.id, entry.panel)
  }
  type SubagentTypeAggregate = {
    count: number
    evictions: number
    evictionTokensSaved: number
    dedupedUnique: number
    dedupTokensSaved: number
    reasoningExpiredUnique: number
    reasoningTokensSaved: number
    stashReads: number
    stashHits: number
    hasPanel: boolean
    newestUpdatedAtMs: number
  }
  const aggregates = new Map<string, SubagentTypeAggregate>()
  for (const child of kept) {
    const aggregate = aggregates.get(child.type) ?? {
      count: 0,
      evictions: 0,
      evictionTokensSaved: 0,
      dedupedUnique: 0,
      dedupTokensSaved: 0,
      reasoningExpiredUnique: 0,
      reasoningTokensSaved: 0,
      stashReads: 0,
      stashHits: 0,
      hasPanel: false,
      newestUpdatedAtMs: child.updatedAtMs,
    }
    aggregate.count += 1
    aggregate.newestUpdatedAtMs = Math.max(aggregate.newestUpdatedAtMs, child.updatedAtMs)
    const panel = panelByID.get(child.id)
    if (panel !== undefined) {
      aggregate.hasPanel = true
      aggregate.evictions += panel.totals.evictions
      aggregate.evictionTokensSaved += panel.totals.evictionTokensSaved
      aggregate.dedupedUnique += panel.totals.dedupedUnique
      aggregate.dedupTokensSaved += panel.totals.dedupTokensSaved
      aggregate.reasoningExpiredUnique += panel.totals.reasoningExpiredUnique
      aggregate.reasoningTokensSaved += panel.totals.reasoningTokensSaved
      aggregate.stashReads += panel.stashReads
      aggregate.stashHits += panel.totals.stashHits
    }
    aggregates.set(child.type, aggregate)
  }
  const sortedTypes = [...aggregates.entries()].sort(([firstType], [secondType]) => {
    const rankDelta = fleetSubagentTypeRank(firstType) - fleetSubagentTypeRank(secondType)
    if (rankDelta !== 0) return rankDelta
    if (firstType < secondType) return -1
    if (firstType > secondType) return 1
    return 0
  })
  const statRow = (statText: string): PanelRow => ({
    text: truncateToWidth(statText, SIDEBAR_COLUMN_LIMIT),
    tone: "normal",
  })
  const typeBlocks: PanelRow[][] = sortedTypes.map(([type, aggregate]) => {
    const agentsText = `${aggregate.count} ${aggregate.count === 1 ? SUBAGENT_AGENT_SINGULAR : SUBAGENT_AGENTS_UNIT}`
    const body = aggregate.hasPanel ? agentsText : SUBAGENT_NO_DATA_TEXT
    const block: PanelRow[] = [
      { text: truncateToWidth(`${capitalizeLabel(type)}: ${body}`, SIDEBAR_COLUMN_LIMIT), tone: "normal", labelTone: "info", labelBold: true },
    ]
    if (!aggregate.hasPanel) return block
    block.push(statRow(savingsStatText(SIDEBAR_EVICTIONS_LABEL, aggregate.evictions, aggregate.evictionTokensSaved)))
    block.push(statRow(savingsStatText(SIDEBAR_DEDUPED_LABEL, aggregate.dedupedUnique, aggregate.dedupTokensSaved)))
    block.push(statRow(savingsStatText(SIDEBAR_REASONING_LABEL, aggregate.reasoningExpiredUnique, aggregate.reasoningTokensSaved)))
    block.push(statRow(stashReadsStatText(aggregate.stashReads, aggregate.stashHits)))
    return block
  })
  const leadRow: PanelRow = { text: truncateToWidth(`${SIDEBAR_SUBAGENTS_LEAD_LABEL}: ${kept.length}`, SIDEBAR_COLUMN_LIMIT), tone: "normal" }
  return withBlankSeparators([[leadRow], ...typeBlocks])
}

const finishSidebarGroups = (groups: PanelRow[][], subagentRows?: PanelRow[]): PanelRow[][] =>
  subagentRows !== undefined && subagentRows.length > 0 ? [...groups, subagentRows] : groups

export const sidebarRows = (data: PanelData, subagentRows?: PanelRow[]): PanelRow[] => {
  const current = data.current
  const groups: PanelRow[][] = [[{ text: headerText(current), tone: "header" }]]
  if (data.error !== undefined) {
    groups.push([{ text: truncateToWidth(`${METRICS_UNREADABLE_PREFIX}${data.error}`, SIDEBAR_COLUMN_LIMIT), tone: "warning" }])
    if (current === undefined) return withBlankSeparators(finishSidebarGroups(groups, subagentRows))
  }
  if (current === undefined) {
    groups.push([{ text: emptyStateText(data), tone: "normal" }])
    return withBlankSeparators(finishSidebarGroups(groups, subagentRows))
  }
  const statGroup: PanelRow[] = [
    { text: sidebarBudgetText(current), tone: "normal" },
    { text: sidebarWatermarkText(current), tone: "normal" },
  ]
  const overByRow = sidebarOverByRow(current)
  if (overByRow !== undefined) statGroup.push(overByRow)
  statGroup.push(...sidebarCountersGroup(current))
  groups.push(statGroup)
  const newestEviction = current.recentEvictions[0]
  if (newestEviction !== undefined) groups.push(sidebarEvictionGroup(newestEviction))
  return withBlankSeparators(finishSidebarGroups(groups, subagentRows))
}
