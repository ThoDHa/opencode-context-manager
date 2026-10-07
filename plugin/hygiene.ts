import { ESCAPE_SPAN_PATTERN, hotFromIndexOf, retentionFromIndexOf, REASONING_METADATA_KEY, REASONING_PART_TYPE, REASONING_TEXT_KEY, stableStringify, TEXT_PART_TYPE } from "./messages.ts"
import type { MessageBundle } from "./messages.ts"
import { HINT_LINE_PREFIX, LEGACY_HINT_LINE_PREFIX, LEGACY_PURGED_INPUT_MARKER, PURGED_INPUT_MARKER, startsWithEitherGeneration } from "./vocabulary.ts"
import type { ResolvedOptions } from "./options.ts"
import { rememberSessionValue, touchMapEntry } from "./session-maps.ts"
import { applyRangeCollapse, planRangeCollapse } from "./dedup.ts"
import type { RangeCollapseOutcome, RangeCollapsePlan } from "./dedup.ts"
import { DEFAULT_REMEMBERED_REASONING_PARTS, rememberUniqueKey } from "./state.ts"
import type { ReasoningExpiry, SessionMetrics } from "./state.ts"

// A reasoning part's stable identity: its own text and metadata, keyed the
// same way the dedup pass keys tool inputs, so identity survives the
// transform's repeated passes over the stored message list.
const reasoningIdentityOf = (text: unknown, metadata: unknown): string =>
  JSON.stringify([stableStringify(text), stableStringify(metadata)])

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
export const stripTerminalNoiseFrom = (output: string): string => {
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

export const purgeErroredToolInputs = (messages: MessageBundle[], options: ResolvedOptions): number => {
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
export const expireAgedReasoning = (metrics: SessionMetrics, messages: MessageBundle[], options: ResolvedOptions): ReasoningExpiry => {
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

export const stripLegacyHintParts = (messages: MessageBundle[]): void => {
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

// Per-session hygiene cadence state: the count of trigger-carrying runs
// since the last batched fire. A missing entry means zero.
export type HygieneCadenceBySession = Map<string, number>

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
export const REASONING_EXPIRY_NONE: ReasoningExpiry = Object.freeze({ parts: 0, bytes: 0, unique: 0, uniqueBytes: 0 })

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
export const resolveHygieneBatch = (
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

export const fireCollapsePass = (messages: MessageBundle[], decision: HygieneBatchDecision): RangeCollapseOutcome => {
  if (decision.fire === false) return RANGE_COLLAPSE_NONE
  applyRangeCollapse(messages, decision.collapsePlan)
  return { collapsed: decision.collapsePlan.collapsed, collapsedBytes: decision.collapsePlan.collapsedBytes }
}
