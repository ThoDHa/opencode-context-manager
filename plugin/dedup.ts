import { attachmentPayloadCharsOf, completedOutputOf, filePartOf, hotFromIndexOf, stableStringify, stripStateAttachments, TEXT_PART_TYPE } from "./messages.ts"
import type { FilePartFields, MessageBundle } from "./messages.ts"
import { DEDUP_FILE_SUPERSEDED_LEAD, DEDUP_MARKER, DEDUP_RANGE_SUPERSEDED_LEAD, DEDUP_SUPERSEDED_LEAD, EVICTION_MARKER, LEGACY_DEDUP_MARKER, LEGACY_EVICTION_MARKER, PATH_INPUT_KEYS, rangeOf, READ_TOOL_NAME, renderSubject, startsWithEitherGeneration } from "./vocabulary.ts"
import type { SubjectRange } from "./vocabulary.ts"
import type { ResolvedOptions } from "./options.ts"

type RetainedDuplicate = { msgIndex: number; tool: string; supersedes: boolean }

type RetainedFileDuplicate = { msgIndex: number; label: string }

type DedupTarget = { stateRef: { output: string; attachments?: unknown }; tool: string; input: Record<string, unknown> }

export type DedupedPairBytes = { key: string; bytes: number }

type DedupOutcome = { tombstones: number; tombstonedPairs: DedupedPairBytes[] }

const dedupKeyOf = (tool: string, input: Record<string, unknown>): string => JSON.stringify([tool, stableStringify(input)])

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

export const deduplicateToolOutputs = (messages: MessageBundle[], options: ResolvedOptions): DedupOutcome => {
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

export const deduplicateFileAttachments = (messages: MessageBundle[], options: ResolvedOptions): DedupOutcome => {
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

export type RangeCollapseOutcome = { collapsed: number; collapsedBytes: number }

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

export type RangeCollapsePlan = { edits: RangeCollapseEdit[]; collapsed: number; collapsedBytes: number }

export const planRangeCollapse = (messages: MessageBundle[], options: ResolvedOptions): RangeCollapsePlan => {
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

export const applyRangeCollapse = (messages: MessageBundle[], plan: RangeCollapsePlan): void => {
  for (const edit of plan.edits) messages[edit.msgIndex].parts[edit.partIndex] = edit.replacement
}
