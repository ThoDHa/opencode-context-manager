export const EVICTION_MARKER = "[ctx-evicted]"
const HINT_MARKER = "[ctx-hot]"
const HINT_LABEL = "recently active:"
export const HINT_LINE_PREFIX = `${HINT_MARKER} ${HINT_LABEL}`
// Tombstones, purged-input markers, and hint lines live permanently in
// users' stored session history, so every detector recognizes the
// previous marker generation next to the current one; only emissions use
// the current markers.
export const LEGACY_EVICTION_MARKER = "[lru-evicted]"
export const LEGACY_DEDUP_MARKER = "[lru-deduped]"
export const LEGACY_PURGED_INPUT_MARKER = "[lru-purged-input]"
export const LEGACY_HINT_LINE_PREFIX = `[lru-hot] ${HINT_LABEL}`
export const startsWithEitherGeneration = (text: string, current: string, legacy: string): boolean =>
  text.startsWith(current) || text.startsWith(legacy)
export const SUBJECT_SEPARATOR = ", "
const MAX_RENDERED_SUBJECT_CHARS = 160
const ELLIPSIS_MARKER = "…"
export const READ_TOOL_NAME = "read"
const MAX_DIGEST_CHARS = 200
const DIGEST_PIECE_SEPARATOR = " | "
const DIGEST_FIRST_PREVIEW_LABEL = "first"
const DIGEST_LAST_PREVIEW_LABEL = "last"
const DIGEST_HEAD_PREVIEW_LABEL = "head"
const DIGEST_TAIL_PREVIEW_LABEL = "tail"
const NEWLINE_SPLIT_PATTERN = /\r\n|\r|\n/

export const PATH_INPUT_KEYS = ["filePath", "path", "file", "directory"]

export const BASH_TOOL_NAME = "bash"
const COMMAND_INPUT_KEY = "command"
const OFFSET_INPUT_KEY = "offset"
const LIMIT_INPUT_KEY = "limit"
const PATTERN_INPUT_KEY = "pattern"

export const UNKNOWN_TARGET_LABEL = "unknown target"
const PATH_RANGE_SEPARATOR = ":"
const RANGE_SEPARATOR = "-"

export const RECALL_TOOL_NAME = "recall"

const RECALL_POINTER_LEAD = " Evicted output stored in the page store; recall it with"
const DIGEST_POINTER_LEAD = " Output digest: "
const DIGEST_POINTER_TAIL = "."

export const DEDUP_MARKER = "[ctx-deduped]"

export const DEDUP_SUPERSEDED_LEAD = "identical call superseded by the newer output at message"
export const DEDUP_RANGE_SUPERSEDED_LEAD = "range read superseded by the retained range at message"
export const DEDUP_FILE_SUPERSEDED_LEAD = "identical attachment superseded by the newer attachment at message"

export const PURGED_INPUT_MARKER = "[ctx-purged-input]"

export const JSON_INDENT_SPACES = 2

const TOMBSTONE_ATTACHMENTS_NOTICE = "attachments dropped"

const FENCE_EVICTION_MARKER = "[ctx-evicted-fence]"
const FENCE_BLOCK_NOUN = "code block"

const FENCE_LINE_COUNT_LABEL = "lines"
const FENCE_FIRST_LINE_LABEL = "first line"
const FENCE_EVICTED_NOTICE = "was evicted to reclaim context."

export type SubjectRange = { start: number; end: number }

export type Subject = {
  path: string
  range?: SubjectRange
}

export type HotSubject = { subject: Subject; lastTouch: number }

export const rangeOf = (input: Record<string, unknown>): SubjectRange | undefined => {
  const offset = input[OFFSET_INPUT_KEY]
  const limit = input[LIMIT_INPUT_KEY]
  if (typeof offset !== "number" || typeof limit !== "number") return undefined
  return { start: offset, end: offset + limit }
}

const patternSubjectOf = (input: Record<string, unknown>): Subject | undefined => {
  const pattern = input[PATTERN_INPUT_KEY]
  if (typeof pattern !== "string" || pattern.length === 0) return undefined
  return { path: pattern }
}

