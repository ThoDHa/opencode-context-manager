import { randomUUID } from "node:crypto"
import { appendFile, readFile } from "node:fs/promises"
import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { PLUGIN_ID } from "./schema.ts"

import type { ChatParamsModel, ContextLimitEntry } from "./context-limits.ts"
import {
  CONTEXT_TOKENS_SOURCE_UNKNOWN,
  chatParamsHookBody,
  contextLimitForRun,
} from "./context-limits.ts"
import type { FilePartFields, MessageBundle } from "./messages.ts"
import type { ContextManagerOptions, ResolvedOptions } from "./options.ts"
import type { HotSubject, Subject, SubjectRange } from "./vocabulary.ts"
import {
  ATTACHMENT_MIME_KEY,
  ATTACHMENT_URL_KEY,
  attachmentPayloadCharsOf,
  completedOutputOf,
  ESCAPE_SPAN_PATTERN,
  estimateTokens,
  filePartOf,
  hotFromIndexOf,
  nonEmptyAttachmentsOf,
  REASONING_METADATA_KEY,
  REASONING_PART_TYPE,
  REASONING_TEXT_KEY,
  retentionFromIndexOf,
  runCompositionOf,
  stableStringify,
  stripStateAttachments,
  TEXT_PART_TYPE,
} from "./messages.ts"
import {
  ADVISORY_SUBJECTS_BOUND,
  isPatternProtected,
  isProtectedTool,
  resolveOptions,
} from "./options.ts"
import {
  FALLBACK_SESSION_KEY,
  rememberFaultForSubject,
  rememberSessionValue,
  sessionIDFromContext,
  sessionKeyFromContext,
  touchMapEntry,
  trimMapToBound,
} from "./session-maps.ts"
import {
  BASH_TOOL_NAME,
  boundedSingleLineOf,
  buildFenceTombstone,
  buildOutputDigest,
  buildReloadPointer,
  buildTombstone,
  DEDUP_FILE_SUPERSEDED_LEAD,
  DEDUP_MARKER,
  DEDUP_RANGE_SUPERSEDED_LEAD,
  DEDUP_SUPERSEDED_LEAD,
  EVICTION_MARKER,
  HINT_LINE_PREFIX,
  JSON_INDENT_SPACES,
  LEGACY_DEDUP_MARKER,
  LEGACY_EVICTION_MARKER,
  LEGACY_HINT_LINE_PREFIX,
  LEGACY_PURGED_INPUT_MARKER,
  orderedRenderedSubjectsOf,
  PATH_INPUT_KEYS,
  PURGED_INPUT_MARKER,
  rangeOf,
  READ_TOOL_NAME,
  RECALL_TOOL_NAME,
  renderSubject,
  startsWithEitherGeneration,
  SUBJECT_SEPARATOR,
  subjectsOf,
  UNKNOWN_TARGET_LABEL,
} from "./vocabulary.ts"
import type {
  AdvisoryResult,
  DryRunResult,
  EvictedEntryInfo,
  EvictionResult,
  FenceEviction,
  MetricsHydration,
  MetricsStore,
  PersistedTotals,
  ReasoningExpiry,
  RetentionBreakdown,
  RunOutcome,
  SessionMetrics,
  ToolAppearance,
} from "./state.ts"
import {
  appearanceTouches,
  countFaults,
  countUniqueDedupedPairs,
  createSessionMetrics,
  DEFAULT_REMEMBERED_FAULT_SUBJECTS,
  DEFAULT_REMEMBERED_REASONING_PARTS,
  metricsForSession,
  recordRunOutcome,
  rememberError,
  rememberUniqueKey,
  totalsOf,
  withSessionMetricsEntry,
} from "./state.ts"
import type { PruneThrottle } from "./persistence.ts"
import {
  appendHygieneCopy,
  isRecord,
  logRotationIsDue,
  METRICS_ROTATION_DISABLED_MAX_BYTES,
  migrateLegacyDefaultPaths,
  newestPersistedTotalsOf,
  PRUNE_SCAN_NEVER,
  recordMetricsLine,
  recordSessionCheckpoint,
  rotateMetricsLogPastCap,
} from "./persistence.ts"

export { ADVISORY_BAND_RATIO_DEFAULT, DEFAULT_INGESTION_HYGIENE_ROTATION_MAX_BYTES, DEFAULT_METRICS_ROTATION_MAX_BYTES, DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES } from "./options.ts"
export { METRIC_NUMBER_KEYS, METRICS_CURSOR_KEYS, RAW_COUNTER_KEYS } from "./state.ts"
export type { MetricsCursorKey } from "./state.ts"

// Cache-aware hint hysteresis: a subject enters the stable line only after
// HINT_ENTRY_TOUCHES accumulated live touches and leaves only after
// HINT_EXIT_MISSES consecutive runs without one; entry strictly exceeding
// exit keeps a flapping subject from rewriting the line it just left.
const HINT_ENTRY_TOUCHES = 3
const HINT_EXIT_MISSES = 2
const RECALL_ARG_NAME = "subject"
const RECALL_PROBE_ARG_NAME = "countsOnly"
const RECALL_PROBE_ARG_SCHEMA_TYPE = "boolean"
const RECALL_PROBE_ARG_DESCRIPTION =
  "Set true to price the reload before paying for it: match counts return instead of any content and nothing is counted"
const RECALL_TOOL_DESCRIPTION =
  "Return the full original content of anything the Context Manager evicted and stored in the page store: a tool call output or a fenced code block from an old user message. Pass the subject exactly as it appears in the eviction notice. Pass countsOnly true to price the reload first: a counts-only summary (match counts, newest-match bytes, attachments-present flag) returns instead of any content, with no counter or fault side effects."
const RECALL_ARG_DESCRIPTION = "The subject exactly as named in the eviction notice"
const RECALL_ARG_SCHEMA_TYPE = "string"
const RECALL_ARG_SCHEMA: Record<string, string> = {
  type: RECALL_ARG_SCHEMA_TYPE,
  description: RECALL_ARG_DESCRIPTION,
}
const RECALL_PROBE_ARG_SCHEMA: Record<string, string> = {
  type: RECALL_PROBE_ARG_SCHEMA_TYPE,
  description: RECALL_PROBE_ARG_DESCRIPTION,
}
const RECALL_PROBE_LEAD = "counts-only probe for"
const RECALL_PROBE_IN_SESSION_LABEL = "in-session matches"
const RECALL_PROBE_PAGE_STORE_LABEL = "page-store matches"
const RECALL_PROBE_NEWEST_LABEL = "newest match"
const RECALL_PROBE_BYTES_UNIT = "bytes"
const RECALL_PROBE_OLDER_LABEL = "older matches"
const RECALL_PROBE_ATTACHMENTS_LABEL = "attachments present"
const STASH_MARKER = "[ctx-stash]"
const STASH_OLDER_LEAD = "older pages in this session for subject"
const STASH_MESSAGE_LABEL = "at message"
const STASH_MATCH_SEPARATOR = "; "
const STASH_MISS_LEAD = "no page in this session for subject"
const STASH_MISS_HINT = "only pages evicted during this session are stored"
const STASH_OCCUPANCY_LEAD = "session page store holds"
const STASH_OCCUPANCY_EMPTY_TAIL = "nothing from this session"
const STASH_OCCUPANCY_ENTRY_LABEL = "entry"
const STASH_OCCUPANCY_ENTRIES_LABEL = "entries"
const STASH_OCCUPANCY_SUBJECT_LABEL = "subject"
const STASH_OCCUPANCY_SUBJECTS_LABEL = "subjects"
const STASH_OCCUPANCY_CATEGORY_SEPARATOR = ", "
const STASH_OCCUPANCY_OVERFLOW_LABEL = "more"
const STASH_OCCUPANCY_RANGE_OLDEST_LABEL = "oldest"
const STASH_OCCUPANCY_RANGE_NEWEST_LABEL = "newest"
const MAX_OCCUPANCY_CATEGORIES = 5
const STASH_INVALID_SUBJECT_LEAD = "requires a non-empty subject string"
const PAGE_STORE_RESTORED_LEAD = "restored from the page store"
const PAGE_STORE_RESTORED_LINE = `${STASH_MARKER} ${PAGE_STORE_RESTORED_LEAD}.`
const PAGE_STORE_OLDER_LEAD = "older pages for subject"
const PAGE_STORE_MISS_LEAD = "no prior-session page for subject"
const RECEIVED_LABEL = "received"
const TOOL_ERROR_PREFIX = "[ctx-error] "
// How many messages of eviction deferral one recorded fault buys a subject
// in the candidate sort: a reloaded output is demonstrably needed again, so
// it re-evicts five messages later than its recency alone would place it.
const FAULT_PENALTY_MESSAGES = 5
// The page-store line contract's own version, stamped on every new line so
// mixed-version stores classify line by line: a legacy unstamped line reads
// as this version (v1 is the unstamped shape plus the field), a strictly
// newer version is refused rather than interpreted, and refusal halts this
// process's appends and rotation so it cannot bury a newer build's pages.
export const PAGE_STORE_SCHEMA_VERSION = 1
const DESCRIBE_TOOL_NAME = "describe"
const DESCRIBE_TOOL_DESCRIPTION =
  "Return live metrics for the Context Manager in this session: eviction counters, expired reasoning counts, faults (post-eviction re-references of evicted subjects), session page store occupancy, the effective context limit and its headroom, and the most recent transform run's token estimate; also the newest run's declared omissions (tool evictions, expired reasoning parts, evicted fenced blocks) with the recall reload pointer when one exists, the newest run's retention audit over the live tool-output pool when one exists, the manual-mode dry run when armed, the newest run's advisory pressure-band preview when the estimate enters the band, the newest run's post-transform composition (tool outputs, text, retained reasoning), the echoed option surface including charsPerToken, the remembered-evicted-subjects bound, and the protected tools and patterns, and the last transform error when one occurred."
const OMISSIONS_REPORT_KEY = "omissions"
const OMISSIONS_TOOL_EVICTIONS_FIELD = "toolEvictions"
const OMISSIONS_REASONING_PARTS_FIELD = "reasoningParts"
const OMISSIONS_FENCE_BLOCKS_FIELD = "fenceBlocks"
const OMISSIONS_RELOAD_TOOL_FIELD = "reloadTool"
const OMISSIONS_LINE_LEAD = "standing omissions: "
const RETENTION_REPORT_KEY = "retention"
const RETENTION_POOL_FIELD = "pool"
const RETENTION_REASONS_FIELD = "reasons"
const RETENTION_FAULT_SHIFT_FIELD = "faultShieldedShiftMessages"
const OMISSIONS_TOOL_OUTPUTS_LABEL = "tool outputs"
const OMISSIONS_REASONING_BLOCKS_LABEL = "reasoning blocks"
const OMISSIONS_FENCED_BLOCKS_LABEL = "fenced blocks"
const OMISSIONS_RELOAD_LEAD = "; reload via "
const STASH_ATTACHMENTS_LEAD = "attachments evicted with this output"
const STASH_ATTACHMENT_DROPPED_TAIL = "payloads were dropped during eviction; re-run the tool to regenerate them"
const UNKNOWN_ATTACHMENT_MIME_LABEL = "unknown mime"
const FENCE_STASH_TOOL_LABEL = "fence"
const FENCE_BACKTICK = "`"
const MIN_FENCE_MARKER_TICKS = 3
// CommonMark: a line indented four or more spaces is indented code, never a fence.
const MAX_FENCE_INDENT_SPACES = 3
const FENCE_INDENT_SPACE = " "
const FENCE_INFO_SEPARATOR = /\s+/
const USER_MESSAGE_ROLE = "user"

type EvictableEntry = {
  stateRef: { output: string; attachments?: unknown }
  tool: string
  msgIndex: number
  partIndex: number
  lastTouch: number
  bytes: number
  attachmentBytes: number
  subjects: Subject[]
}

// The instance-level downgrade-refusal fact, the PruneThrottle pattern: one
// flag per plugin process, set the first time any walk of the store (the
// recall walk or the writer's pre-rename walk) classifies a line whose
// schema version is newer than this build's, and never cleared, so the
// process stops managing the store for its remaining lifetime.
type PageStoreGuard = { newerSchemaObserved: boolean }

// One parsed store line's relation to this build's schema version: absent
// or equal admits the line under the current shape, strictly greater is a
// newer writer's line this build must never interpret, and anything else is
// corruption the existing invalid-line skip covers.
type PageStoreSchemaVerdict =
  | { kind: "admissible" }
  | { kind: "invalid" }
  | { kind: "newer"; observed: number }

