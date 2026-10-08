import { rememberSessionValue, sessionKeyFromContext, touchMapEntry, trimMapToBound } from "./session-maps.ts"
import { boundedSingleLineOf, HINT_LINE_PREFIX, LEGACY_HINT_LINE_PREFIX, orderedRenderedSubjectsOf, startsWithEitherGeneration, SUBJECT_SEPARATOR } from "./vocabulary.ts"
import type { HotSubject, Subject } from "./vocabulary.ts"

// Cache-aware hint hysteresis: a subject enters the stable line only after
// HINT_ENTRY_TOUCHES accumulated live touches and leaves only after
// HINT_EXIT_MISSES consecutive runs without one; entry strictly exceeding
// exit keeps a flapping subject from rewriting the line it just left.
const HINT_ENTRY_TOUCHES = 3
const HINT_EXIT_MISSES = 2

const buildHintLine = (hotSubjects: HotSubject[], limit: number): string | undefined => {
  const rendered = orderedRenderedSubjectsOf(hotSubjects, limit)
  if (rendered.length === 0) return undefined
  return `${HINT_LINE_PREFIX} ${rendered.join(SUBJECT_SEPARATOR)}`
}

export const storeHint = (hintBySession: Map<string, string>, sessionKey: string, hotSubjects: HotSubject[], limit: number, sessionBound: number): void => {
  if (limit <= 0) return
  const hintLine = buildHintLine(hotSubjects, limit)
  if (hintLine !== undefined) rememberSessionValue(hintBySession, sessionKey, hintLine, sessionBound)
}

// One subject identifier's stable-membership state for the cache-aware
// hint line: accumulated live touches, consecutive runs without a live
// entry, and whether the identifier currently renders.
type HintMembershipState = { touches: number; missRun: number; member: boolean }

export type HintMembershipBySession = Map<string, Map<string, HintMembershipState>>

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

export const storeStableHint = (
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

export const deliverHint = (hintBySession: Map<string, string>, input: unknown, output: { system: string[] }): void => {
  if (!Array.isArray(output.system)) return
  const sessionKey = sessionKeyFromContext(input)
  const hintLine = touchMapEntry(hintBySession, sessionKey)
  if (hintLine === undefined) return
  const existingIndex = output.system.findIndex((block) => typeof block === "string" && startsWithEitherGeneration(block, HINT_LINE_PREFIX, LEGACY_HINT_LINE_PREFIX))
  if (existingIndex === -1) output.system.push(hintLine)
  else output.system[existingIndex] = hintLine
}