export const subjectsOf = (tool: string, input: Record<string, unknown>): Subject[] => {
  const range = rangeOf(input)
  const subjects: Subject[] = []
  for (const key of PATH_INPUT_KEYS) {
    const value = input[key]
    if (typeof value === "string" && value.length > 0) subjects.push(range ? { path: value, range } : { path: value })
  }
  const patternSubject = patternSubjectOf(input)
  if (patternSubject) subjects.push(patternSubject)
  const command = input[COMMAND_INPUT_KEY]
  if (tool === BASH_TOOL_NAME && typeof command === "string" && command.length > 0) subjects.push({ path: command })
  return subjects
}

export const boundedSingleLineOf = (text: string): string => {
  const singleLine = text.replaceAll("\n", " ")
  return singleLine.length > MAX_RENDERED_SUBJECT_CHARS
    ? `${singleLine.slice(0, MAX_RENDERED_SUBJECT_CHARS - ELLIPSIS_MARKER.length)}${ELLIPSIS_MARKER}`
    : singleLine
}

export const renderSubject = (subject: Subject): string => {
  const rendered = subject.range
    ? `${subject.path}${PATH_RANGE_SEPARATOR}${subject.range.start}${RANGE_SEPARATOR}${subject.range.end}`
    : subject.path
  return boundedSingleLineOf(rendered)
}

const boundedDigestOf = (text: string): string =>
  text.length > MAX_DIGEST_CHARS ? `${text.slice(0, MAX_DIGEST_CHARS - ELLIPSIS_MARKER.length)}${ELLIPSIS_MARKER}` : text

const digestPreviewOf = (label: string, line: string): string => `${label} "${line}"`

export const buildOutputDigest = (tool: string, subject: string, output: string): string => {
  const lines = output.split(NEWLINE_SPLIT_PATTERN)
  const headLine = lines[0]
  const tailLine = lines[lines.length - 1]
  if (tool === READ_TOOL_NAME) {
    return boundedDigestOf(
      [subject, digestPreviewOf(DIGEST_FIRST_PREVIEW_LABEL, headLine), digestPreviewOf(DIGEST_LAST_PREVIEW_LABEL, tailLine)].join(DIGEST_PIECE_SEPARATOR),
    )
  }
  if (tool === BASH_TOOL_NAME) {
    return boundedDigestOf(
      [subject, digestPreviewOf(DIGEST_HEAD_PREVIEW_LABEL, headLine), digestPreviewOf(DIGEST_TAIL_PREVIEW_LABEL, tailLine)].join(DIGEST_PIECE_SEPARATOR),
    )
  }
  return boundedDigestOf(lines.join(" "))
}

export const buildTombstone = (tool: string, subject: string, bytes: number, messagesAgo: number, attachmentsDropped: boolean, digest: string): string =>
  `${EVICTION_MARKER} ${tool} ${subject} (${bytes} bytes${attachmentsDropped ? `, ${TOMBSTONE_ATTACHMENTS_NOTICE}` : ""}, ~${messagesAgo} messages ago) was evicted to reclaim context; re-run the tool to reload its output.${DIGEST_POINTER_LEAD}${digest}${DIGEST_POINTER_TAIL}`

export const buildReloadPointer = (subject: string): string =>
  `${RECALL_POINTER_LEAD} ${RECALL_TOOL_NAME} (subject "${subject}").`

export const buildFenceTombstone = (language: string | undefined, contentLines: number, subject: string): string =>
  `${FENCE_EVICTION_MARKER} ${language === undefined ? FENCE_BLOCK_NOUN : `${language} ${FENCE_BLOCK_NOUN}`} (${contentLines} ${FENCE_LINE_COUNT_LABEL}, ${FENCE_FIRST_LINE_LABEL} "${subject}") ${FENCE_EVICTED_NOTICE}${buildReloadPointer(subject)}`

export const orderedRenderedSubjectsOf = (hotSubjects: HotSubject[], limit: number): string[] => {
  if (limit <= 0) return []
  const seen = new Set<string>()
  const rendered: string[] = []
  const ordered = [...hotSubjects].sort((a, b) => b.lastTouch - a.lastTouch)
  for (const { subject } of ordered) {
    const renderedSubject = renderSubject(subject)
    if (seen.has(renderedSubject)) continue
    seen.add(renderedSubject)
    rendered.push(renderedSubject)
    if (rendered.length >= limit) break
  }
  return rendered
}