type StatsSource = {
  options: ResolvedOptions
  limits: Map<string, ContextLimitEntry>
  modelKeys: Map<string, string | undefined>
  pageStores: PageStoreBySession
  metrics: MetricsStore
}

type RetainedDuplicate = { msgIndex: number; tool: string; supersedes: boolean }

type RetainedFileDuplicate = { msgIndex: number; label: string }

type DedupTarget = { stateRef: { output: string; attachments?: unknown }; tool: string; input: Record<string, unknown> }

type DedupOutcome = { tombstones: number; tombstonedPairs: DedupedPairBytes[] }

type PageStoreBySession = Map<string, SessionPageStore>

const dedupKeyOf = (tool: string, input: Record<string, unknown>): string => JSON.stringify([tool, stableStringify(input)])

// A reasoning part's stable identity: its own text and metadata, keyed the
// same way the dedup pass keys tool inputs, so identity survives the
// transform's repeated passes over the stored message list.
const reasoningIdentityOf = (text: unknown, metadata: unknown): string =>
  JSON.stringify([stableStringify(text), stableStringify(metadata)])

const buildDedupTombstone = (tool: string, msgIndex: number): string =>
  `${DEDUP_MARKER} ${tool} ${DEDUP_SUPERSEDED_LEAD} ${msgIndex}`

const dedupTargetOf = (part: Record<string, unknown>): DedupTarget | undefined => {
  const outputRef = completedOutputOf(part)
  if (outputRef === undefined) return undefined
  if (startsWithEitherGeneration(outputRef.output, EVICTION_MARKER, LEGACY_EVICTION_MARKER) || startsWithEitherGeneration(outputRef.output, DEDUP_MARKER, LEGACY_DEDUP_MARKER)) return undefined
  const tool = part["tool"]
  if (typeof tool !== "string") return undefined
  const typedState = part["state"] as Record<string, unknown>
  const input = typeof typedState["input"] === "object" && typedState["input"] !== null ? (typedState["input"] as Record<string, unknown>) : {}
  return { stateRef: outputRef, tool, input }
}

const deduplicateToolOutputs = (messages: MessageBundle[], options: ResolvedOptions): DedupOutcome => {
  const retainedByKey = new Map<string, RetainedDuplicate>()
  let tombstones = 0
  const tombstonedPairs: DedupedPairBytes[] = []
  for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex -= 1) {
    for (const part of messages[msgIndex].parts) {
      const target = dedupTargetOf(part)
      if (target === undefined) continue
      const key = dedupKeyOf(target.tool, target.input)
      const retained = retainedByKey.get(key)
      if (retained === undefined) {
        retainedByKey.set(key, {
          msgIndex,
          tool: target.tool,
          supersedes: target.stateRef.output.length >= options.minEvictableBytes,
        })
        continue
      }
      if (retained.supersedes) {
        const supersededBytes = target.stateRef.output.length + attachmentPayloadCharsOf(target.stateRef)
        target.stateRef.output = buildDedupTombstone(retained.tool, retained.msgIndex)
        stripStateAttachments(target.stateRef)
        tombstones += 1
        tombstonedPairs.push({ key, bytes: supersededBytes })
      }
    }
  }
  return { tombstones, tombstonedPairs }
}

const fileDedupKeyOf = (file: FilePartFields): string => JSON.stringify([file.mime, file.url])

const fileDedupLabelOf = (file: FilePartFields): string => (file.filename.length > 0 ? file.filename : file.mime)

const buildFileDedupTombstone = (label: string, msgIndex: number): string =>
  `${DEDUP_MARKER} ${label} ${DEDUP_FILE_SUPERSEDED_LEAD} ${msgIndex}`

const deduplicateFileAttachments = (messages: MessageBundle[], options: ResolvedOptions): DedupOutcome => {
  const retainedByKey = new Map<string, RetainedFileDuplicate>()
  const hotFromIndex = hotFromIndexOf(messages, options)
  let tombstones = 0
  const tombstonedPairs: DedupedPairBytes[] = []
  for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex -= 1) {
    const messageParts = messages[msgIndex].parts
    for (let partIndex = messageParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const file = filePartOf(messageParts[partIndex])
      if (file === undefined) continue
      const key = fileDedupKeyOf(file)
      const retained = retainedByKey.get(key)
      if (retained === undefined) {
        retainedByKey.set(key, { msgIndex, label: fileDedupLabelOf(file) })
        continue
      }
      if (msgIndex >= hotFromIndex) continue
      messageParts[partIndex] = { type: TEXT_PART_TYPE, text: buildFileDedupTombstone(retained.label, retained.msgIndex) }
      tombstones += 1
      tombstonedPairs.push({ key, bytes: 0 })
    }
  }
  // A file part's payload size is not observable from its url, so file dedup
  // contributes tombstones whose pairs carry no bytes to the unique estimate.
  return { tombstones, tombstonedPairs }
}

type RangeReadWindow = { msgIndex: number; stateRef: { output: string }; range: SubjectRange }

type RangeCollapseOutcome = { collapsed: number; collapsedBytes: number }

const rangeContains = (outer: SubjectRange, inner: SubjectRange): boolean =>
  outer.start <= inner.start && outer.end >= inner.end

// The window a read carried is recoverable from its input's offset and
// limit; a read without both is not a range read and never collapses.
const rangeWindowOf = (part: Record<string, unknown>): { range: SubjectRange; stateRef: { output: string }; path: string | undefined } | undefined => {
  if (part["type"] !== "tool" || part["tool"] !== READ_TOOL_NAME) return undefined
  const state = part["state"]
  if (typeof state !== "object" || state === null) return undefined
  const typedState = state as Record<string, unknown>
  if (typedState["status"] !== "completed" || typeof typedState["output"] !== "string") return undefined
  if (startsWithEitherGeneration(typedState["output"], EVICTION_MARKER, LEGACY_EVICTION_MARKER) || startsWithEitherGeneration(typedState["output"], DEDUP_MARKER, LEGACY_DEDUP_MARKER)) return undefined
  const input = typeof typedState["input"] === "object" && typedState["input"] !== null ? (typedState["input"] as Record<string, unknown>) : {}
  // Malformed ranges never become windows: a non-integer, negative, or
  // empty range cannot be compared for containment meaningfully. The guards
  // live here, not in rangeOf, which subjectsOf shares and whose subject
  // rendering tolerates odd values.
  const range = rangeOf(input)
  if (range === undefined) return undefined
  if (Number.isInteger(range.start) === false || Number.isInteger(range.end) === false) return undefined
  if (range.start < 0 || range.end <= range.start) return undefined
  const path = PATH_INPUT_KEYS.map((key) => input[key]).find((value) => typeof value === "string" && value.length > 0)
  return { range, stateRef: typedState as { output: string }, path: typeof path === "string" ? path : undefined }
}

// Range reads of one file fragment its content into standing windows dedup
// cannot see: every distinct offset/limit pair is a distinct key, so the
// same file is paid for once per window on every request. This pass
// tombstones a contained window exactly the way file-part dedup tombstones
// a superseded part: walking newest first, a read whose [start, end) range
// is fully contained in a strictly newer retained read's range of the same
// path becomes a text tombstone naming the retained read's message.
// Containment only: merely overlapping or merely contiguous windows are
// left alone because a contained window provably adds no unique lines,
// while an overlap may carry lines the retained window lacks, so
// collapsing it would drop context the model paid for and received. The
// discipline mirrors dedup: reads inside the recent window never
// collapse, outputs under minEvictableBytes never collapse, and
// already-tombstoned outputs never collapse.

// One planned collapse: the message and part slots to overwrite and the
// tombstone to write there. The plan phase never mutates, so the batched
// cadence can detect the pass's trigger by planning alone and a fire can
// apply the recorded edits later; detection reads only each candidate's
// own part, so planning and applying in two phases lands the same list as
// mutating in the walk.
type RangeCollapseEdit = { msgIndex: number; partIndex: number; replacement: Record<string, unknown> }

type RangeCollapsePlan = { edits: RangeCollapseEdit[]; collapsed: number; collapsedBytes: number }

const planRangeCollapse = (messages: MessageBundle[], options: ResolvedOptions): RangeCollapsePlan => {
  const hotFromIndex = hotFromIndexOf(messages, options)
  const retainedByPath = new Map<string, RangeReadWindow>()
  const edits: RangeCollapseEdit[] = []
  let collapsed = 0
  let collapsedBytes = 0
  for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex -= 1) {
    const messageParts = messages[msgIndex].parts
    for (let partIndex = messageParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const window = rangeWindowOf(messageParts[partIndex])
      if (window === undefined || window.path === undefined) continue
      const retained = retainedByPath.get(window.path)
      if (retained === undefined) {
        retainedByPath.set(window.path, { msgIndex, stateRef: window.stateRef, range: window.range })
        continue
      }
      if (rangeContains(retained.range, window.range) === false) continue
      if (msgIndex >= hotFromIndex) continue
      if (window.stateRef.output.length < options.minEvictableBytes) continue
      collapsedBytes += window.stateRef.output.length
      edits.push({
        msgIndex,
        partIndex,
        replacement: {
          type: TEXT_PART_TYPE,
          text: `${DEDUP_MARKER} ${READ_TOOL_NAME} ${renderSubject({ path: window.path, range: window.range })} ${DEDUP_RANGE_SUPERSEDED_LEAD} ${retained.msgIndex} (${renderSubject({ path: window.path, range: retained.range })})`,
        },
      })
      collapsed += 1
    }
  }
  return { edits, collapsed, collapsedBytes }
}

const applyRangeCollapse = (messages: MessageBundle[], plan: RangeCollapsePlan): void => {
  for (const edit of plan.edits) messages[edit.msgIndex].parts[edit.partIndex] = edit.replacement
}

// At-birth tool-output hygiene, applied by tool.execute.after so the
// rewrite persists into session storage: strips the same CSI/OSC spans
// the composition walk counts (the shared ESCAPE_SPAN_PATTERN), collapses
// carriage-return progress lines to their final segment within each
// newline-delimited line (a \r that closes a line as CRLF, or sits at end
// of output, is a line ending and is carried through untouched), and
// trims trailing whitespace runs per line (leading whitespace stays). The
// candidate scan over-approximates what the three passes can change (any
// escape introducer, any carriage return, any trimmable line-ending
// whitespace), so nothing strippable is missed; a clean output costs one
// scan and zero writes, and the original string reference passes through
// when the pipeline would be a no-op.
const HYGIENE_CANDIDATE_PATTERN = /\x1b|\r|[ \t](?=\n|$)/
const TRAILING_WHITESPACE_RUN_PATTERN = /[ \t]+$/
const stripTerminalNoiseFrom = (output: string): string => {
  if (HYGIENE_CANDIDATE_PATTERN.test(output) === false) return output
  const lines = output.replace(ESCAPE_SPAN_PATTERN, "").split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    // A trailing \r on a split line was followed by \n (a CRLF terminator)
    // or sat at end of output; both are line endings rather than progress
    // markers, so they are carried through untouched. Splitting on \n
    // erases the lookahead that would distinguish them, hence the
    // endswith check.
    let line = lines[index]
    let carriageReturnTerminator = ""
    if (line.endsWith("\r")) {
      carriageReturnTerminator = "\r"
      line = line.slice(0, -1)
    }
    const latestCarriageReturn = line.lastIndexOf("\r")
    const collapsed = latestCarriageReturn === -1 ? line : line.slice(latestCarriageReturn + 1)
    lines[index] = collapsed.replace(TRAILING_WHITESPACE_RUN_PATTERN, "") + carriageReturnTerminator
  }
  const stripped = lines.join("\n")
  return stripped === output ? output : stripped
}

// The one purge-candidate decision the pass and its batched-cadence
// trigger scan share, so the two sites cannot drift: an errored tool
// part's state whose input has not been scrubbed yet.
const unpurgedErroredToolStateOf = (part: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (part["type"] !== "tool") return undefined
  const state = part["state"]
  if (typeof state !== "object" || state === null) return undefined
  const typedState = state as Record<string, unknown>
  if (typedState["status"] !== "error") return undefined
  if (typedState["input"] === PURGED_INPUT_MARKER || typedState["input"] === LEGACY_PURGED_INPUT_MARKER) return undefined
  return typedState
}

const purgeErroredToolInputs = (messages: MessageBundle[], options: ResolvedOptions): number => {
  const hotFromIndex = hotFromIndexOf(messages, options)
  let purged = 0
  for (let msgIndex = 0; msgIndex < hotFromIndex; msgIndex += 1) {
    for (const part of messages[msgIndex].parts) {
      const erroredState = unpurgedErroredToolStateOf(part)
      if (erroredState === undefined) continue
      erroredState["input"] = PURGED_INPUT_MARKER
      purged += 1
    }
  }
  return purged
}

// The pass's batched-cadence trigger: whether a purge would mutate, early
// exiting on the first candidate so a deferred run pays one scan.
const hasErroredToolInputToPurge = (messages: MessageBundle[], options: ResolvedOptions): boolean => {
  const hotFromIndex = hotFromIndexOf(messages, options)
  for (let msgIndex = 0; msgIndex < hotFromIndex; msgIndex += 1) {
    for (const part of messages[msgIndex].parts) {
      if (unpurgedErroredToolStateOf(part) !== undefined) return true
    }
  }
  return false
}

// Message indices are unstable across runs: opencode trims stored messages,
// and the recent window rides the tail, so a part is identified by its own
// content (text plus metadata, stringified with the same stable stringify
// the dedup pass keys inputs by) rather than by a msgIndex cursor like the
// touch watermark. A part counts unique the first run its identity is seen
// outside the retention age, and identical-content occurrences count once.
// The seen-set lives on the session's metrics entry, whose lifetime bounds
// the memory: the entry can be evicted from the metrics store and reseeded
// within one process, re-counting that session's standing set once per
// entry lifetime; unique can therefore exceed the entry's own cumulative
// count after a reseed but never the session's true unique total. The
// seen-set is also bounded, so only a same-content reappearance after a
// full bound worth of newer parts could count once more.
const expireAgedReasoning = (metrics: SessionMetrics, messages: MessageBundle[], options: ResolvedOptions): ReasoningExpiry => {
  const retentionFromIndex = retentionFromIndexOf(messages, options)
  let parts = 0
  let bytes = 0
  let unique = 0
  let uniqueBytes = 0
  for (let msgIndex = 0; msgIndex < retentionFromIndex; msgIndex += 1) {
    const messageParts = messages[msgIndex].parts
    for (let partIndex = messageParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = messageParts[partIndex]
      if (part["type"] !== REASONING_PART_TYPE) continue
      const text = part[REASONING_TEXT_KEY]
      const textChars = typeof text === "string" ? text.length : 0
      bytes += textChars
      const identity = reasoningIdentityOf(text, part[REASONING_METADATA_KEY])
      if (rememberUniqueKey(metrics.reasoningSeenKeys, identity, DEFAULT_REMEMBERED_REASONING_PARTS)) {
        unique += 1
        uniqueBytes += textChars
      }
      messageParts.splice(partIndex, 1)
      parts += 1
    }
  }
  return { parts, bytes, unique, uniqueBytes }
}

// The pass's batched-cadence trigger: whether an expiry would mutate,
// early exiting on the first reasoning part past the retention boundary.
const hasAgedReasoningToExpire = (messages: MessageBundle[], options: ResolvedOptions): boolean => {
  const retentionFromIndex = retentionFromIndexOf(messages, options)
  for (let msgIndex = 0; msgIndex < retentionFromIndex; msgIndex += 1) {
    for (const part of messages[msgIndex].parts) {
      if (part["type"] === REASONING_PART_TYPE) return true
    }
  }
  return false
}

const stripLegacyHintParts = (messages: MessageBundle[]): void => {
  for (const message of messages) {
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      const text = part["text"]
      if (part["type"] === TEXT_PART_TYPE && typeof text === "string" && startsWithEitherGeneration(text, HINT_LINE_PREFIX, LEGACY_HINT_LINE_PREFIX)) {
        message.parts.splice(partIndex, 1)
      }
    }
  }
}

type FenceSpan = { startLine: number; endLine: number; language: string | undefined }

type FenceReplacement = { startOffset: number; endOffset: number; replacement: string; bytes: number }

const leadingBackticksOf = (line: string): number => {
  let ticks = 0
  while (line.charAt(ticks) === FENCE_BACKTICK) ticks += 1
  return ticks
}

const fenceLineWithinIndentOf = (rawLine: string): string | undefined => {
  let spaces = 0
  while (rawLine.charAt(spaces) === FENCE_INDENT_SPACE) spaces += 1
  if (spaces > MAX_FENCE_INDENT_SPACES) return undefined
  return rawLine.slice(spaces)
}

const fenceLanguageOf = (info: string): string => info.split(FENCE_INFO_SEPARATOR)[0]

const fenceOpenerOf = (rawLine: string): { ticks: number; language: string | undefined } | undefined => {
  const line = fenceLineWithinIndentOf(rawLine)
  if (line === undefined) return undefined
  const ticks = leadingBackticksOf(line)
  if (ticks < MIN_FENCE_MARKER_TICKS) return undefined
  const info = line.slice(ticks).trim()
  // CommonMark: an info string holding a backtick never opens a fence, so
  // the line is content and can neither start a block nor be evicted as one.
  if (info.includes(FENCE_BACKTICK)) return undefined
  return { ticks, language: info.length > 0 ? fenceLanguageOf(info) : undefined }
}

const isFenceCloser = (rawLine: string, openerTicks: number): boolean => {
  const line = fenceLineWithinIndentOf(rawLine)
  if (line === undefined) return false
  const ticks = leadingBackticksOf(line)
  return ticks >= openerTicks && line.slice(ticks).trim().length === 0
}

const fenceSpansIn = (lines: string[]): FenceSpan[] => {
  const spans: FenceSpan[] = []
  let openLine = -1
  let openTicks = 0
  let language: string | undefined
  for (let index = 0; index < lines.length; index += 1) {
    if (openLine === -1) {
      const opener = fenceOpenerOf(lines[index])
      if (opener === undefined) continue
      openLine = index
      openTicks = opener.ticks
      language = opener.language
      continue
    }
    if (isFenceCloser(lines[index], openTicks)) {
      spans.push({ startLine: openLine, endLine: index, language })
      openLine = -1
    }
  }
  return spans
}

const lineStartsOf = (text: string): number[] => {
  const starts = [0]
  let index = text.indexOf("\n")
  while (index !== -1) {
    starts.push(index + 1)
    index = text.indexOf("\n", index + 1)
  }
  return starts
}

const fenceFirstNonEmptyLineOf = (lines: string[], startLine: number, endLine: number): string | undefined => {
  for (let index = startLine + 1; index < endLine; index += 1) {
    const trimmed = lines[index].trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

const evictLargeUserFences = (messages: MessageBundle[], options: ResolvedOptions, pageStore: SessionPageStore, pageStoreEntries: PageEntry[]): FenceEviction => {
  if (options.userFenceEviction.enabled === false) return { blocks: 0, bytes: 0, pagesDropped: 0 }
  const hotFromIndex = hotFromIndexOf(messages, options)
  const { minBlockLines } = options.userFenceEviction
  let blocks = 0
  let bytes = 0
  let pagesDropped = 0
  for (let msgIndex = 0; msgIndex < hotFromIndex; msgIndex += 1) {
    const message = messages[msgIndex]
    if (message.info.role !== USER_MESSAGE_ROLE) continue
    for (let partIndex = 0; partIndex < message.parts.length; partIndex += 1) {
      const part = message.parts[partIndex]
      if (part["type"] !== TEXT_PART_TYPE) continue
      const text = part["text"]
      if (typeof text !== "string") continue
      const lines = text.split("\n")
      let lineStarts: number[] | undefined
      const plans: FenceReplacement[] = []
      for (const span of fenceSpansIn(lines)) {
        const contentLines = span.endLine - span.startLine - 1
        if (contentLines <= minBlockLines) continue
        const firstLine = fenceFirstNonEmptyLineOf(lines, span.startLine, span.endLine)
        if (firstLine === undefined) continue
        if (lineStarts === undefined) lineStarts = lineStartsOf(text)
        const startOffset = lineStarts[span.startLine]
        const endOffset = span.endLine + 1 < lineStarts.length ? lineStarts[span.endLine + 1] : text.length
        const blockText = text.slice(startOffset, endOffset)
        const subject = boundedSingleLineOf(firstLine)
        const tombstone = buildFenceTombstone(span.language, contentLines, subject)
        const stored: PageEntry = {
          output: blockText,
          tool: FENCE_STASH_TOOL_LABEL,
          subject,
          msgIndex,
          partIndex,
          stashSlot: span.startLine,
        }
        pagesDropped += storeEvictedPage(pageStore, stored, options.stashLimit)
        pageStoreEntries.push(stored)
        plans.push({
          startOffset,
          endOffset,
          replacement: blockText.endsWith("\n") ? `${tombstone}\n` : tombstone,
          bytes: blockText.length,
        })
        blocks += 1
      }
      if (plans.length === 0) continue
      let updated = text
      for (let index = plans.length - 1; index >= 0; index -= 1) {
        const plan = plans[index]
        updated = `${updated.slice(0, plan.startOffset)}${plan.replacement}${updated.slice(plan.endOffset)}`
        bytes += plan.bytes
      }
      part["text"] = updated
    }
  }
  return { blocks, bytes, pagesDropped }
}

const pageKeyOf = (tool: string, subject: string, msgIndex: number, partIndex: number, stashSlot?: number): string =>
  `${tool}:${subject}:${msgIndex}:${partIndex}${stashSlot === undefined ? "" : `:${stashSlot}`}`

const pagesForSession = (pageStores: PageStoreBySession, sessionKey: string, sessionBound: number): SessionPageStore => {
  const touched = touchMapEntry(pageStores, sessionKey)
  if (touched !== undefined) return touched
  trimMapToBound(pageStores, sessionBound)
  const created: SessionPageStore = new Map()
  pageStores.set(sessionKey, created)
  return created
}

const trimPages = (pageStore: SessionPageStore, limit: number): number => {
  let dropped = 0
  while (pageStore.size > limit) {
    const oldest = pageStore.keys().next()
    if (oldest.done === true) break
    pageStore.delete(oldest.value)
    dropped += 1
  }
  return dropped
}

const storeEvictedPage = (pageStore: SessionPageStore, entry: PageEntry, limit: number): number => {
  pageStore.set(pageKeyOf(entry.tool, entry.subject, entry.msgIndex, entry.partIndex, entry.stashSlot), entry)
  return trimPages(pageStore, limit)
}

const pageMissTextFor = (subject: string): string =>
  `${STASH_MARKER} ${STASH_MISS_LEAD} "${subject}"; ${STASH_MISS_HINT}.`

const pageStoreOccupancyLineFor = (pageStore: SessionPageStore): string => {
  if (pageStore.size === 0) return `${STASH_MARKER} ${STASH_OCCUPANCY_LEAD} ${STASH_OCCUPANCY_EMPTY_TAIL}.`
  const categoryCounts = new Map<string, number>()
  const subjects = new Set<string>()
  let oldest = Number.POSITIVE_INFINITY
  let newest = Number.NEGATIVE_INFINITY
  for (const entry of pageStore.values()) {
    categoryCounts.set(entry.tool, (categoryCounts.get(entry.tool) ?? 0) + 1)
    subjects.add(entry.subject)
    oldest = Math.min(oldest, entry.msgIndex)
    newest = Math.max(newest, entry.msgIndex)
  }
  const categories = [...categoryCounts.keys()].sort()
  const shown = categories.slice(0, MAX_OCCUPANCY_CATEGORIES)
  const overflowCount = categories.length - shown.length
  const categoryList = shown
    .map((tool) => `${tool} ${categoryCounts.get(tool)}`)
    .concat(overflowCount > 0 ? `+${overflowCount} ${STASH_OCCUPANCY_OVERFLOW_LABEL}` : [])
    .join(STASH_OCCUPANCY_CATEGORY_SEPARATOR)
  const range =
    pageStore.size === 1
      ? `${STASH_MESSAGE_LABEL} ${oldest}`
      : `${STASH_OCCUPANCY_RANGE_OLDEST_LABEL} ${STASH_MESSAGE_LABEL} ${oldest}, ${STASH_OCCUPANCY_RANGE_NEWEST_LABEL} ${STASH_MESSAGE_LABEL} ${newest}`
  const entryNoun = pageStore.size === 1 ? STASH_OCCUPANCY_ENTRY_LABEL : STASH_OCCUPANCY_ENTRIES_LABEL
  const subjectNoun = subjects.size === 1 ? STASH_OCCUPANCY_SUBJECT_LABEL : STASH_OCCUPANCY_SUBJECTS_LABEL
  return `${STASH_MARKER} ${STASH_OCCUPANCY_LEAD} ${pageStore.size} ${entryNoun} across ${subjects.size} ${subjectNoun}: ${categoryList}; ${range}.`
}

const invalidSubjectTextFor = (received: string): string =>
  `${STASH_MARKER} ${RECALL_TOOL_NAME} ${STASH_INVALID_SUBJECT_LEAD} (${RECEIVED_LABEL} ${received}).`

const olderMatchesLineFor = (subject: string, older: PageEntry[]): string =>
  `${STASH_MARKER} ${STASH_OLDER_LEAD} "${subject}": ${older
    .map((entry) => `${entry.tool} ${STASH_MESSAGE_LABEL} ${entry.msgIndex}`)
    .join(STASH_MATCH_SEPARATOR)}`

const pageMatchesFor = (pageStore: SessionPageStore, subject: string): PageEntry[] => {
  const matches: PageEntry[] = []
  for (const entry of pageStore.values()) {
    if (entry.subject === subject) matches.push(entry)
  }
  return matches
}

const attachmentSummaryOf = (attachment: unknown): string => {
  const fields = typeof attachment === "object" && attachment !== null ? (attachment as Record<string, unknown>) : {}
  const mime = fields[ATTACHMENT_MIME_KEY]
  const url = fields[ATTACHMENT_URL_KEY]
  const mimeLabel = typeof mime === "string" && mime.length > 0 ? mime : UNKNOWN_ATTACHMENT_MIME_LABEL
  const uriChars = typeof url === "string" ? url.length : 0
  return `${mimeLabel} data URI ${uriChars} chars`
}

const pageAttachmentsLineFor = (attachments: unknown[]): string =>
  `${STASH_MARKER} ${STASH_ATTACHMENTS_LEAD}: ${attachments.map(attachmentSummaryOf).join(SUBJECT_SEPARATOR)}; ${STASH_ATTACHMENT_DROPPED_TAIL}.`

// The store's line shape, validated field by field: a line failing any
// required field is skipped (per-line tolerance, mirroring the log seeder's
// corrupt-line skip) rather than failing the whole read.
const pageStoreLineOf = (parsed: unknown): PageEntry | undefined => {
  if (!isRecord(parsed)) return undefined
  const output = parsed["output"]
  const tool = parsed["tool"]
  const subject = parsed["subject"]
  const msgIndex = parsed["msgIndex"]
  const partIndex = parsed["partIndex"]
  if (typeof output !== "string" || typeof tool !== "string" || typeof subject !== "string") return undefined
  if (typeof msgIndex !== "number" || typeof partIndex !== "number") return undefined
  const attachments = parsed["attachments"]
  if (attachments !== undefined && !Array.isArray(attachments)) return undefined
  const stashSlot = parsed["stashSlot"]
  if (stashSlot !== undefined && typeof stashSlot !== "number") return undefined
  return {
    output,
    tool,
    subject,
    msgIndex,
    partIndex,
    ...(stashSlot === undefined ? {} : { stashSlot }),
    ...(attachments === undefined ? {} : { attachments }),
  }
}

const pageStoreSchemaVerdictOf = (parsed: unknown): PageStoreSchemaVerdict => {
  const schemaVersion = isRecord(parsed) ? parsed["schemaVersion"] : undefined
  if (schemaVersion === undefined) return { kind: "admissible" }
  if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) return { kind: "invalid" }
  if (schemaVersion > PAGE_STORE_SCHEMA_VERSION) return { kind: "newer", observed: schemaVersion }
  if (schemaVersion === PAGE_STORE_SCHEMA_VERSION) return { kind: "admissible" }
  return { kind: "invalid" }
}

const pageStoreSchemaErrorFor = (observed: number | undefined): string =>
  observed === undefined
    ? `the page store holds lines from a newer schema version than this build's ${PAGE_STORE_SCHEMA_VERSION}; appends and rotation are halted to leave the newer store untouched`
    : `the page store holds schemaVersion ${observed} lines but this build writes ${PAGE_STORE_SCHEMA_VERSION}; appends and rotation are halted to leave the newer store untouched`

const recordPageStoreSchemaError = (
  metrics: MetricsStore,
  sessionKey: string,
  sessionBound: number,
  observed: number | undefined,
): void =>
  withSessionMetricsEntry(metrics, sessionKey, sessionBound, (entry) => {
    entry.pageStoreSchemaError ??= pageStoreSchemaErrorFor(observed)
  })

// The store's line loop, shared by the recall walk (classify and match in
// one pass) and the writer's pre-rename observation walk: read and parse
// failures degrade to visiting nothing, a corrupt or unreadable store being
// a clean outcome, never a thrown error.
const pageStoreParsedLines = async (options: ResolvedOptions, visit: (parsed: unknown) => void): Promise<void> => {
  let content: string
  try {
    content = await readFile(options.pageStorePath, "utf8")
  } catch {
    return
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    visit(parsed)
  }
}

// The observation side effect both walks share: a newer-schema line sets
// the instance guard permanently and records the observing session's
// diagnostic, the message keeping the first observed version.
const observePageStoreSchemaVerdict = (
  verdict: PageStoreSchemaVerdict,
  guard: PageStoreGuard,
  metrics: MetricsStore,
  sessionKey: string,
  sessionBound: number,
): void => {
  if (verdict.kind !== "newer") return
  guard.newerSchemaObserved = true
  recordPageStoreSchemaError(metrics, sessionKey, sessionBound, verdict.observed)
}

// Cross-session pages for one subject, read fresh per miss (misses are the
// rare path) in file order, so the last matching line is the newest page.
// Any read or parse failure degrades to no pages: a corrupt or unreadable
// store is a clean miss, never a thrown tool error. The same pass classifies
// each line's schema version: newer-version lines are skipped uninterpreted
// and flip the instance guard, so this process's writer halts before it can
// bury them.
const pageStoreMatchesFor = async (
  options: ResolvedOptions,
  subject: string,
  guard: PageStoreGuard,
  metrics: MetricsStore,
  sessionKey: string,
): Promise<PageEntry[]> => {
  if (options.pageStore === false) return []
  const matches: PageEntry[] = []
  await pageStoreParsedLines(options, (parsed) => {
    const verdict = pageStoreSchemaVerdictOf(parsed)
    observePageStoreSchemaVerdict(verdict, guard, metrics, sessionKey, options.metricsSessions)
    if (verdict.kind !== "admissible") return
    const entry = pageStoreLineOf(parsed)
    if (entry !== undefined && entry.subject === subject) matches.push(entry)
  })
  return matches
}

// The writer's rotation-time observation walk, run immediately before the
// rotation rename so the sole burying operation can never fire unobserved:
// an instance that only evicts and never runs an observing recall still
// halts at its next rotation boundary instead of renaming a newer build's
// pages out of every reader's reach.
const pageStoreWalkObservesNewerSchema = async (
  options: ResolvedOptions,
  guard: PageStoreGuard,
  metrics: MetricsStore,
  sessionKey: string,
): Promise<boolean> => {
  let observed = false
  await pageStoreParsedLines(options, (parsed) => {
    const verdict = pageStoreSchemaVerdictOf(parsed)
    observePageStoreSchemaVerdict(verdict, guard, metrics, sessionKey, options.metricsSessions)
    if (verdict.kind === "newer") observed = true
  })
  return observed
}

const pageStoreOlderLineFor = (subject: string, count: number): string =>
  `${STASH_MARKER} ${PAGE_STORE_OLDER_LEAD} "${subject}": ${count}.`

const pageStoreMissLineFor = (subject: string): string => `${STASH_MARKER} ${PAGE_STORE_MISS_LEAD} "${subject}".`

const missResponseFor = (subject: string, pageStore: SessionPageStore | undefined): string =>
  `${pageMissTextFor(subject)}\n${pageStoreOccupancyLineFor(pageStore ?? new Map())}\n${pageStoreMissLineFor(subject)}`

// The counts-only summary a probe hit returns: match counts and sizes read
// straight off the matches the full reload would walk, no content copied.
const probeCountsLineFor = (subject: string, inSessionMatches: number, pageStoreMatches: number, matches: PageEntry[]): string => {
  const newest = matches[matches.length - 1]
  return `${STASH_MARKER} ${RECALL_PROBE_LEAD} "${subject}": ${RECALL_PROBE_IN_SESSION_LABEL} ${inSessionMatches}, ${RECALL_PROBE_PAGE_STORE_LABEL} ${pageStoreMatches}, ${RECALL_PROBE_NEWEST_LABEL} ${newest.output.length} ${RECALL_PROBE_BYTES_UNIT}, ${RECALL_PROBE_OLDER_LABEL} ${matches.length - 1}, ${RECALL_PROBE_ATTACHMENTS_LABEL}: ${newest.attachments !== undefined}.`
}

const executeReadEvicted = async (
  pageStores: PageStoreBySession,
  metrics: MetricsStore,
  hydrations: MetricsHydration,
  persistedTotalsForSession: (sessionKey: string) => Promise<PersistedTotals | undefined>,
  metricsSessionBound: number,
  options: ResolvedOptions,
  args: unknown,
  toolContext: unknown,
  pageStoreGuard: PageStoreGuard,
): Promise<string> => {
  const source = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : undefined
  const subject = source?.[RECALL_ARG_NAME]
  if (typeof subject !== "string" || subject.length === 0) return invalidSubjectTextFor(typeof subject)
  const countsOnly = source?.[RECALL_PROBE_ARG_NAME] === true
  const sessionKey = sessionKeyFromContext(toolContext)
  const pageStore = pageStores.get(sessionKey)
  const matches = pageStore === undefined ? [] : pageMatchesFor(pageStore, subject)
  if (matches.length === 0) {
    const pages = await pageStoreMatchesFor(options, subject, pageStoreGuard, metrics, sessionKey)
    if (pages.length === 0) {
      // The probe's miss answers exactly today's miss text without the
      // hydration await or the recallMisses increment, so counters and
      // hydration stay untouched; the walk above can still observe a
      // newer-schema line, which is the refusal contract firing, not a
      // probe leak into eviction ordering.
      if (countsOnly) return missResponseFor(subject, pageStore)
      // A first-touch hydration may still be seeding this session: await it
      // so the miss lands on the settled entry instead of vanishing with the
      // entry the seed replaces.
      const inFlight = hydrations.get(sessionKey)
      if (inFlight !== undefined) await inFlight.promise
      const existing = metrics.get(sessionKey)
      if (existing !== undefined) existing.recallMisses += 1
      return missResponseFor(subject, pageStore)
    }
    // The probe returns before the recall hit increment and the fault
    // record: fault counts feed the eviction sort key through
    // faultAdjustedLastTouchOf, so probe side effects would leak into
    // eviction ordering.
    if (countsOnly) return probeCountsLineFor(subject, 0, pages.length, pages)
    // A page-store hit counts and fault-protects exactly like an in-session
    // hit: the reload is the same event to the eviction policy.
    const sessionMetrics = await metricsForSession(metrics, hydrations, persistedTotalsForSession, sessionKey, metricsSessionBound)
    sessionMetrics.recallHits += 1
    rememberFaultForSubject(sessionMetrics.faultCounts, subject, DEFAULT_REMEMBERED_FAULT_SUBJECTS)
    const newest = pages[pages.length - 1]
    const olderCount = pages.length - 1
    const restored = `${newest.output}\n${PAGE_STORE_RESTORED_LINE}`
    const withOlder = olderCount === 0 ? restored : `${restored}\n${pageStoreOlderLineFor(subject, olderCount)}`
    return newest.attachments === undefined ? withOlder : `${withOlder}\n${pageAttachmentsLineFor(newest.attachments)}`
  }
  if (countsOnly) return probeCountsLineFor(subject, matches.length, 0, matches)
  // Refreshed before the await so the hit counts even if stash churn during
  // the hydration read evicts this session's stash entry.
  touchMapEntry(pageStores, sessionKey)
  const sessionMetrics = await metricsForSession(metrics, hydrations, persistedTotalsForSession, sessionKey, metricsSessionBound)
  sessionMetrics.recallHits += 1
  rememberFaultForSubject(sessionMetrics.faultCounts, subject, DEFAULT_REMEMBERED_FAULT_SUBJECTS)
  const newest = matches[matches.length - 1]
  const older = matches.slice(0, -1)
  const output = older.length === 0 ? newest.output : `${newest.output}\n${olderMatchesLineFor(subject, older)}`
  return newest.attachments === undefined ? output : `${output}\n${pageAttachmentsLineFor(newest.attachments)}`
}

// The persistent half of the stash: every entry the evictor stashed this run
// becomes one JSONL line beside the metrics log, so a later session's
// recall can reload an original its own in-memory stash never held.
// Same discipline as the hygiene copy: rotation through the generic helper,
// one append per run, a failed write surfaced as pageStoreWriteError on the
// session's diagnostics without ever blocking the eviction, and both the
// feature switch and a cap of 0 disabling writes entirely.
const recordPageStoreLines = async (
  options: ResolvedOptions,
  metrics: MetricsStore,
  sessionKey: string,
  entries: PageEntry[],
  pageStoreGuard: PageStoreGuard,
): Promise<void> => {
  if (options.pageStore === false || entries.length === 0) return
  if (options.pageStoreRotationMaxBytes === METRICS_ROTATION_DISABLED_MAX_BYTES) return
  // The downgrade refusal: once this instance has observed a newer-schema
  // line, both the append and the rotation halt, so this older build can
  // neither bury newer lines into the .1 generation nor mix its own older
  // writes into the newer build's store. The diagnostic lands on the
  // evicting session even when another session's recall set the guard, so
  // an evict-only session still learns why its pages stopped persisting.
  if (pageStoreGuard.newerSchemaObserved) {
    recordPageStoreSchemaError(metrics, sessionKey, options.metricsSessions, undefined)
    return
  }
  // One clock read per run: the lines a single eviction produced share one
  // timestamp instead of drifting across the walk.
  const ts = new Date(options.now()).toISOString()
  try {
    const pageStoreJsonLine = `${entries
      .map((entry) =>
        JSON.stringify({
          ts,
          schemaVersion: PAGE_STORE_SCHEMA_VERSION,
          session: sessionKey,
          tool: entry.tool,
          subject: entry.subject,
          msgIndex: entry.msgIndex,
          partIndex: entry.partIndex,
          ...(entry.stashSlot === undefined ? {} : { stashSlot: entry.stashSlot }),
          output: entry.output,
          ...(entry.attachments === undefined ? {} : { attachments: entry.attachments }),
        }),
      )
      .join("\n")}\n`
    // The schema-classification walk rides the rotation boundary only: it
    // runs exactly when a rename is about to fire, so the sole burying
    // operation can never fire unobserved while ordinary appends pay one
    // size stat instead of a full-store walk. The pending line is not yet
    // in the file, so the walk sees exactly what a rename would bury, and
    // an observation stops the run before either half fires.
    const incomingBytes = Buffer.byteLength(pageStoreJsonLine)
    if (await logRotationIsDue(options.pageStorePath, incomingBytes, options.pageStoreRotationMaxBytes)) {
      if (await pageStoreWalkObservesNewerSchema(options, pageStoreGuard, metrics, sessionKey)) return
      await rotateMetricsLogPastCap(options.pageStorePath, incomingBytes, options.pageStoreRotationMaxBytes)
    }
    await appendFile(options.pageStorePath, pageStoreJsonLine)
    const entry = touchMapEntry(metrics, sessionKey)
    if (entry !== undefined) delete entry.pageStoreWriteError
  } catch (error) {
    withSessionMetricsEntry(metrics, sessionKey, options.metricsSessions, (target) => {
      target.pageStoreWriteError = error instanceof Error ? error.message : String(error)
    })
  }
}

// The effective eviction watermark in tokens: the absolute watermarkTokens
// option wins when set; otherwise the budget times the fractional
// watermark. The budget drives the fractional path only, so an absolute
// watermark can engage even where no budget was captured (unknown-budget
// runs otherwise stand eviction down entirely).
const effectiveWatermarkTokensOf = (contextLimitTokens: number | null, options: ResolvedOptions): number | null => {
  if (options.watermarkTokens !== undefined) return options.watermarkTokens
  if (contextLimitTokens === null) return null
  return contextLimitTokens * options.watermark
}

const executeStatsTool = (source: StatsSource, toolContext: unknown): string => {
  const sessionKey = sessionKeyFromContext(toolContext)
  const sessionID = sessionIDFromContext(toolContext)
  const sessionLimit = sessionID === undefined ? undefined : touchMapEntry(source.limits, sessionID)
  const metrics = touchMapEntry(source.metrics, sessionKey) ?? createSessionMetrics()
  const { contextLimit } = contextLimitForRun(sessionLimit, metrics.persistedBudget, sessionID === undefined ? undefined : source.modelKeys.get(sessionID), source.options)
  const pageStore = source.pageStores.get(sessionKey)
  const report = {
    session: sessionKey,
    options: {
      watermark: source.options.watermark,
      watermarkTokens: source.options.watermarkTokens ?? null,
      recentWindow: source.options.recentWindow,
      reasoningRetentionMessages: source.options.reasoningRetentionMessages,
      minEvictableBytes: source.options.minEvictableBytes,
      defaultContextTokens: source.options.defaultContextTokens ?? null,
      agedReadEvictionMessages: source.options.agedReadEvictionMessages ?? null,
      modelContextTokens: source.options.modelContextTokens,
      metricsLog: source.options.metricsLog,
      metricsPath: source.options.metricsPath,
      metricsRotationMaxBytes: source.options.metricsRotationMaxBytes,
      metricsMinLineIntervalMs: source.options.metricsMinLineIntervalMs,
      ingestionHygiene: source.options.ingestionHygiene,
      ingestionHygieneCopy: source.options.ingestionHygieneCopy,
      ingestionHygienePath: source.options.ingestionHygienePath,
      ingestionHygieneRotationMaxBytes: source.options.ingestionHygieneRotationMaxBytes,
      pageStore: source.options.pageStore,
      pageStorePath: source.options.pageStorePath,
      pageStoreRotationMaxBytes: source.options.pageStoreRotationMaxBytes,
      liveStateLog: source.options.liveStateLog,
      liveStatePath: source.options.liveStatePath,
      liveStatePruneMaxAgeMs: source.options.liveStatePruneMaxAgeMs,
      liveStatePruneMinIntervalMs: source.options.liveStatePruneMinIntervalMs,
      userFenceEviction: {
        enabled: source.options.userFenceEviction.enabled,
        minBlockLines: source.options.userFenceEviction.minBlockLines,
      },
      manualMode: source.options.manualMode,
      advisoryBand: source.options.advisoryBand,
      advisoryBandRatio: source.options.advisoryBandRatio,
      charsPerToken: source.options.charsPerToken,
      rememberedEvictedSubjects: source.options.rememberedEvictedSubjects,
      protectedTools: source.options.protectedTools,
      protectedPatterns: source.options.protectedPatternSources,
    },
    contextLimit: contextLimit.tokens,
    contextLimitSource: contextLimit.source,
    headroomTokens: contextLimit.tokens !== null && metrics.lastRun !== undefined ? contextLimit.tokens - metrics.lastRun.estimatedTokens : null,
    pageStore: { entries: pageStore === undefined ? 0 : pageStore.size, capacity: source.options.stashLimit },
    counters: totalsOf(metrics, source.options.charsPerToken),
    lastRun: metrics.lastRun ?? null,
    ...(metrics.lastOmissions === undefined
      ? {}
      : {
          [OMISSIONS_REPORT_KEY]: {
            [OMISSIONS_TOOL_EVICTIONS_FIELD]: metrics.lastOmissions.toolEvictions,
            [OMISSIONS_REASONING_PARTS_FIELD]: metrics.lastOmissions.reasoningParts,
            [OMISSIONS_FENCE_BLOCKS_FIELD]: metrics.lastOmissions.fenceBlocks,
            [OMISSIONS_RELOAD_TOOL_FIELD]: RECALL_TOOL_NAME,
          },
        }),
    ...(metrics.lastRetention === undefined || metrics.lastRetention.pool === 0
      ? {}
      : {
          [RETENTION_REPORT_KEY]: {
            [RETENTION_POOL_FIELD]: metrics.lastRetention.pool,
            [RETENTION_REASONS_FIELD]: metrics.lastRetention.reasons,
            [RETENTION_FAULT_SHIFT_FIELD]: metrics.lastRetention.faultShieldedShiftMessages,
          },
        }),
    ...(metrics.lastDryRun === undefined
      ? {}
      : {
          dryRun: {
            deficitTokens: metrics.lastDryRun.deficitTokens,
            wouldEvictCount: metrics.lastDryRun.wouldEvictCount,
            wouldEvictBytes: metrics.lastDryRun.wouldEvictBytes,
            wouldEvictSubjects: metrics.lastDryRun.wouldEvictSubjects.slice(0, source.options.rememberedEvictedSubjects),
          },
        }),
    ...(metrics.lastAdvisory === undefined ? {} : { advisory: metrics.lastAdvisory }),
    ...(metrics.lastComposition === undefined
      ? {}
      : {
          composition: {
            toolPoolBytes: metrics.lastComposition.toolPoolBytes,
            textChars: metrics.lastComposition.textChars,
            reasoningInWindowBytes: metrics.lastComposition.reasoningInWindowBytes,
            escapeBytes: metrics.lastComposition.escapeBytes,
            attachmentBytes: metrics.lastComposition.attachmentBytes,
          },
        }),
    ...(metrics.lastError === undefined
      ? {}
      : { lastError: { message: metrics.lastError.message, at: new Date(metrics.lastError.atMs).toISOString() } }),
    ...(metrics.logWriteError === undefined ? {} : { logWriteError: metrics.logWriteError }),
    ...(metrics.stateWriteError === undefined ? {} : { stateWriteError: metrics.stateWriteError }),
    ...(metrics.hygieneWriteError === undefined ? {} : { hygieneWriteError: metrics.hygieneWriteError }),
    ...(metrics.pageStoreWriteError === undefined ? {} : { pageStoreWriteError: metrics.pageStoreWriteError }),
    ...(metrics.pageStoreSchemaError === undefined ? {} : { pageStoreSchemaError: metrics.pageStoreSchemaError }),
  }
  return JSON.stringify(report, null, JSON_INDENT_SPACES)
}

const liveSubjectsOf = (entries: EvictableEntry[]): HotSubject[] =>
  entries.flatMap((entry) =>
    startsWithEitherGeneration(entry.stateRef.output, EVICTION_MARKER, LEGACY_EVICTION_MARKER) ||
    startsWithEitherGeneration(entry.stateRef.output, DEDUP_MARKER, LEGACY_DEDUP_MARKER)
      ? []
      : entry.subjects.map((subject) => ({ subject, lastTouch: entry.lastTouch })),
  )

const scanToolOutputs = (
  messages: MessageBundle[],
  options: ResolvedOptions,
): { appearances: ToolAppearance[]; entries: EvictableEntry[] } => {
  const appearances: ToolAppearance[] = []
  const entries: EvictableEntry[] = []

  messages.forEach((message, msgIndex) => {
    for (const [partIndex, part] of message.parts.entries()) {
      if (part["type"] !== "tool") continue
      const state = part["state"]
      if (typeof state !== "object" || state === null) continue
      const typedState = state as Record<string, unknown>
      if (typedState["status"] !== "completed") continue
      const tool = part["tool"]
      if (typeof tool !== "string") continue
      const input = typeof typedState["input"] === "object" && typedState["input"] !== null ? (typedState["input"] as Record<string, unknown>) : {}
      const subjects = subjectsOf(tool, input)
      appearances.push({ msgIndex, tool, subjects })

      if (typeof typedState["output"] !== "string") continue
      const output = typedState["output"]
      if (startsWithEitherGeneration(output, EVICTION_MARKER, LEGACY_EVICTION_MARKER) || startsWithEitherGeneration(output, DEDUP_MARKER, LEGACY_DEDUP_MARKER) || output.length < options.minEvictableBytes) continue
      entries.push({
        stateRef: typedState as { output: string; attachments?: unknown },
        tool,
        msgIndex,
        partIndex,
        lastTouch: msgIndex,
        bytes: output.length,
        attachmentBytes: attachmentPayloadCharsOf(typedState),
        subjects,
      })
    }
  })

  for (const entry of entries) {
    for (const appearance of appearances) {
      if (appearance.msgIndex > entry.lastTouch && appearanceTouches(entry.subjects, appearance, options.minSubstringMatchChars)) {
        entry.lastTouch = appearance.msgIndex
      }
    }
  }

  return { appearances, entries }
}

// One scan and one candidate computation shared by the real evictor, the
// manual-mode dry run, and the no-eviction measurement, so the mirror is
// structural: the dry run walks exactly the ordered, filtered candidate
// list the evictor walks.
type EvictionCandidates = { appearances: ToolAppearance[]; entries: EvictableEntry[]; evictable: EvictableEntry[]; estimatedTokens: number }

const primaryRenderedSubjectOf = (entry: EvictableEntry): string =>
  entry.subjects.length > 0 ? renderSubject(entry.subjects[0]) : UNKNOWN_TARGET_LABEL

// The sort key fault feedback adjusts: each recorded fault pushes the
// entry's effective recency FAULT_PENALTY_MESSAGES newer, so faulted
// subjects evict later under equal pressure while remaining evictable
// (pressure still wins). Unfaulted entries keep their exact lastTouch, so
// their ordering is byte-identical to the unadjusted sort.
const faultAdjustedLastTouchOf = (entry: EvictableEntry, faultCounts: Map<string, number>): number =>
  entry.lastTouch + (faultCounts.get(primaryRenderedSubjectOf(entry)) ?? 0) * FAULT_PENALTY_MESSAGES

const evictionCandidatesOf = (messages: MessageBundle[], options: ResolvedOptions, faultCounts: Map<string, number>): EvictionCandidates => {
  const { appearances, entries } = scanToolOutputs(messages, options)
  const hotFromIndex = hotFromIndexOf(messages, options)
  const evictable = entries
    .filter((entry) => !isProtectedTool(entry.tool, options))
    .filter((entry) => entry.lastTouch < hotFromIndex)
    .filter((entry) => !isPatternProtected(entry.subjects, options))
    .map((entry) => ({ entry, sortKey: faultAdjustedLastTouchOf(entry, faultCounts) }))
    .sort((a, b) => a.sortKey - b.sortKey || b.entry.bytes - a.entry.bytes)
    .map((decorated) => decorated.entry)
  return { appearances, entries, evictable, estimatedTokens: estimateTokens(messages, options.charsPerToken) }
}

// Retention audit beside the candidates computation: classify every live
// tool output the evictor could see (candidates.entries, the unfiltered
// scanToolOutputs pool) against the same predicates the filter chain
// applies, so the audit cannot disagree with the mechanism it audits.
// Reasons are not exclusive: an entry matching several counts under each,
// so the sums read as diagnostic, never as a total. Fault-shielded
// reports the sort-key shift the recorded faults bought at classify time,
// taken from the fault adjustment itself so the magnitude cannot drift
// from the mechanism, not a survival guarantee
// (pressure still evicts a faulted entry); zero when no entry is faulted.
// A pool of zero is the caller's absence signal: describe and the panel
// render no retention surface for a run that scanned no live outputs.
const retentionBreakdownOf = (candidates: EvictionCandidates, messages: MessageBundle[], options: ResolvedOptions, faultCounts: Map<string, number>): RetentionBreakdown => {
  const hotFromIndex = hotFromIndexOf(messages, options)
  let maxFaultShieldedShift = 0
  const reasons = { inWindow: 0, protectedTool: 0, patternProtected: 0, faultShielded: 0, retainedRead: 0 }
  for (const entry of candidates.entries) {
    if (entry.msgIndex >= hotFromIndex) reasons.inWindow += 1
    else if (entry.lastTouch >= hotFromIndex) reasons.retainedRead += 1
    if (isProtectedTool(entry.tool, options)) reasons.protectedTool += 1
    if (isPatternProtected(entry.subjects, options)) reasons.patternProtected += 1
    const faulted = faultCounts.get(primaryRenderedSubjectOf(entry)) ?? 0
    if (faulted > 0) {
      reasons.faultShielded += 1
      maxFaultShieldedShift = Math.max(maxFaultShieldedShift, faultAdjustedLastTouchOf(entry, faultCounts) - entry.lastTouch)
    }
  }
  return { pool: candidates.entries.length, reasons, faultShieldedShiftMessages: maxFaultShieldedShift }
}

// The aged read tier (agedReadEvictionMessages): read-family outputs,
// defined as the tools whose subjects the touch tracker refreshes by
// exact path equality (every non-bash tool carrying a path or pattern
// subject; bash is the substring-refresh command channel and is
// excluded), whose birth position sits strictly older than the threshold
// from the list tail. Birth position, not lastTouch: a re-touched read
// is protected by the recent-window filter upstream of the tier, so a
// re-read keeps its output however ancient its original message is. The
// age compares against the list tail, so it is a deterministic function
// of the message list and the per-request view stays stable under the
// re-run-per-request contract. The tier adds no candidate of its own: it
// arms a second disposition inside the single shared walk (below), so
// aged entries ride the same tombstone, stash, and counter machinery as
// budget-driven evictions.
const isAgedReadEntry = (entry: EvictableEntry, listLength: number, options: ResolvedOptions): boolean =>
  options.agedReadEvictionMessages !== undefined &&
  entry.tool !== BASH_TOOL_NAME &&
  entry.subjects.length > 0 &&
  listLength - entry.msgIndex > options.agedReadEvictionMessages

// The deficit the evictor and the stand-down share, so the two sites
// cannot drift: the estimate over the effective watermark, disarmed to
// null when no effective watermark exists. The dry run does not use this
// guard because its contract hands it a non-null watermark.
const deficitTokensOf = (estimatedTokens: number, watermarkTokens: number | null): number | null =>
  watermarkTokens === null ? null : estimatedTokens - watermarkTokens

// The one-disposition decision the evictor walk and the dry-run walk
// share, so the two sites cannot drift: an entry is evicted when the aged
// read tier claims it, or when the watermark tier still has ground left
// to cover. A null deficit (no effective watermark) disarms the watermark
// tier entirely and leaves the aged tier unaffected. The tier boundary
// itself is untouched by the batch multiplier: the aged tier's dispositions
// and the protected-path filters upstream of the walk are identical at
// every multiplier value, and the reported deficit stays the true
// estimate-minus-watermark figure.
//
// WHY cache-aware: the watermark tier's stop target is the deficit times
// evictionBatchMultiplier. Each firing cuts history and re-prices the
// request tail from the cut point at the uncached rate, so N small
// reset events cost N re-priced tails; clearing N x the deficit per
// firing amortizes those re-pricings into one rarer, larger cut. At the
// default 1 the target is the deficit itself and the walk is byte-identical
// to the ungated evictor.
const isEvictedByWalkPolicy = (
  entry: EvictableEntry,
  listLength: number,
  options: ResolvedOptions,
  deficitTokens: number | null,
  reclaimedTokens: number,
): boolean =>
  isAgedReadEntry(entry, listLength, options) ||
  (deficitTokens !== null && reclaimedTokens < deficitTokens * options.evictionBatchMultiplier)

// The stand-down measurement: the run record of a transform that evicted
// nothing. The watermark and deficit ride through when an effective
// watermark exists (armed manual mode with a captured budget or a set
// watermarkTokens), so the sidebar and describe show the real
// figures the dry run acts on; a null watermark (either mode) keeps both
// null, matching a session that genuinely has no watermark. The deficit
// is the shared estimate-minus-watermark arithmetic over the shared
// candidates' estimate.
const measureWithoutEvicting = (candidates: EvictionCandidates, watermarkTokens: number | null): EvictionResult => {
  return {
    hotSubjects: liveSubjectsOf(candidates.entries),
    appearances: candidates.appearances,
    estimatedTokens: candidates.estimatedTokens,
    watermarkTokens,
    deficitTokens: deficitTokensOf(candidates.estimatedTokens, watermarkTokens),
    evicted: [],
    pagesDropped: 0,
  }
}

// The advisory pressure band below the effective watermark: the newest
// run's preview of how close the session sits to eviction. The band start
// is ratio x effective watermark and the estimate tested is the shared
// candidates' pre-eviction figure, the same one the dry run prices, so
// the preview and the evictor can never disagree about the session's size.
// Returns undefined when disarmed, when no effective watermark exists, or
// when the estimate sits below the band start; never mutates anything.
const measureAdvisory = (candidates: EvictionCandidates, effectiveWatermarkTokens: number | null, options: ResolvedOptions): AdvisoryResult | undefined => {
  if (!options.advisoryBand || effectiveWatermarkTokens === null) return undefined
  const bandStartTokens = options.advisoryBandRatio * effectiveWatermarkTokens
  const estimatedTokens = candidates.estimatedTokens
  if (estimatedTokens < bandStartTokens) return undefined
  return {
    ratio: options.advisoryBandRatio,
    bandStartTokens,
    estimatedTokens,
    deficitTokens: estimatedTokens - effectiveWatermarkTokens,
    subjects: candidates.evictable.slice(0, ADVISORY_SUBJECTS_BOUND).map((entry) => primaryRenderedSubjectOf(entry)),
  }
}

// Manual-mode dry run: with an effective watermark in hand, compute what
// the evictor WOULD reclaim (the shared candidate list, the same
// reclaim-until-deficit walk with the aged read tier's dispositions
// included) without touching any output. Consumes the already-computed
// candidates, so the message list is unchanged when it returns and no
// second scan runs.
const measureDryRun = (
  messages: MessageBundle[],
  candidates: EvictionCandidates,
  options: ResolvedOptions,
  watermarkTokens: number,
): DryRunResult => {
  const deficitTokens = candidates.estimatedTokens - watermarkTokens
  const subjects: string[] = []
  let wouldEvictBytes = 0
  let reclaimedTokens = 0
  for (const entry of candidates.evictable) {
    if (!isEvictedByWalkPolicy(entry, messages.length, options, deficitTokens, reclaimedTokens)) continue
    reclaimedTokens += entry.bytes / options.charsPerToken
    wouldEvictBytes += entry.bytes
    subjects.push(primaryRenderedSubjectOf(entry))
  }
  return { deficitTokens, wouldEvictCount: subjects.length, wouldEvictBytes, wouldEvictSubjects: subjects }
}

const evictLeastRecentlyUsed = (
  messages: MessageBundle[],
  candidates: EvictionCandidates,
  options: ResolvedOptions,
  watermarkTokens: number | null,
  pageStore: SessionPageStore,
  pageStoreEntries: PageEntry[],
): EvictionResult => {
  const { evictable } = candidates

  const deficitTokens = deficitTokensOf(candidates.estimatedTokens, watermarkTokens)
  const evicted: EvictedEntryInfo[] = []
  let pagesDropped = 0
  let reclaimedTokens = 0
  // One walk, one disposition per candidate: the aged read tier evicts
  // its entries whatever the budget says, and the watermark tier evicts
  // the rest only while the deficit is unmet, so no entry is touched
  // twice and the aged tier cannot double-count against the budget pass.
  for (const entry of evictable) {
    if (!isEvictedByWalkPolicy(entry, messages.length, options, deficitTokens, reclaimedTokens)) continue
    const subject = primaryRenderedSubjectOf(entry)
    const messagesAgo = messages.length - entry.lastTouch
    const droppedAttachments = nonEmptyAttachmentsOf(entry.stateRef)
    const digest = buildOutputDigest(entry.tool, subject, entry.stateRef.output)
    const tombstone = buildTombstone(entry.tool, subject, entry.bytes, messagesAgo, droppedAttachments !== undefined, digest)
    const stored: PageEntry = {
      output: entry.stateRef.output,
      tool: entry.tool,
      subject,
      msgIndex: entry.msgIndex,
      partIndex: entry.partIndex,
    }
    if (droppedAttachments !== undefined) stored.attachments = droppedAttachments
    pagesDropped += storeEvictedPage(pageStore, stored, options.stashLimit)
    pageStoreEntries.push(stored)
    stripStateAttachments(entry.stateRef)
    entry.stateRef.output = `${tombstone}${buildReloadPointer(subject)}`
    reclaimedTokens += entry.bytes / options.charsPerToken
    evicted.push({
      tool: entry.tool,
      subject,
      subjects: entry.subjects,
      bytes: entry.bytes,
      attachmentBytes: entry.attachmentBytes,
      messagesAgo,
    })
  }
  return {
    hotSubjects: liveSubjectsOf(candidates.entries),
    appearances: candidates.appearances,
    estimatedTokens: candidates.estimatedTokens,
    watermarkTokens,
    deficitTokens,
    evicted,
    pagesDropped,
  }
}

const buildHintLine = (hotSubjects: HotSubject[], limit: number): string | undefined => {
  const rendered = orderedRenderedSubjectsOf(hotSubjects, limit)
  if (rendered.length === 0) return undefined
  return `${HINT_LINE_PREFIX} ${rendered.join(SUBJECT_SEPARATOR)}`
}

const storeHint = (hintBySession: Map<string, string>, sessionKey: string, hotSubjects: HotSubject[], limit: number, sessionBound: number): void => {
  if (limit <= 0) return
  const hintLine = buildHintLine(hotSubjects, limit)
  if (hintLine !== undefined) rememberSessionValue(hintBySession, sessionKey, hintLine, sessionBound)
}

// One subject identifier's stable-membership state for the cache-aware
// hint line: accumulated live touches, consecutive runs without a live
// entry, and whether the identifier currently renders.
type HintMembershipState = { touches: number; missRun: number; member: boolean }

type HintMembershipBySession = Map<string, Map<string, HintMembershipState>>

// The stable line's subject identity: the bounded path alone, so the
// per-read range numerals never enter the rendered bytes and two reads of
// one file at different ranges hold one seat.
const stableHintIdentifierOf = (subject: Subject): string => boundedSingleLineOf(subject.path)

const hintMembershipFor = (membershipBySession: HintMembershipBySession, sessionKey: string, sessionBound: number): Map<string, HintMembershipState> => {
  const touched = touchMapEntry(membershipBySession, sessionKey)
  if (touched !== undefined) return touched
  trimMapToBound(membershipBySession, sessionBound)
  const created: Map<string, HintMembershipState> = new Map()
  membershipBySession.set(sessionKey, created)
  return created
}

// One transform run's membership movement: live touches accumulate and
// clear the miss run, absent runs accrue misses and drop a member only at
// the exit bound, and an identifier that has left (or never entered and
// gone stale) releases its state so the map holds only members and entry
// candidates.
const updateHintMembership = (membership: Map<string, HintMembershipState>, hotSubjects: HotSubject[]): void => {
  const touchesByIdentifier = new Map<string, number>()
  for (const { subject } of hotSubjects) {
    const identifier = stableHintIdentifierOf(subject)
    touchesByIdentifier.set(identifier, (touchesByIdentifier.get(identifier) ?? 0) + 1)
  }
  for (const [identifier, state] of membership) {
    const touches = touchesByIdentifier.get(identifier) ?? 0
    if (touches > 0) {
      state.touches += touches
      state.missRun = 0
      if (!state.member && state.touches >= HINT_ENTRY_TOUCHES) state.member = true
    } else {
      state.missRun += 1
      if (state.member && state.missRun >= HINT_EXIT_MISSES) state.member = false
    }
    if (!state.member && state.missRun >= HINT_EXIT_MISSES) membership.delete(identifier)
  }
  for (const [identifier, touches] of touchesByIdentifier) {
    if (membership.has(identifier)) continue
    membership.set(identifier, { touches, missRun: 0, member: touches >= HINT_ENTRY_TOUCHES })
  }
}

// Members in code-unit order, not locale order and not touch recency, so
// the rendered bytes are a pure function of membership.
const buildStableHintLine = (membership: Map<string, HintMembershipState>, limit: number): string | undefined => {
  if (limit <= 0) return undefined
  const members = [...membership].filter(([, state]) => state.member).map(([identifier]) => identifier)
  if (members.length === 0) return undefined
  members.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return `${HINT_LINE_PREFIX} ${members.slice(0, limit).join(SUBJECT_SEPARATOR)}`
}

const storeStableHint = (
  hintBySession: Map<string, string>,
  membershipBySession: HintMembershipBySession,
  sessionKey: string,
  hotSubjects: HotSubject[],
  limit: number,
  sessionBound: number,
): void => {
  if (limit <= 0) return
  const membership = hintMembershipFor(membershipBySession, sessionKey, sessionBound)
  updateHintMembership(membership, hotSubjects)
  const hintLine = buildStableHintLine(membership, limit)
  if (hintLine !== undefined) rememberSessionValue(hintBySession, sessionKey, hintLine, sessionBound)
}

// The compaction-prompt enrichment: when the host's native compaction
// fires, append a compact block carrying the session's remembered evicted
// subjects (sharing the hint line's newest-first order and hintSubjects
// bound, not its membership: the hint renders live subjects, this renders
// remembered evicted subjects) and, when the session stash holds
// reloadable outputs, a one-line note naming the newest stashed subjects
// through recall. Appends context strings only; the native prompt
// is never replaced, and an unknown session attaches nothing.
const COMPACTION_BLOCK_MARKER = "[ctx]"
const compactionContextFor = (metricsEntry: SessionMetrics | undefined, pageStore: SessionPageStore | undefined, limit: number): string[] => {
  if (metricsEntry === undefined) return []
  const hotSubjects = orderedRenderedSubjectsOf(metricsEntry.evictedSubjects.map((subject, index) => ({ subject, lastTouch: index })), limit)
  const context: string[] = []
  if (hotSubjects.length > 0) context.push(`${HINT_LINE_PREFIX} ${hotSubjects.join(SUBJECT_SEPARATOR)}`)
  // slice(-0) is slice(0), the whole store, so the bound must be checked
  // here instead of trusted to slice; 0 disables subject rendering for the
  // hint line and disables the store note with it.
  if (limit > 0 && pageStore !== undefined && pageStore.size > 0) {
    const entries = [...pageStore.values()]
    const newestSubjects: string[] = []
    const seenSubjects = new Set<string>()
    for (let index = entries.length - 1; index >= 0 && newestSubjects.length < limit; index -= 1) {
      const subject = entries[index].subject
      if (seenSubjects.has(subject)) continue
      seenSubjects.add(subject)
      newestSubjects.push(subject)
    }
    context.push(`${COMPACTION_BLOCK_MARKER} tombstoned outputs remain reloadable via the ${RECALL_TOOL_NAME} tool; newest subjects: ${newestSubjects.join(SUBJECT_SEPARATOR)}`)
  }
  const omissions = metricsEntry.lastOmissions
  if (omissions !== undefined && (omissions.toolEvictions > 0 || omissions.reasoningParts > 0 || omissions.fenceBlocks > 0)) {
    context.push(
      `${COMPACTION_BLOCK_MARKER} ${OMISSIONS_LINE_LEAD}${omissions.toolEvictions} ${OMISSIONS_TOOL_OUTPUTS_LABEL}, ${omissions.reasoningParts} ${OMISSIONS_REASONING_BLOCKS_LABEL}, ${omissions.fenceBlocks} ${OMISSIONS_FENCED_BLOCKS_LABEL}${OMISSIONS_RELOAD_LEAD}${RECALL_TOOL_NAME}`,
    )
  }
  return context
}

const deliverHint = (hintBySession: Map<string, string>, input: unknown, output: { system: string[] }): void => {
  if (!Array.isArray(output.system)) return
  const sessionKey = sessionKeyFromContext(input)
  const hintLine = touchMapEntry(hintBySession, sessionKey)
  if (hintLine === undefined) return
  const existingIndex = output.system.findIndex((block) => typeof block === "string" && startsWithEitherGeneration(block, HINT_LINE_PREFIX, LEGACY_HINT_LINE_PREFIX))
  if (existingIndex === -1) output.system.push(hintLine)
  else output.system[existingIndex] = hintLine
}

// Per-session hygiene cadence state: the count of trigger-carrying runs
// since the last batched fire. A missing entry means zero.
type HygieneCadenceBySession = Map<string, number>

// Sessions holding a pending trigger count, mirroring the other per-session
// store bounds; a session falling out of the map merely restarts its count.
const HYGIENE_CADENCE_SESSIONS = 8

// One transform run's hygiene disposition: whether the three batchable
// passes (range collapse, errored-input purge, aged-reasoning expiry) fire
// this run, and the collapse plan the decision phase already walked.
type HygieneBatchDecision = { fire: boolean; collapsePlan: RangeCollapsePlan }

// The deferred-run results the fire path returns instead of pass outcomes:
// frozen so a downstream field write on the shared record fails loudly
// instead of corrupting every later deferred run.
const RANGE_COLLAPSE_NONE: RangeCollapseOutcome = Object.freeze({ collapsed: 0, collapsedBytes: 0 })
const REASONING_EXPIRY_NONE: ReasoningExpiry = Object.freeze({ parts: 0, bytes: 0, unique: 0, uniqueBytes: 0 })

// WHY cache-aware: each of these passes cuts history at its own seat, and
// a provider serves a cache hit only while the next request byte-matches
// the cached prefix from position zero, so every small cut re-prices the
// whole request tail at the uncached rate. N per-request hygiene cuts cost
// N re-priced tails; the gated cadence accumulates the passes' triggers
// across runs and fires them as ONE batched mutation, so N small cuts
// collapse into one cut and one re-priced tail. The pressure valves never
// ride this gate: the watermark-driven eviction walk and the aged read
// tier's hard fire answer size pressure, and deferring those would trade
// unbounded context growth for cache bytes.
const resolveHygieneBatch = (
  messages: MessageBundle[],
  options: ResolvedOptions,
  pendingBySession: HygieneCadenceBySession,
  sessionKey: string,
): HygieneBatchDecision => {
  const collapsePlan = planRangeCollapse(messages, options)
  if (options.mutationBatchCadence <= 0) return { fire: true, collapsePlan }
  const triggered =
    collapsePlan.collapsed > 0 || hasErroredToolInputToPurge(messages, options) || hasAgedReasoningToExpire(messages, options)
  if (triggered === false) return { fire: false, collapsePlan }
  const pending = (touchMapEntry(pendingBySession, sessionKey) ?? 0) + 1
  if (pending >= options.mutationBatchCadence) {
    pendingBySession.delete(sessionKey)
    return { fire: true, collapsePlan }
  }
  rememberSessionValue(pendingBySession, sessionKey, pending, HYGIENE_CADENCE_SESSIONS)
  return { fire: false, collapsePlan }
}

const fireCollapsePass = (messages: MessageBundle[], decision: HygieneBatchDecision): RangeCollapseOutcome => {
  if (decision.fire === false) return RANGE_COLLAPSE_NONE
  applyRangeCollapse(messages, decision.collapsePlan)
  return { collapsed: decision.collapsePlan.collapsed, collapsedBytes: decision.collapsePlan.collapsedBytes }
}

// The transform hook's body, extracted so the registration-site boundary
// can wrap it in fault isolation. Everything it needs rides the deps
// object (the plugin instance's per-process stores plus resolved
// options); nothing mutates state outside them.
type TransformHookDeps = {
  contextLimits: Map<string, ContextLimitEntry>
  modelKeyBySession: Map<string, string | undefined>
  metricsBySession: MetricsStore
  metricsHydrationBySession: MetricsHydration
  persistedTotalsForSession: (sessionKey: string) => Promise<PersistedTotals | undefined>
  pageStoreBySession: PageStoreBySession
  hintBySession: Map<string, string>
  hintMembershipBySession: HintMembershipBySession
  hygieneCadenceBySession: HygieneCadenceBySession
  pruneThrottle: PruneThrottle
  pluginSession: string
  pageStoreGuard: PageStoreGuard
  options: ResolvedOptions
}

const transformHookBody = async (messages: MessageBundle[], deps: TransformHookDeps): Promise<void> => {
  const { options } = deps
  const info = messages[0]?.info
  const sessionKey = sessionKeyFromContext(info)
  const sessionID = info?.sessionID
  // The budget fallback rides the session metrics, so hydration must
  // land before resolution: a restart resolves the persisted budget
  // instead of flickering to unknown, and a live chat.params capture
  // still wins because the fallback fills only the unknown state.
  const sessionMetrics = await metricsForSession(deps.metricsBySession, deps.metricsHydrationBySession, deps.persistedTotalsForSession, sessionKey, options.metricsSessions)
  const sessionLimit = sessionID !== undefined ? touchMapEntry(deps.contextLimits, sessionID) : undefined
  const sittingModelKey = sessionID === undefined ? undefined : deps.modelKeyBySession.get(sessionID)
  const { contextLimit, fallbackSuppressed } = contextLimitForRun(sessionLimit, sessionMetrics.persistedBudget, sittingModelKey, options)
  if (fallbackSuppressed) sessionMetrics.persistedBudget = undefined
  else if (contextLimit.source !== CONTEXT_TOKENS_SOURCE_UNKNOWN) sessionMetrics.persistedBudget = { tokens: contextLimit.tokens, source: contextLimit.source, modelKey: contextLimit.modelKey }
  const sessionPageStore = pagesForSession(deps.pageStoreBySession, sessionKey, options.stashSessions)
  // The run's stashed entries, gathered at the two stash sites so the write
  // below lands them eagerly in the same run as the eviction that built them.
  const pageStoreEntries: PageEntry[] = []
  stripLegacyHintParts(messages)
  const toolDedup = deduplicateToolOutputs(messages, options)
  const fileDedup = deduplicateFileAttachments(messages, options)
  // The batched-cadence decision sits where the collapse pass used to fire:
  // its plan phase is the collapse pass's detection, and the purge and
  // expiry trigger scans read the same pre-hygiene state their passes
  // would, so the deferral decision cannot disagree with a fire.
  const hygieneBatch = resolveHygieneBatch(messages, options, deps.hygieneCadenceBySession, sessionKey)
  const rangeCollapse = fireCollapsePass(messages, hygieneBatch)
  const dedupedThisRun = toolDedup.tombstones + fileDedup.tombstones
  // The lifetime unique credit gates count and bytes alike on the pair
  // identity: a standing duplicate re-tombstones every run, but only its
  // first creation credits the pair's superseded bytes.
  const { unique: dedupedUniqueThisRun, bytes: dedupedBytesUniqueThisRun } = countUniqueDedupedPairs(sessionMetrics, [
    ...toolDedup.tombstonedPairs,
    ...fileDedup.tombstonedPairs,
  ])
  let reasoningExpiredThisRun: ReasoningExpiry = REASONING_EXPIRY_NONE
  let purgedThisRun = 0
  if (hygieneBatch.fire) {
    purgedThisRun = purgeErroredToolInputs(messages, options)
    reasoningExpiredThisRun = expireAgedReasoning(sessionMetrics, messages, options)
  }
  const fenceEvictedThisRun = evictLargeUserFences(messages, options, sessionPageStore, pageStoreEntries)
  const effectiveWatermarkTokens = effectiveWatermarkTokensOf(contextLimit.tokens, options)
  // One scan and one candidate walk feed whichever path runs: the
  // stand-downs (manual mode, or no watermark with the aged read tier
  // disarmed) share this candidates computation with the real evictor.
  // The aged read tier arms the evictor even without a budget, since its
  // evictions are budget-independent; with the tier unset the old
  // stand-down holds and an unknown budget still suspends eviction.
  const candidates = evictionCandidatesOf(messages, options, sessionMetrics.faultCounts)
  const standDown = options.manualMode || (effectiveWatermarkTokens === null && options.agedReadEvictionMessages === undefined)
  const eviction = standDown
    ? measureWithoutEvicting(candidates, effectiveWatermarkTokens)
    : evictLeastRecentlyUsed(messages, candidates, options, effectiveWatermarkTokens, sessionPageStore, pageStoreEntries)
  // The manual-mode dry run: with an effective watermark set, report
  // what the evictor would reclaim (the combined watermark and aged
  // read policy) so a staged watermark or staged age threshold can be
  // evaluated before manual mode is ever turned off. Never mutates
  // the message list.
  const dryRun =
    options.manualMode && effectiveWatermarkTokens !== null
      ? measureDryRun(messages, candidates, options, effectiveWatermarkTokens)
      : undefined
  // The advisory pressure band: computed for every run (manual mode
  // included, alongside the dry run) from the same pre-eviction
  // candidates the evictor and the dry run consume. Eviction itself
  // still fires only at the effective watermark.
  const advisory = measureAdvisory(candidates, effectiveWatermarkTokens, options)
  const faultsThisRun = countFaults(sessionMetrics, eviction.appearances, options.minSubstringMatchChars)
  // Composition reads the final post-transform list: every pass above has
  // applied its edits, so the sums are what this request carries.
  const composition = runCompositionOf(messages, options)
  const runOutcome: RunOutcome = {
    eviction,
    deduped: dedupedThisRun,
    dedupedBytesUnique: dedupedBytesUniqueThisRun,
    dedupedUnique: dedupedUniqueThisRun,
    collapsedWindows: rangeCollapse.collapsed,
    collapsedWindowBytes: rangeCollapse.collapsedBytes,
    purged: purgedThisRun,
    faults: faultsThisRun,
    reasoningExpired: reasoningExpiredThisRun,
    fenceEvicted: fenceEvictedThisRun,
    dryRun,
    advisory,
    composition,
  }
  recordRunOutcome(sessionMetrics, runOutcome, options.rememberedEvictedSubjects)
  sessionMetrics.lastDryRun = runOutcome.dryRun
  sessionMetrics.lastAdvisory = runOutcome.advisory
  sessionMetrics.lastComposition = runOutcome.composition
  sessionMetrics.lastOmissions = {
    toolEvictions: runOutcome.eviction.evicted.length,
    reasoningParts: runOutcome.reasoningExpired.parts,
    fenceBlocks: runOutcome.fenceEvicted.blocks,
  }
  sessionMetrics.lastRetention = retentionBreakdownOf(candidates, messages, options, sessionMetrics.faultCounts)
  // WHY cache-aware: the hint line rides the system array, seat ~0 of the
  // request, so rewriting it every run (touch-recency reordering, fresh
  // range numerals) invalidates the provider's cached prefix from that
  // seat onward and re-prices the whole request at the uncached rate. The
  // gated rendering is byte-stable: identifiers sorted, no live numerals,
  // membership moving only through entry/exit hysteresis, so the seat
  // rewrites only on a genuine membership change.
  if (options.cacheAwareHints) {
    storeStableHint(deps.hintBySession, deps.hintMembershipBySession, sessionKey, eviction.hotSubjects, options.hintSubjects, options.hintSessions)
  } else {
    storeHint(deps.hintBySession, sessionKey, eviction.hotSubjects, options.hintSubjects, options.hintSessions)
  }
  await recordPageStoreLines(options, deps.metricsBySession, sessionKey, pageStoreEntries, deps.pageStoreGuard)
  await recordMetricsLine(options, sessionMetrics, sessionKey, deps.pluginSession, contextLimit, runOutcome)
  await recordSessionCheckpoint(options, sessionKey, contextLimit, sessionMetrics, sessionPageStore, eviction.hotSubjects, deps.pruneThrottle)
}

// A throwing tool degrades to a structured error string the TUI can
// render, never a raw throw into the host's tool dispatcher.
const guardTool = (tool: (args: unknown, toolContext: unknown) => Promise<string>) => {
  return async (args: unknown, toolContext: unknown): Promise<string> => {
    try {
      return await tool(args, toolContext)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `${TOOL_ERROR_PREFIX}${message}`
    }
  }
}

const server = (async (_input, rawOptions) => {
  const raw = (rawOptions ?? {}) as ContextManagerOptions
  await migrateLegacyDefaultPaths(raw)
  const options = resolveOptions(raw)
  const contextLimits = new Map<string, ContextLimitEntry>()
  const modelKeyBySession = new Map<string, string | undefined>()
  const pageStoreBySession = new Map<string, SessionPageStore>()
  const hintBySession = new Map<string, string>()
  const hintMembershipBySession: HintMembershipBySession = new Map()
  const hygieneCadenceBySession: HygieneCadenceBySession = new Map()
  const metricsBySession: MetricsStore = new Map()
  const metricsHydrationBySession: MetricsHydration = new Map()
  const pruneThrottle: PruneThrottle = { lastScanMs: PRUNE_SCAN_NEVER }
  const pluginSession = randomUUID()
  const pageStoreGuard: PageStoreGuard = { newerSchemaObserved: false }
  const persistedTotalsForSession = (sessionKey: string): Promise<PersistedTotals | undefined> =>
    newestPersistedTotalsOf(options, sessionKey)
  // Hoisted per plugin instance: every run passes the same deps object to
  // the extracted transform body instead of rebuilding the literal per run.
  const transformHookDeps: TransformHookDeps = {
    contextLimits,
    modelKeyBySession,
    metricsBySession,
    metricsHydrationBySession,
    persistedTotalsForSession,
    pageStoreBySession,
    hintBySession,
    hintMembershipBySession,
    hygieneCadenceBySession,
    pruneThrottle,
    pluginSession,
    pageStoreGuard,
    options,
  }

  // Workaround: recall and describe are registered as plain
  // { description, args, execute } definitions instead of calling tool() from
  // @opencode-ai/plugin. The package only resolves inside the opencode runtime
   // (Bun follows the deployment symlink to this repository's real path, where
   // no node_modules exists up-tree; the runtime's own copy at
   // ~/.config/opencode/node_modules is off that resolution path), so importing
   // it throws here. The runtime's tool
  // registry (packages/opencode/src/tool/registry.ts, fromPlugin) consumes
  // definition objects directly and derives the JSON schema itself: args values
  // that are not zod schemas take its legacyJsonSchema path, so the plain
  // { type: "string" } schema below is sufficient. If this file ever ships
  // somewhere @opencode-ai/plugin resolves, switch back to tool().
  const recallTool = async (args: unknown, toolContext: unknown): Promise<string> =>
    executeReadEvicted(pageStoreBySession, metricsBySession, metricsHydrationBySession, persistedTotalsForSession, options.metricsSessions, options, args, toolContext, pageStoreGuard)

  const describeTool = async (_args: unknown, toolContext: unknown): Promise<string> =>
    executeStatsTool({ options, limits: contextLimits, modelKeys: modelKeyBySession, pageStores: pageStoreBySession, metrics: metricsBySession }, toolContext)

  return {
    "chat.params": async (input: { sessionID: string; model?: ChatParamsModel }) => {
      try {
        chatParamsHookBody(input, contextLimits, modelKeyBySession, metricsBySession, options)
      } catch {
        // A malformed or hostile chat.params payload degrades to no-op:
        // the session keeps whatever budget state it already had.
      }
    },
    "experimental.chat.messages.transform": async (_input: unknown, output: { messages: MessageBundle[] }) => {
      const messages = output.messages
      if (!Array.isArray(messages) || messages.length === 0) return
      // Resolved inside the try: a hostile messages[0].info accessor is
      // itself a fault on the highest-likelihood path and must hit the
      // boundary, not escape ahead of it. The fallback key names the
      // shared no-session entry for the fault record.
      let sessionKey = FALLBACK_SESSION_KEY
      try {
        sessionKey = sessionKeyFromContext(messages[0]?.info)
        const injectedError = options.errorTransform?.()
        if (typeof injectedError === "string") throw new Error(injectedError)
        await transformHookBody(messages, transformHookDeps)
      } catch (error) {
        // Fault isolation: a plugin bug must never corrupt or block the
        // session. A fault before the body starts leaves the list
        // untouched; a mid-body fault returns the partially applied
        // normal edits (same references, subset of healthy edits) —
        // either way never a corrupted structure — and the failure
        // surfaces through describe.
        const lastError = { message: error instanceof Error ? error.message : String(error), atMs: options.now() }
        rememberError(metricsBySession, sessionKey, lastError, options.metricsSessions)
      }
    },
    "experimental.session.compacting": async (input: { sessionID?: string }, output: { context?: string[] }) => {
      let sessionKey = FALLBACK_SESSION_KEY
      try {
        if (!Array.isArray(output.context)) return
        sessionKey = sessionKeyFromContext(input)
        if (options.errorCompaction !== undefined) options.errorCompaction()
        const context = compactionContextFor(
          touchMapEntry(metricsBySession, sessionKey),
          pageStoreBySession.get(sessionKey),
          options.hintSubjects,
        )
        if (context.length === 0) return
        output.context.push(...context)
      } catch (error) {
        // Fault isolation: compaction proceeds with the native prompt
        // unmodified and the failure surfaces through the diagnostics
        // channel.
        const lastError = { message: error instanceof Error ? error.message : String(error), atMs: options.now() }
        rememberError(metricsBySession, sessionKey, lastError, options.metricsSessions)
      }
    },
    "experimental.chat.system.transform": async (input: { sessionID?: string }, output: { system: string[] }) => {
      try {
        deliverHint(hintBySession, input, output)
      } catch {
        // A hint failure degrades to returning the prompt unchanged: the
        // hint is advisory, never worth blocking a model call over.
      }
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID?: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      let sessionKey = FALLBACK_SESSION_KEY
      try {
        if (!options.ingestionHygiene) return
        if (typeof output.output !== "string") return
        sessionKey = sessionKeyFromContext(input)
        if (options.errorHygiene !== undefined) options.errorHygiene()
        const original = output.output
        const stripped = stripTerminalNoiseFrom(original)
        if (stripped === original) return
        // The copy precedes the rewrite: if the copy path ever threw, the
        // output would reach the boundary untouched instead of half-applied.
        if (options.ingestionHygieneCopy) {
          await appendHygieneCopy(options, metricsBySession, sessionKey, {
            tool: input.tool,
            title: typeof output.title === "string" ? output.title : undefined,
            original,
            stripped,
          })
        }
        output.output = stripped
      } catch (error) {
        // Fault isolation: the tool result proceeds with its original text
        // and the failure surfaces through the diagnostics channel.
        const lastError = { message: error instanceof Error ? error.message : String(error), atMs: options.now() }
        rememberError(metricsBySession, sessionKey, lastError, options.metricsSessions)
      }
    },
    tool: {
      [RECALL_TOOL_NAME]: {
        description: RECALL_TOOL_DESCRIPTION,
        args: { [RECALL_ARG_NAME]: RECALL_ARG_SCHEMA, [RECALL_PROBE_ARG_NAME]: RECALL_PROBE_ARG_SCHEMA },
        execute: guardTool(recallTool),
      },
      [DESCRIBE_TOOL_NAME]: {
        description: DESCRIBE_TOOL_DESCRIPTION,
        args: {},
        execute: guardTool(describeTool),
      },
    },
  }
}) satisfies Plugin

// The v1 object entrypoint: opencode's plugin loader (1.18.29+) reads
// `mod.default` and, on an object carrying `id`/`server`, skips the legacy
// scan that demands every runtime export be a function. The named constant
// exports above are never scanned on this path.
export default { id: PLUGIN_ID, server } satisfies PluginModule
