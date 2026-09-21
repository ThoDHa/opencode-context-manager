import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import lruContextFactory from "../plugin/lru-context.ts"
import { loadPanelData } from "../plugin/lru-panel-data.ts"

const TRANSFORM_HOOK = "experimental.chat.messages.transform"
const CHAT_PARAMS_HOOK = "chat.params"
const SESSION_ID = "lru-harness-session"
const SESSION_ID_B = "lru-harness-session-b"
const BASH_TOOL = "bash"
const READ_TOOL = "read"
const TOMBSTONE_MARKER = "[lru-evicted]"
const TOMBSTONE_SUFFIX = " was evicted to reclaim context; re-run the tool to reload its output."
const SMALL_TEXT_CHARS = 60
const SMALL_TOOL_OUTPUT_CHARS = 256
const CHARS_PER_TOKEN = 4
const SAVINGS_CUSTOM_CHARS_PER_TOKEN = 2
const WATERMARK_RATIO = 0.5
const LEGACY_DEFAULT_CONTEXT_TOKENS = 100000
const EXPLICIT_DEFAULT_CONTEXT_TOKENS = 600
const LARGE_DEFAULT_CONTEXT_TOKENS = 1000000
const INFINITE_DEFAULT_CONTEXT_TOKENS = Infinity
const INFINITE_REPORTED_CONTEXT = Infinity
const MIN_EVICTABLE_BYTES = 2048
const RECENT_WINDOW_MESSAGES = 4
const FILLER_TEXT_CHARS = 10
const RECENT_WINDOW_FILLER_MESSAGES = 4
const PATH_INPUT_KEY = "filePath"
const SECONDARY_PATH_INPUT_KEY = "path"
const WATERMARK_PROBE_CONTEXT_LIMIT = 200
const HEADROOM_TOKENS = 100
const OVER_BY_ONE_TOKENS = 1
const THREE_ENTRY_OUTPUT_BYTES = 3000
const THREE_ENTRY_COUNT = 3
const DEDUP_SAVINGS_PAIR_COUNT = 2
const PARTIAL_DEFICIT_TOKENS = 700
const TWO_ENTRY_DEFICIT_TOKENS = 800
const COLD_OUTPUT_BYTES = 2048
const NEW_OUTPUT_BYTES = 3000
const REFRESHED_PATH = "/data/refresh.txt"
const APPEARANCE_ONLY_OUTPUT_BYTES = 10
const BASH_ENTRY_COMMAND = "rm -rf /tmp/build"
const SUBSTRING_ENTRY_COMMAND = "abcd"
const SUBSTRING_APPEARANCE_COMMAND = "echo abcd done"
const SHORT_SUBSTRING_ENTRY_COMMAND = "abc"
const SHORT_SUBSTRING_APPEARANCE_COMMAND = "abc def"
const MARKER_PADDED_CHARS = 4000
const LEGACY_DEFAULT_WATERMARK_CHARS = LEGACY_DEFAULT_CONTEXT_TOKENS * WATERMARK_RATIO * CHARS_PER_TOKEN
const FALLBACK_TRAILING_FILLER_MESSAGES = 3
const FALLBACK_EXTRA_CHARS = 1
const SMALL_CONTEXT_LIMIT = 600
const ZERO_CONTEXT_LIMIT = 0
const TEXT_BUDGET_CONTEXT_LIMIT = 1060
const EXTRA_TEXT_CHARS = 64
const UNCOMPLETED_OUTPUT_BYTES = 5000
const OVER_WATERMARK_FILLER_TEXT_CHARS = 800
const OVER_WATERMARK_FILLER_MESSAGES = 4
const SINGLE_MESSAGE_OUTPUT_BYTES = 4000
const ISOLATION_CONTEXT_LIMIT_A = 200
const ISOLATION_CONTEXT_LIMIT_B = 20000
const OVERRIDE_MODEL_PROVIDER = "zai"
const OVERRIDE_MODEL_ID = "glm-5.3"
const OVERRIDE_MODEL_KEY = "zai/glm-5.3"
const OTHER_MODEL_PROVIDER = "anthropic"
const OTHER_MODEL_ID = "claude"
const OTHER_MODEL_KEY = "anthropic/claude"
const INVALID_OVERRIDE_ENTRY = "50%"
const INFINITE_OVERRIDE_ENTRY = Infinity
const STANDARD_BUNDLE_CHARS = MIN_EVICTABLE_BYTES + RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS
const THREE_ENTRY_BUNDLE_CHARS = THREE_ENTRY_COUNT * THREE_ENTRY_OUTPUT_BYTES + RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS
const COLD_NEW_BUNDLE_CHARS = COLD_OUTPUT_BYTES + NEW_OUTPUT_BYTES + RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS
const GREP_TOOL = "grep"
const RANGE_PATH = "/data/range.txt"
const READ_OFFSET_LINES = 100
const READ_LIMIT_LINES = 50
const PATTERN_QUERY = "parseConfig"
const INCLUDE_GLOB = "*.ts"
const INCLUDE_NUMERIC = 42
const RANGED_ENTRY_OFFSET = 10
const RANGED_ENTRY_LIMIT = 20
const PATTERN_INPUT_KEY = "pattern"
const INCLUDE_INPUT_KEY = "include"
const OFFSET_INPUT_KEY = "offset"
const LIMIT_INPUT_KEY = "limit"
const HINT_MARKER = "[lru-hot]"
const HINT_LABEL = "recently active:"
const HINT_SUBJECT_SEPARATOR = ", "
const HINT_TEST_SUBJECT_CAP = 2
const HINT_DEFAULT_ENTRY_COUNT = 11
const DEFAULT_HINT_SUBJECT_COUNT = 10
const REPEAT_TRANSFORM_COUNT = 3
const NEGATIVE_HINT_SUBJECTS = -1
const SYSTEM_HOOK = "experimental.chat.system.transform"
const BASE_SYSTEM_BLOCK = "base system prompt block"
const SYSTEM_BLOCK_COUNT_WITH_HINT = 2
const LEGACY_HINT_SUBJECT = "/data/legacy.txt"
const HINT_SESSION_BOUND = 8
const HINT_SESSION_OVERFLOW_COUNT = 9
const FOREIGN_HINT_BLOCK_TAIL = "foreign config block"
const USER_TEXT_AFTER_BARE_MARKER = "plain user note"
const NO_SESSION_HINT_PATH = "/data/no-session-hint.txt"
const HINT_SKIP_RUN_PATH = "/data/hint-skip-run.txt"
const SYSTEM_GUARD_HINT_PATH = "/data/system-guard.txt"
const SYSTEM_GUARD_NON_ARRAY_VALUE = "not a block array"
const RELOAD_TOOL_NAME = "read_evicted"
const RELOAD_TOOL_MAP_KEY = "tool"
const RELOAD_POINTER_LEAD = " Evicted output stashed; reload it with"
const STASH_MARKER = "[lru-stash]"
const STASH_OLDER_LEAD = "older matches for subject"
const STASH_MESSAGE_LABEL = "at message"
const STASH_MATCH_SEPARATOR = "; "
const STASH_MISS_LEAD = "no stashed output for subject"
const STASH_MISS_HINT = "only outputs evicted during this session are stashed"
const STASH_INVALID_SUBJECT_LEAD = "requires a non-empty subject string"
const RECEIVED_LABEL = "received"
const UNKNOWN_TARGET_LABEL = "unknown target"
const STASH_LIMIT = 50
const STASH_OVERFLOW_COUNT = 51
const INVALID_SUBJECT_VALUE = 42
const STASH_ISOLATION_SUBJECT = "/data/shared-stash.txt"
const STASH_ISOLATION_SESSION_C = "lru-harness-session-c"
const DEDUP_MARKER = "[lru-deduped]"
const DEDUP_SUPERSEDED_LEAD = "identical call superseded by the newer output at message"
const DEDUP_PATH = "/data/dedup.txt"
const DEDUP_SECOND_PATH = "/data/dedup-second.txt"
const DEDUP_ENCODING_KEY = "encoding"
const DEDUP_ENCODING_VALUE = "utf-8"
const DEDUP_NESTED_TOP_KEY = "opts"
const DEDUP_NESTED_KEY_LATE = "z"
const DEDUP_NESTED_KEY_EARLY = "a"
const DEDUP_LEAF_KEY_LATE = "y"
const DEDUP_LEAF_KEY_EARLY = "b"
const DEDUP_NESTED_TOP_VALUE = 1
const DEDUP_LEAF_VALUE_LATE = 2
const DEDUP_LEAF_VALUE_EARLY = 3
const DEDUP_FILE_SUPERSEDED_LEAD = "identical attachment superseded by the newer attachment at message"
const FILE_MIME_TEXT = "text/plain"
const FILE_MIME_PDF = "application/pdf"
const FILE_URL = "file:///data/notes.txt"
const FILE_URL_OTHER = "file:///data/other.txt"
const FILE_FILENAME = "notes.txt"
const FILE_PART_ID = "prt_lru_file_fixture"
const PURGE_MARKER = "[lru-purged-input]"
const PURGE_ERROR_PATH = "/data/errored-purge.txt"
const PURGE_BOUNDARY_PATH = "/data/boundary-purge.txt"
const PURGE_PENDING_PATH = "/data/pending-purge.txt"
const PURGE_COMPLETED_PATH = "/data/completed-purge.txt"
const TASK_TOOL = "task"
const TODOWRITE_TOOL = "todowrite"
const PROTECTED_OUTPUT_BYTES = 3000
const PROTECTED_PRESSURE_SIBLING_PATH = "/data/pressure-sibling.txt"
const OVERRIDE_PROTECTED_PATH = "/data/override-protected.txt"
const INVALID_PROTECTED_TOOLS_VALUE = "todowrite"
const INVALID_PROTECTED_TOOLS_ENTRY = 42
const EMPTY_PROTECTED_TOOLS_ENTRY = ""
const STASH_PROTECTED_PATTERN = "protectedStashQuery"
const STASH_PROTECTED_VICTIM_PATH = "/data/stash-protected-victim.txt"
const PROTECTED_TASK_PROMPT = "summarize subagent findings"
const PROTECTED_COMMAND = "deploy --target staging"
const PROTECTED_PATTERN_EXACT = "/data/exact-protected.txt"
const PROTECTED_GLOB_PATTERN = "**/AGENTS.md"
const PROTECTED_GLOB_PATH = "/data/project/AGENTS.md"
const PROTECTED_SEGMENT_PATTERN = ".env*"
const PROTECTED_SEGMENT_PATH = "/data/project/.env.local"
const UNMATCHED_PROTECTED_PATTERN = "**/unrelated.md"
const UNPROTECTED_PLAIN_PATH = "/data/plain.txt"
const PROTECTED_COMMAND_PATTERN = "*deploy*"
const MATCH_ALL_PATTERN = "*"
const PROTECTED_PATTERNS_NON_ARRAY = "**/never.txt"
const PROTECTED_PATTERNS_NON_STRING_ENTRY = 42
const SUBJECTLESS_TOOL = "webfetch"
const SUBJECTLESS_TOOL_URL = "https://example.com/page"
const PROTECTED_DEDUP_PATH = "/data/pattern-dedup.txt"
const PROTECTED_DEDUP_GLOB = "**/pattern-dedup.txt"
const RANGED_PROTECTED_PATH = "/data/ranged-protected.txt"
const RANGED_PROTECTED_GLOB = "**/ranged-protected.txt"
const GREP_PROTECTED_SUBJECT_PATTERN = "*parseConfig*"
const PROTECTED_PRESSURE_BUNDLE_CHARS =
  PROTECTED_OUTPUT_BYTES * 2 + RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS
const PROTECTED_PRESSURE_DEFICIT_TOKENS = PROTECTED_OUTPUT_BYTES / CHARS_PER_TOKEN
const STASH_SESSION_BOUND = 8
const STASH_SESSION_OVERFLOW_COUNT = 9
const STASH_MISS_PROBE_SUBJECT = "/data/stash-probe-miss.txt"
const STASH_CROSS_RUN_FIRST_COUNT = 30
const STASH_CROSS_RUN_SECOND_COUNT = 25
const STASH_CROSS_RUN_DROP_COUNT = 5
const LIMIT_SESSION_BOUND = 8
const LIMIT_SESSION_OVERFLOW_COUNT = 9
const RENDERED_SUBJECT_CAP = 160
const ELLIPSIS_MARKER = "…"
const HEREDOC_LINE = "printf segment\n"
const HEREDOC_LINE_REPEAT = 200
const HEREDOC_COMMAND = HEREDOC_LINE.repeat(HEREDOC_LINE_REPEAT)
const DIGEST_POINTER_LEAD = " Output digest: "
const DIGEST_SENTENCE_TAIL = "."
const DIGEST_PIECE_SEPARATOR = " | "
const DIGEST_FIRST_LABEL = "first"
const DIGEST_LAST_LABEL = "last"
const DIGEST_HEAD_LABEL = "head"
const DIGEST_TAIL_LABEL = "tail"
const MAX_DIGEST_CHARS = 200
const GLOB_TOOL = "glob"
const DIGEST_READ_PATH = "/data/digest-read.txt"
const DIGEST_READ_OFFSET_LINES = 5
const DIGEST_READ_LIMIT_LINES = 10
const DIGEST_READ_FIRST_LINE = "first line of the digested file"
const DIGEST_READ_LAST_LINE = "last line of the digested file"
const DIGEST_MIDDLE_FILL_CHARS = 2100
const DIGEST_BASH_COMMAND = "make build"
const DIGEST_BASH_HEAD_LINE = "build error: module missing"
const DIGEST_BASH_TAIL_LINE = "exit status 1"
const DIGEST_EXCERPT_PATTERN = "digest-excerpt"
const DIGEST_EXCERPT_HEAD_LINE = "head excerpt sentinel line"
const DIGEST_BOUNDARY_FILL_CHAR = "E"
const DIGEST_OVERBOUND_SENTINEL = "BEYOND-BOUND-SECRET"
const DIGEST_VARIANT_FIRST_LINE_A = "variant one first line"
const DIGEST_VARIANT_FIRST_LINE_B = "variant two first line"
const DIGEST_VARIANT_PATH = "/data/digest-variant.txt"
const DIGEST_DETERMINISM_PATH = "/data/digest-determinism.txt"

const hintLineFor = (subjects: string[]): string =>
  `${HINT_MARKER} ${HINT_LABEL} ${subjects.join(HINT_SUBJECT_SEPARATOR)}`

type TextPart = { type: "text"; text: string }

type CompletedToolPart = {
  type: "tool"
  tool: string
  state: { status: "completed"; input: Record<string, unknown>; output: string }
}

type PendingToolPart = {
  type: "tool"
  tool: string
  state: { status: "pending"; input: Record<string, unknown>; output: string }
}

type ErrorToolPart = {
  type: "tool"
  tool: string
  state: { status: "error"; input: Record<string, unknown>; output: string }
}

type ReasoningPart = { type: "reasoning"; text: string; metadata?: Record<string, unknown> }

type AttachmentItem = Record<string, string>

type AttachedToolPart = {
  type: "tool"
  tool: string
  state: { status: "completed"; input: Record<string, unknown>; output: string; attachments: AttachmentItem[] }
}

type FileAttachmentPart = {
  type: "file"
  mime: string
  url: string
  filename?: string
  id?: string
}

type MessagePart =
  | TextPart
  | CompletedToolPart
  | PendingToolPart
  | ErrorToolPart
  | ReasoningPart
  | AttachedToolPart
  | FileAttachmentPart

type StatefulToolPart = { state: { input: unknown } }

type Message = {
  info: { sessionID?: string; role?: string }
  parts: Array<Record<string, unknown>>
}

type MessageBundle = { messages: Message[] }

type StrictMessage = { info: { sessionID?: string; role?: string }; parts: MessagePart[] }

type StrictBundle = { messages: StrictMessage[] }

type HookMap = Record<string, (input: unknown, output: unknown) => Promise<unknown>>

type ReloadToolDefinition = { execute: (args: unknown, context: unknown) => Promise<unknown> }

const textPart = (text: string): TextPart => ({ type: "text", text })

const completedToolPart = (tool: string, input: Record<string, unknown>, output: string): CompletedToolPart => ({
  type: "tool",
  tool,
  state: { status: "completed", input, output },
})

const syntheticMessage = (parts: MessagePart[]): Message => ({
  info: { sessionID: SESSION_ID },
  parts,
})

const buildSmallBundle = (): MessageBundle => ({
  messages: [
    syntheticMessage([textPart("m".repeat(SMALL_TEXT_CHARS))]),
    syntheticMessage([completedToolPart(BASH_TOOL, { command: "echo ok" }, "o".repeat(SMALL_TOOL_OUTPUT_CHARS))]),
  ],
})

const loadPluginHooks = async (): Promise<HookMap> =>
  (await lruContextFactory({}, { metricsLog: false, liveStateLog: false })) as HookMap

const loadPluginHooksWith = async (options: Record<string, unknown>): Promise<HookMap> =>
  (await lruContextFactory({}, { metricsLog: false, liveStateLog: false, ...options })) as HookMap

type HintPartRef = { messageIndex: number; partIndex: number; text: string }

const hintPartsIn = (bundle: StrictBundle): HintPartRef[] => {
  const found: HintPartRef[] = []
  bundle.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part, partIndex) => {
      const text = part["text"]
      if (part["type"] === "text" && typeof text === "string" && text.startsWith(HINT_MARKER)) {
        found.push({ messageIndex, partIndex, text })
      }
    })
  })
  return found
}

const runSystemTransform = async (
  hooks: HookMap,
  sessionID: string | undefined,
  blocks: string[] = [],
): Promise<string[]> => {
  const output: { system: string[] } = { system: blocks }
  await hooks[SYSTEM_HOOK]({ sessionID }, output)
  return blocks
}

const hintBlocksIn = (blocks: string[]): string[] => blocks.filter((block) => block.startsWith(HINT_MARKER))

const totalPartCount = (bundle: StrictBundle): number =>
  bundle.messages.reduce((count, message) => count + message.parts.length, 0)

const outputOfBytes = (bytes: number): string => "x".repeat(bytes)

const textOfChars = (chars: number): string => "t".repeat(chars)

const pendingToolPart = (tool: string, input: Record<string, unknown>, output: string): PendingToolPart => ({
  type: "tool",
  tool,
  state: { status: "pending", input, output },
})

const errorToolPart = (tool: string, input: Record<string, unknown>, output: string): ErrorToolPart => ({
  type: "tool",
  tool,
  state: { status: "error", input, output },
})

const reasoningPart = (text: string, metadata?: Record<string, unknown>): ReasoningPart =>
  metadata === undefined ? { type: "reasoning", text } : { type: "reasoning", text, metadata }

const pathToolPart = (path: string, outputBytes: number): CompletedToolPart =>
  completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: path }, outputOfBytes(outputBytes))

const bashToolPart = (command: string, outputBytes: number): CompletedToolPart =>
  completedToolPart(BASH_TOOL, { command }, outputOfBytes(outputBytes))

const fileAttachmentPart = (mime: string, url: string, filename?: string): FileAttachmentPart =>
  filename === undefined ? { type: "file", mime, url } : { type: "file", mime, url, filename }

const textMessages = (count: number, chars: number): MessagePart[][] =>
  Array.from({ length: count }, () => [textPart(textOfChars(chars))])

const fillerMessages = (count: number = RECENT_WINDOW_FILLER_MESSAGES): MessagePart[][] =>
  textMessages(count, FILLER_TEXT_CHARS)

const syntheticMessageFor = (sessionID: string, parts: MessagePart[]): StrictMessage => ({
  info: { sessionID },
  parts,
})

const buildBundle = (partsPerMessage: MessagePart[][], sessionID: string = SESSION_ID): StrictBundle => ({
  messages: partsPerMessage.map((parts) => syntheticMessageFor(sessionID, parts)),
})

const buildStandardBundle = (sessionID: string, path: string): StrictBundle =>
  buildBundle([[pathToolPart(path, MIN_EVICTABLE_BYTES)], ...fillerMessages()], sessionID)

const buildOverWatermarkProtectedBundle = (tool: string): StrictBundle =>
  buildBundle([[completedToolPart(tool, {}, outputOfBytes(MIN_EVICTABLE_BYTES))], ...fillerMessages()])

const FALLBACK_BUNDLE_LARGE_TEXT_CHARS =
  LEGACY_DEFAULT_WATERMARK_CHARS - MIN_EVICTABLE_BYTES - FALLBACK_TRAILING_FILLER_MESSAGES * FILLER_TEXT_CHARS
const LEGACY_FALLBACK_BUNDLE_OVER_WATERMARK_CHARS = FALLBACK_BUNDLE_LARGE_TEXT_CHARS + FALLBACK_EXTRA_CHARS

const buildFallbackBudgetBundle = (largeTextChars: number): StrictBundle =>
  buildBundle([
    [pathToolPart("/data/default.txt", MIN_EVICTABLE_BYTES)],
    [textPart(textOfChars(largeTextChars))],
    ...fillerMessages(FALLBACK_TRAILING_FILLER_MESSAGES),
  ])

const toolPartAt = (message: StrictMessage, partIndex: number): CompletedToolPart =>
  message.parts[partIndex] as CompletedToolPart

const inputAt = (message: StrictMessage): unknown => (message.parts[0] as StatefulToolPart).state.input

const tokensForChars = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN)

const contextForWatermarkTokens = (watermarkTokens: number): number => watermarkTokens / WATERMARK_RATIO

const contextForDeficit = (bundleChars: number, deficitTokens: number): number =>
  contextForWatermarkTokens(tokensForChars(bundleChars) - deficitTokens)

const setContextLimit = async (hooks: HookMap, sessionID: string, contextTokens: number): Promise<void> => {
  await hooks[CHAT_PARAMS_HOOK]({ sessionID, model: { limit: { context: contextTokens } } }, {})
}

const setChatParamsWithoutContext = async (hooks: HookMap, sessionID: string): Promise<void> => {
  await hooks[CHAT_PARAMS_HOOK]({ sessionID }, {})
}

const setChatParamsWithZeroContext = async (hooks: HookMap, sessionID: string): Promise<void> => {
  await hooks[CHAT_PARAMS_HOOK]({ sessionID, model: { limit: { context: ZERO_CONTEXT_LIMIT } } }, {})
}

const setChatParamsForModel = async (
  hooks: HookMap,
  sessionID: string,
  providerID: string,
  modelID: string,
  contextTokens: number | undefined,
): Promise<void> => {
  const model: Record<string, unknown> = { providerID, modelID }
  if (contextTokens !== undefined) model.limit = { context: contextTokens }
  await hooks[CHAT_PARAMS_HOOK]({ sessionID, model }, {})
}

const runTransform = async (hooks: HookMap, bundle: StrictBundle): Promise<void> => {
  await hooks[TRANSFORM_HOOK]({}, bundle)
}

const sleepMs = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const reloadPointerFor = (subject: string): string =>
  `${RELOAD_POINTER_LEAD} ${RELOAD_TOOL_NAME} (subject "${subject}").`

const digestLinesOf = (output: string): string[] => output.split(/\r\n|\r|\n/)

const boundedDigestOf = (text: string): string =>
  text.length > MAX_DIGEST_CHARS
    ? `${text.slice(0, MAX_DIGEST_CHARS - ELLIPSIS_MARKER.length)}${ELLIPSIS_MARKER}`
    : text

const digestPreviewFor = (label: string, line: string): string => `${label} "${line}"`

const outputDigestFor = (tool: string, subject: string, output: string): string => {
  const lines = digestLinesOf(output)
  const headLine = lines[0]
  const tailLine = lines[lines.length - 1]
  if (tool === READ_TOOL) {
    return boundedDigestOf(
      [subject, digestPreviewFor(DIGEST_FIRST_LABEL, headLine), digestPreviewFor(DIGEST_LAST_LABEL, tailLine)].join(DIGEST_PIECE_SEPARATOR),
    )
  }
  if (tool === BASH_TOOL) {
    return boundedDigestOf(
      [subject, digestPreviewFor(DIGEST_HEAD_LABEL, headLine), digestPreviewFor(DIGEST_TAIL_LABEL, tailLine)].join(DIGEST_PIECE_SEPARATOR),
    )
  }
  return boundedDigestOf(lines.join(" "))
}

const digestSentenceFor = (tool: string, subject: string, output: string): string =>
  `${DIGEST_POINTER_LEAD}${outputDigestFor(tool, subject, output)}${DIGEST_SENTENCE_TAIL}`

const stashMissFor = (subject: string): string =>
  `${STASH_MARKER} ${STASH_MISS_LEAD} "${subject}"; ${STASH_MISS_HINT}.`

const invalidSubjectMissFor = (received: string): string =>
  `${STASH_MARKER} ${RELOAD_TOOL_NAME} ${STASH_INVALID_SUBJECT_LEAD} (${RECEIVED_LABEL} ${received}).`

const olderMatchesLineFor = (subject: string, pointers: string[]): string =>
  `${STASH_MARKER} ${STASH_OLDER_LEAD} "${subject}": ${pointers.join(STASH_MATCH_SEPARATOR)}`

const pointerFor = (tool: string, msgIndex: number): string => `${tool} ${STASH_MESSAGE_LABEL} ${msgIndex}`

const dedupTombstoneFor = (tool: string, msgIndex: number): string =>
  `${DEDUP_MARKER} ${tool} ${DEDUP_SUPERSEDED_LEAD} ${msgIndex}`

const fileDedupTombstoneFor = (label: string, msgIndex: number): string =>
  `${DEDUP_MARKER} ${label} ${DEDUP_FILE_SUPERSEDED_LEAD} ${msgIndex}`

const readEvicted = async (hooks: HookMap, subject: unknown, sessionID: string): Promise<unknown> =>
  (hooks as Record<string, Record<string, ReloadToolDefinition>>)[RELOAD_TOOL_MAP_KEY][RELOAD_TOOL_NAME].execute(
    { subject },
    { sessionID },
  )

test("experimental.chat.messages.transform accepts a small synthetic bundle without error and leaves it untouched", async () => {
  const hooks = await loadPluginHooks()
  const transform = hooks[TRANSFORM_HOOK]
  assert.equal(typeof transform, "function")

  const bundle = buildSmallBundle()
  const snapshot = structuredClone(bundle)
  await transform({}, bundle)

  assert.deepEqual(bundle, snapshot)
})

test("transform leaves every output untouched when the estimate equals the watermark exactly", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, 0))

  const bundle = buildStandardBundle(SESSION_ID, "/data/a.txt")
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform leaves every output untouched when the estimate sits under the watermark", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(
    hooks,
    SESSION_ID,
    contextForWatermarkTokens(tokensForChars(STANDARD_BUNDLE_CHARS) + HEADROOM_TOKENS),
  )

  const bundle = buildStandardBundle(SESSION_ID, "/data/a.txt")
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform evicts the coldest output when the estimate exceeds the watermark by one token", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, "/data/a.txt")
  await runTransform(hooks, bundle)

  const evicted = toolPartAt(bundle.messages[0], 0).state.output
  assert.ok(evicted.startsWith(TOMBSTONE_MARKER))
  assert.ok(evicted.includes("(2048 bytes,"))
})

test("transform evicts only the coldest entry when one eviction covers the deficit", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(THREE_ENTRY_BUNDLE_CHARS, PARTIAL_DEFICIT_TOKENS))

  const bundle = buildBundle([
    [pathToolPart("/data/a.txt", THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart("/data/b.txt", THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart("/data/c.txt", THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(toolPartAt(bundle.messages[2], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
})

test("transform evicts multiple entries until the deficit is covered and keeps the newest entry", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(THREE_ENTRY_BUNDLE_CHARS, TWO_ENTRY_DEFICIT_TOKENS))

  const bundle = buildBundle([
    [pathToolPart("/data/a.txt", THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart("/data/b.txt", THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart("/data/c.txt", THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.ok(toolPartAt(bundle.messages[1], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(bundle.messages[2], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
})

test("transform evicts the coldest entry first when over watermark regardless of output size", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(
    hooks,
    SESSION_ID,
    contextForDeficit(COLD_NEW_BUNDLE_CHARS, tokensForChars(COLD_OUTPUT_BYTES)),
  )

  const bundle = buildBundle([
    [pathToolPart("/data/cold.txt", COLD_OUTPUT_BYTES)],
    [pathToolPart("/data/new.txt", NEW_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, outputOfBytes(NEW_OUTPUT_BYTES))
})

test("transform evicts the larger output first when entries share the same last touch", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(
    hooks,
    SESSION_ID,
    contextForDeficit(COLD_NEW_BUNDLE_CHARS, tokensForChars(COLD_OUTPUT_BYTES)),
  )

  const bundle = buildBundle([
    [pathToolPart("/data/small.txt", COLD_OUTPUT_BYTES), pathToolPart("/data/large.txt", NEW_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(COLD_OUTPUT_BYTES))
  assert.ok(toolPartAt(bundle.messages[0], 1).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform protects a path output refreshed by a later tool call on the same path", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(REFRESHED_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(1),
    [pathToolPart(REFRESHED_PATH, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(bundle.messages[2], 0).state.output, outputOfBytes(APPEARANCE_ONLY_OUTPUT_BYTES))
})

test("transform refreshes a path output last touch to the message index of the later call", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(REFRESHED_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(1),
    [pathToolPart(REFRESHED_PATH, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(4),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} read ${REFRESHED_PATH} (2048 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(READ_TOOL, REFRESHED_PATH, outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor(REFRESHED_PATH)}`,
  )
})

test("transform refreshes a bash entry last touch on exact command match", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [bashToolPart(BASH_ENTRY_COMMAND, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [bashToolPart(BASH_ENTRY_COMMAND, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(4),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} bash ${BASH_ENTRY_COMMAND} (2048 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(BASH_TOOL, BASH_ENTRY_COMMAND, outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor(BASH_ENTRY_COMMAND)}`,
  )
})

test("transform refreshes a bash entry via substring match when the entry subject exceeds three characters", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [bashToolPart(SUBSTRING_ENTRY_COMMAND, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [bashToolPart(SUBSTRING_APPEARANCE_COMMAND, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(1),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(APPEARANCE_ONLY_OUTPUT_BYTES))
})

test("transform evicts a bash entry when the substring match is blocked at exactly three characters", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [bashToolPart(SHORT_SUBSTRING_ENTRY_COMMAND, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [bashToolPart(SHORT_SUBSTRING_APPEARANCE_COMMAND, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(1),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} bash ${SHORT_SUBSTRING_ENTRY_COMMAND} (2048 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(BASH_TOOL, SHORT_SUBSTRING_ENTRY_COMMAND, outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor(SHORT_SUBSTRING_ENTRY_COMMAND)}`,
  )
})

test("transform never evicts an entry whose last touch sits at the recent window boundary", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
    [pathToolPart("/data/old.txt", MIN_EVICTABLE_BYTES)],
    [pathToolPart("/data/hot.txt", MIN_EVICTABLE_BYTES)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES - 1),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[RECENT_WINDOW_MESSAGES + 1], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(
    toolPartAt(bundle.messages[RECENT_WINDOW_MESSAGES + 2], 0).state.output,
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("transform never evicts outputs one byte below the size floor", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([[pathToolPart("/data/floor.txt", MIN_EVICTABLE_BYTES - 1)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES - 1))
})

test("transform evicts outputs exactly at the size floor", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, "/data/floor.txt")
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} read /data/floor.txt (2048 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(READ_TOOL, "/data/floor.txt", outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor("/data/floor.txt")}`,
  )
})

test("transform writes a tombstone naming the tool first subject byte count and message age", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [
      completedToolPart(
        READ_TOOL,
        { [PATH_INPUT_KEY]: "/data/first.txt", [SECONDARY_PATH_INPUT_KEY]: "/data/second.txt" },
        outputOfBytes(THREE_ENTRY_OUTPUT_BYTES),
      ),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const output = toolPartAt(bundle.messages[0], 0).state.output
  assert.equal(output, `${TOMBSTONE_MARKER} read /data/first.txt (3000 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(READ_TOOL, "/data/first.txt", outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))}${reloadPointerFor("/data/first.txt")}`)
  assert.ok(!output.includes("/data/second.txt"))
})

test("transform writes unknown target into the tombstone for an entry without subjects", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [completedToolPart(READ_TOOL, {}, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} read unknown target (3000 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(READ_TOOL, UNKNOWN_TARGET_LABEL, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))}${reloadPointerFor(UNKNOWN_TARGET_LABEL)}`,
  )
})

test("transform writes a read digest naming the ranged path and previews of the first and last output lines", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const subject = `${DIGEST_READ_PATH}:${DIGEST_READ_OFFSET_LINES}-${DIGEST_READ_OFFSET_LINES + DIGEST_READ_LIMIT_LINES}`
  const output = [DIGEST_READ_FIRST_LINE, outputOfBytes(DIGEST_MIDDLE_FILL_CHARS), DIGEST_READ_LAST_LINE].join("\n")
  const bundle = buildBundle([
    [
      completedToolPart(
        READ_TOOL,
        {
          [PATH_INPUT_KEY]: DIGEST_READ_PATH,
          [OFFSET_INPUT_KEY]: DIGEST_READ_OFFSET_LINES,
          [LIMIT_INPUT_KEY]: DIGEST_READ_LIMIT_LINES,
        },
        output,
      ),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const tombstone = toolPartAt(bundle.messages[0], 0).state.output
  const digest = outputDigestFor(READ_TOOL, subject, output)
  assert.ok(digest.includes(`${DIGEST_FIRST_LABEL} "${DIGEST_READ_FIRST_LINE}"`))
  assert.ok(digest.includes(`${DIGEST_LAST_LABEL} "${DIGEST_READ_LAST_LINE}"`))
  assert.ok(digest.includes(subject))
  assert.ok(!digest.includes("\n"))
  assert.equal(
    tombstone,
    `${TOMBSTONE_MARKER} read ${subject} (${output.length} bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(READ_TOOL, subject, output)}${reloadPointerFor(subject)}`,
  )
})

test("transform writes a bash digest naming the command with head and tail output lines collapsed to one line", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const output = [DIGEST_BASH_HEAD_LINE, outputOfBytes(DIGEST_MIDDLE_FILL_CHARS), DIGEST_BASH_TAIL_LINE].join("\r\n")
  const bundle = buildBundle([[completedToolPart(BASH_TOOL, { command: DIGEST_BASH_COMMAND }, output)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  const tombstone = toolPartAt(bundle.messages[0], 0).state.output
  const digest = outputDigestFor(BASH_TOOL, DIGEST_BASH_COMMAND, output)
  assert.ok(digest.includes(`${DIGEST_HEAD_LABEL} "${DIGEST_BASH_HEAD_LINE}"`))
  assert.ok(digest.includes(`${DIGEST_TAIL_LABEL} "${DIGEST_BASH_TAIL_LINE}"`))
  assert.ok(digest.includes(DIGEST_BASH_COMMAND))
  assert.ok(!tombstone.includes("\n"))
  assert.ok(!tombstone.includes("\r"))
  assert.equal(
    tombstone,
    `${TOMBSTONE_MARKER} bash ${DIGEST_BASH_COMMAND} (${output.length} bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(BASH_TOOL, DIGEST_BASH_COMMAND, output)}${reloadPointerFor(DIGEST_BASH_COMMAND)}`,
  )
})

test("transform writes a head excerpt digest for tools that are neither read nor bash", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const output = `${DIGEST_EXCERPT_HEAD_LINE}\n${outputOfBytes(DIGEST_MIDDLE_FILL_CHARS)}`
  const bundle = buildBundle([
    [completedToolPart(GLOB_TOOL, { [PATTERN_INPUT_KEY]: DIGEST_EXCERPT_PATTERN }, output)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const tombstone = toolPartAt(bundle.messages[0], 0).state.output
  const digest = outputDigestFor(GLOB_TOOL, DIGEST_EXCERPT_PATTERN, output)
  assert.ok(digest.startsWith(DIGEST_EXCERPT_HEAD_LINE))
  assert.ok(!digest.includes("\n"))
  assert.equal(
    tombstone,
    `${TOMBSTONE_MARKER} glob ${DIGEST_EXCERPT_PATTERN} (${output.length} bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(GLOB_TOOL, DIGEST_EXCERPT_PATTERN, output)}${reloadPointerFor(DIGEST_EXCERPT_PATTERN)}`,
  )
})

test("transform caps the digest at the bound exactly and leaks nothing beyond it", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const output = `${DIGEST_BOUNDARY_FILL_CHAR.repeat(MAX_DIGEST_CHARS)}${DIGEST_OVERBOUND_SENTINEL}${outputOfBytes(DIGEST_MIDDLE_FILL_CHARS)}`
  const bundle = buildBundle([
    [completedToolPart(GLOB_TOOL, { [PATTERN_INPUT_KEY]: DIGEST_EXCERPT_PATTERN }, output)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const tombstone = toolPartAt(bundle.messages[0], 0).state.output
  const digestStart = tombstone.indexOf(DIGEST_POINTER_LEAD) + DIGEST_POINTER_LEAD.length
  const digest = tombstone.slice(digestStart, tombstone.indexOf(DIGEST_SENTENCE_TAIL, digestStart))
  assert.equal(digest.length, MAX_DIGEST_CHARS)
  assert.ok(digest.endsWith(ELLIPSIS_MARKER))
  assert.ok(digest.startsWith(DIGEST_BOUNDARY_FILL_CHAR.repeat(MAX_DIGEST_CHARS - ELLIPSIS_MARKER.length)))
  assert.ok(!digest.includes(DIGEST_OVERBOUND_SENTINEL))
})

test("transform derives an identical tombstone digest from identical evicted content in two sessions", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setContextLimit(hooks, SESSION_ID_B, WATERMARK_PROBE_CONTEXT_LIMIT)

  const sessionA = buildBundle([[pathToolPart(DIGEST_DETERMINISM_PATH, MIN_EVICTABLE_BYTES)], ...fillerMessages()], SESSION_ID)
  const sessionB = buildBundle([[pathToolPart(DIGEST_DETERMINISM_PATH, MIN_EVICTABLE_BYTES)], ...fillerMessages()], SESSION_ID_B)
  await runTransform(hooks, sessionB)
  await runTransform(hooks, sessionA)

  assert.equal(toolPartAt(sessionA.messages[0], 0).state.output, toolPartAt(sessionB.messages[0], 0).state.output)
})

test("transform derives distinct digests from evicted content that differs only in its first line", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setContextLimit(hooks, SESSION_ID_B, WATERMARK_PROBE_CONTEXT_LIMIT)

  const outputA = `${DIGEST_VARIANT_FIRST_LINE_A}\n${outputOfBytes(DIGEST_MIDDLE_FILL_CHARS)}`
  const outputB = `${DIGEST_VARIANT_FIRST_LINE_B}\n${outputOfBytes(DIGEST_MIDDLE_FILL_CHARS)}`
  const sessionA = buildBundle(
    [[completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: DIGEST_VARIANT_PATH }, outputA)], ...fillerMessages()],
    SESSION_ID,
  )
  const sessionB = buildBundle(
    [[completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: DIGEST_VARIANT_PATH }, outputB)], ...fillerMessages()],
    SESSION_ID_B,
  )
  await runTransform(hooks, sessionB)
  await runTransform(hooks, sessionA)

  const digestOf = (tombstone: string): string => {
    const digestStart = tombstone.indexOf(DIGEST_POINTER_LEAD) + DIGEST_POINTER_LEAD.length
    return tombstone.slice(digestStart, tombstone.indexOf(RELOAD_POINTER_LEAD, digestStart))
  }
  const tombstoneA = toolPartAt(sessionA.messages[0], 0).state.output
  const tombstoneB = toolPartAt(sessionB.messages[0], 0).state.output
  assert.ok(tombstoneA.startsWith(TOMBSTONE_MARKER))
  assert.ok(tombstoneB.startsWith(TOMBSTONE_MARKER))
  assert.notEqual(digestOf(tombstoneA), digestOf(tombstoneB))
})

test("transform skips outputs already starting with the eviction marker", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const markedOutput = `${TOMBSTONE_MARKER}${"z".repeat(MARKER_PADDED_CHARS)}`
  const bundle = buildBundle([
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: "/data/already.txt" }, markedOutput)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, markedOutput)
})

test("transform leaves tombstones unchanged on a second transform pass", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart("/data/a.txt", THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart("/data/b.txt", THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)
  const afterFirstPass = structuredClone(bundle)
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle, afterFirstPass)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.ok(toolPartAt(bundle.messages[1], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform applies the chat params context limit while a session without one stays intact", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, SMALL_CONTEXT_LIMIT)

  const limited = buildStandardBundle(SESSION_ID, "/data/limited.txt")
  const unknownBudget = buildStandardBundle(SESSION_ID_B, "/data/unknown-budget.txt")
  await runTransform(hooks, unknownBudget)
  await runTransform(hooks, limited)

  assert.ok(toolPartAt(limited.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(unknownBudget.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform keeps an unregistered session bundle intact past the legacy default watermark", async () => {
  const hooks = await loadPluginHooks()
  const bundle = buildFallbackBudgetBundle(LEGACY_FALLBACK_BUNDLE_OVER_WATERMARK_CHARS)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform skips budget-driven eviction when chat params carry no context limit", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsWithoutContext(hooks, SESSION_ID)

  const bundle = buildFallbackBudgetBundle(LEGACY_FALLBACK_BUNDLE_OVER_WATERMARK_CHARS)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform purges errored tool inputs on an unknown-budget run that skips eviction", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsWithoutContext(hooks, SESSION_ID)

  const bundle = buildBundle([
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])
  await runTransform(hooks, bundle)

  assert.equal(inputAt(bundle.messages[0]), PURGE_MARKER)
})

test("transform delivers a hint on an unknown-budget run that skips eviction", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsWithoutContext(hooks, SESSION_ID)

  const bundle = buildStandardBundle(SESSION_ID, HINT_SKIP_RUN_PATH)
  await runTransform(hooks, bundle)

  assert.deepEqual(hintBlocksIn(await runSystemTransform(hooks, SESSION_ID)), [hintLineFor([HINT_SKIP_RUN_PATH])])
})

test("transform honors an explicit defaultContextTokens option by evicting against it without a captured limit", async () => {
  const pressuredHooks = await loadPluginHooksWith({ defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })
  const pressured = buildStandardBundle(SESSION_ID, "/data/explicit-budget.txt")
  await runTransform(pressuredHooks, pressured)

  const spaciousHooks = await loadPluginHooksWith({ defaultContextTokens: LARGE_DEFAULT_CONTEXT_TOKENS })
  const spacious = buildStandardBundle(SESSION_ID, "/data/explicit-budget.txt")
  await runTransform(spaciousHooks, spacious)

  assert.ok(toolPartAt(pressured.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(spacious.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform keeps the captured limit in charge when an explicit defaultContextTokens option is also set", async () => {
  const hooks = await loadPluginHooksWith({ defaultContextTokens: LARGE_DEFAULT_CONTEXT_TOKENS })
  await setContextLimit(hooks, SESSION_ID, SMALL_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, "/data/captured-wins.txt")
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.modelContextTokens, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
})

test("transform lets the per model override beat the model reported limit and labels the budget source override", async () => {
  const hooks = await loadPluginHooksWith({ modelContextTokens: { [OVERRIDE_MODEL_KEY]: SMALL_CONTEXT_LIMIT } })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, LARGE_DEFAULT_CONTEXT_TOKENS)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-beats-reported.txt")
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.modelContextTokens, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
})

test("transform lets the per model override beat the explicit defaultContextTokens option when no limit was reported", async () => {
  const hooks = await loadPluginHooksWith({
    modelContextTokens: { [OVERRIDE_MODEL_KEY]: SMALL_CONTEXT_LIMIT },
    defaultContextTokens: LARGE_DEFAULT_CONTEXT_TOKENS,
  })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, undefined)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-beats-default.txt")
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.modelContextTokens, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
})

test("transform applies the per model override when chat params carry no reported context limit", async () => {
  const hooks = await loadPluginHooksWith({ modelContextTokens: { [OVERRIDE_MODEL_KEY]: SMALL_CONTEXT_LIMIT } })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, undefined)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-without-reported.txt")
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.modelContextTokens, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
})

test("transform ignores per model map entries for unknown model ids and keeps the reported limit in charge", async () => {
  const hooks = await loadPluginHooksWith({ modelContextTokens: { [OTHER_MODEL_KEY]: SMALL_CONTEXT_LIMIT } })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-unknown-model.txt")
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.modelContextTokens, WATERMARK_PROBE_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
})

test("transform ignores non numeric override entries and falls through to the explicit default", async () => {
  const hooks = await loadPluginHooksWith({
    modelContextTokens: { [OVERRIDE_MODEL_KEY]: INVALID_OVERRIDE_ENTRY },
    defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS,
  })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, undefined)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-invalid-entry.txt")
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.modelContextTokens, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
})

test("transform ignores infinite override entries and an infinite defaultContextTokens option and falls through to the unknown budget", async () => {
  const hooks = await loadPluginHooksWith({
    modelContextTokens: { [OVERRIDE_MODEL_KEY]: INFINITE_OVERRIDE_ENTRY },
    defaultContextTokens: INFINITE_DEFAULT_CONTEXT_TOKENS,
  })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, undefined)

  const bundle = buildStandardBundle(SESSION_ID, "/data/infinite-values.txt")
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.deepEqual(stats.options.modelContextTokens, {})
  assert.equal(stats.options.defaultContextTokens, null)
  assert.equal(stats.modelContextTokens, null)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
})

test("transform ignores an infinite model reported limit and falls through to the explicit defaultContextTokens option", async () => {
  const hooks = await loadPluginHooksWith({ defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, INFINITE_REPORTED_CONTEXT)

  const bundle = buildStandardBundle(SESSION_ID, "/data/infinite-reported.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
})

test("transform keeps a stored real context limit when a later chat params event carries none", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setChatParamsWithoutContext(hooks, SESSION_ID)

  const bundle = buildStandardBundle(SESSION_ID, "/data/retained-limit.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform keeps a stored real context limit when a later chat params event carries a zero limit", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setChatParamsWithZeroContext(hooks, SESSION_ID)

  const bundle = buildStandardBundle(SESSION_ID, "/data/retained-limit-zero.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform keeps session budgets isolated across repeated transforms with no cross talk", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, ISOLATION_CONTEXT_LIMIT_A)
  await setContextLimit(hooks, SESSION_ID_B, ISOLATION_CONTEXT_LIMIT_B)

  const sessionB = buildStandardBundle(SESSION_ID_B, "/data/shared.txt")
  const sessionA = buildStandardBundle(SESSION_ID, "/data/shared.txt")
  await runTransform(hooks, sessionB)
  await runTransform(hooks, sessionA)
  await runTransform(hooks, sessionB)

  assert.ok(toolPartAt(sessionA.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(sessionB.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform resets a stored budget captured for one model when a later chat params event names a different model without a limit", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setChatParamsForModel(hooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID)

  const bundle = buildStandardBundle(SESSION_ID, "/data/model-switch-reset.txt")
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, null)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: null,
    deficitTokens: null,
  })
})

test("transform retains a stored budget when a later chat params event re-fires the same model without a limit", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID)

  const bundle = buildStandardBundle(SESSION_ID, "/data/model-same-retain.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, WATERMARK_PROBE_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
})

test("transform retains a stored identity-less budget when a later chat params event names a different model without a limit", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setChatParamsForModel(hooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID)

  const bundle = buildStandardBundle(SESSION_ID, "/data/model-identity-less-retain.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, WATERMARK_PROBE_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
})

test("transform replaces the stored budget when a later chat params event names a different model with its own reported limit", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, ISOLATION_CONTEXT_LIMIT_A)
  await setChatParamsForModel(hooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID, ISOLATION_CONTEXT_LIMIT_B)

  const bundle = buildStandardBundle(SESSION_ID, "/data/model-switch-limit.txt")
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, ISOLATION_CONTEXT_LIMIT_B)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
})

test("transform counts text parts toward the token estimate", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, TEXT_BUDGET_CONTEXT_LIMIT)

  const withoutExtraText = buildStandardBundle(SESSION_ID, "/data/counted.txt")
  const withExtraText = buildBundle([
    [pathToolPart("/data/counted.txt", MIN_EVICTABLE_BYTES), textPart(textOfChars(EXTRA_TEXT_CHARS))],
    ...fillerMessages(),
  ])
  await runTransform(hooks, withoutExtraText)
  await runTransform(hooks, withExtraText)

  assert.equal(toolPartAt(withoutExtraText.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.ok(toolPartAt(withExtraText.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform ignores pending and error tool outputs in the token estimate", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, TEXT_BUDGET_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart("/data/completed.txt", MIN_EVICTABLE_BYTES)],
    [pendingToolPart(READ_TOOL, { [PATH_INPUT_KEY]: "/data/pending.txt" }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: "/data/error.txt" }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal((bundle.messages[1].parts[0] as PendingToolPart).state.output, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))
  assert.equal((bundle.messages[2].parts[0] as ErrorToolPart).state.output, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))
})

test("transform never rewrites pending or error tool outputs", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pendingToolPart(READ_TOOL, { [PATH_INPUT_KEY]: "/data/pending.txt" }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: "/data/error.txt" }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...textMessages(OVER_WATERMARK_FILLER_MESSAGES, OVER_WATERMARK_FILLER_TEXT_CHARS),
  ])
  await runTransform(hooks, bundle)

  assert.equal((bundle.messages[0].parts[0] as PendingToolPart).state.output, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))
  assert.equal((bundle.messages[1].parts[0] as ErrorToolPart).state.output, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))
})

test("transform accepts an empty messages array without mutation", async () => {
  const hooks = await loadPluginHooks()
  const bundle: StrictBundle = { messages: [] }
  await runTransform(hooks, bundle)

  assert.equal(bundle.messages.length, 0)
})

test("transform leaves a single message bundle untouched despite being over watermark", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([[pathToolPart("/data/solo.txt", SINGLE_MESSAGE_OUTPUT_BYTES)]])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(SINGLE_MESSAGE_OUTPUT_BYTES))
})

test("transform renders a read range subject as path start end in the tombstone", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [
      completedToolPart(
        READ_TOOL,
        { [PATH_INPUT_KEY]: RANGE_PATH, [OFFSET_INPUT_KEY]: READ_OFFSET_LINES, [LIMIT_INPUT_KEY]: READ_LIMIT_LINES },
        outputOfBytes(THREE_ENTRY_OUTPUT_BYTES),
      ),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} read ${RANGE_PATH}:${READ_OFFSET_LINES}-${READ_OFFSET_LINES + READ_LIMIT_LINES} (3000 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(READ_TOOL, `${RANGE_PATH}:${READ_OFFSET_LINES}-${READ_OFFSET_LINES + READ_LIMIT_LINES}`, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))}${reloadPointerFor(`${RANGE_PATH}:${READ_OFFSET_LINES}-${READ_OFFSET_LINES + READ_LIMIT_LINES}`)}`,
  )
})

test("transform renders a grep pattern subject in the tombstone", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [
      completedToolPart(
        GREP_TOOL,
        { [PATTERN_INPUT_KEY]: PATTERN_QUERY, [INCLUDE_INPUT_KEY]: INCLUDE_GLOB },
        outputOfBytes(THREE_ENTRY_OUTPUT_BYTES),
      ),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} grep ${PATTERN_QUERY} (3000 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(GREP_TOOL, PATTERN_QUERY, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))}${reloadPointerFor(PATTERN_QUERY)}`,
  )
})

test("transform still extracts a pattern subject when include is not a string", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [
      completedToolPart(
        GREP_TOOL,
        { [PATTERN_INPUT_KEY]: PATTERN_QUERY, [INCLUDE_INPUT_KEY]: INCLUDE_NUMERIC },
        outputOfBytes(THREE_ENTRY_OUTPUT_BYTES),
      ),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} grep ${PATTERN_QUERY} (3000 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(GREP_TOOL, PATTERN_QUERY, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))}${reloadPointerFor(PATTERN_QUERY)}`,
  )
})

test("transform refreshes a ranged entry when a whole path call hits the same path later", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [
      completedToolPart(
        READ_TOOL,
        {
          [PATH_INPUT_KEY]: REFRESHED_PATH,
          [OFFSET_INPUT_KEY]: RANGED_ENTRY_OFFSET,
          [LIMIT_INPUT_KEY]: RANGED_ENTRY_LIMIT,
        },
        outputOfBytes(MIN_EVICTABLE_BYTES),
      ),
    ],
    ...fillerMessages(1),
    [pathToolPart(REFRESHED_PATH, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(4),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} read ${REFRESHED_PATH}:${RANGED_ENTRY_OFFSET}-${RANGED_ENTRY_OFFSET + RANGED_ENTRY_LIMIT} (2048 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(READ_TOOL, `${REFRESHED_PATH}:${RANGED_ENTRY_OFFSET}-${RANGED_ENTRY_OFFSET + RANGED_ENTRY_LIMIT}`, outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor(`${REFRESHED_PATH}:${RANGED_ENTRY_OFFSET}-${RANGED_ENTRY_OFFSET + RANGED_ENTRY_LIMIT}`)}`,
  )
})

test("transform refreshes a whole path entry when a ranged call hits the same path later", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(REFRESHED_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(1),
    [
      completedToolPart(
        READ_TOOL,
        {
          [PATH_INPUT_KEY]: REFRESHED_PATH,
          [OFFSET_INPUT_KEY]: RANGED_ENTRY_OFFSET,
          [LIMIT_INPUT_KEY]: RANGED_ENTRY_LIMIT,
        },
        outputOfBytes(APPEARANCE_ONLY_OUTPUT_BYTES),
      ),
    ],
    ...fillerMessages(4),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} read ${REFRESHED_PATH} (2048 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(READ_TOOL, REFRESHED_PATH, outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor(REFRESHED_PATH)}`,
  )
})

test("transform refreshes a pattern entry regardless of its include qualifier", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [
      completedToolPart(
        GREP_TOOL,
        { [PATTERN_INPUT_KEY]: PATTERN_QUERY, [INCLUDE_INPUT_KEY]: INCLUDE_GLOB },
        outputOfBytes(MIN_EVICTABLE_BYTES),
      ),
    ],
    ...fillerMessages(1),
    [completedToolPart(GREP_TOOL, { [PATTERN_INPUT_KEY]: PATTERN_QUERY }, outputOfBytes(APPEARANCE_ONLY_OUTPUT_BYTES))],
    ...fillerMessages(4),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} grep ${PATTERN_QUERY} (2048 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(GREP_TOOL, PATTERN_QUERY, outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor(PATTERN_QUERY)}`,
  )
})

test("transform keeps every message part byte-identical while the hint reaches the system prompt", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart("/data/older.txt", MIN_EVICTABLE_BYTES)],
    [pathToolPart("/data/newer.txt", MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
  ])
  const snapshot = structuredClone(bundle)
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle, snapshot)
  assert.equal(hintPartsIn(bundle).length, 0)
  const blocks = await runSystemTransform(hooks, SESSION_ID, [BASE_SYSTEM_BLOCK])
  assert.equal(hintBlocksIn(blocks).length, 1)
})

test("chat system transform appends a single hint block listing live subjects most recent first", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart("/data/older.txt", MIN_EVICTABLE_BYTES)],
    [pathToolPart("/data/newer.txt", MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  const blocks = await runSystemTransform(hooks, SESSION_ID, [BASE_SYSTEM_BLOCK])
  assert.equal(blocks.length, SYSTEM_BLOCK_COUNT_WITH_HINT)
  assert.equal(blocks[0], BASE_SYSTEM_BLOCK)
  assert.equal(blocks[1], hintLineFor(["/data/newer.txt", "/data/older.txt"]))
  assert.ok(!blocks[1].includes("\n"))
})

test("chat system transform replaces a prior hint block in place keeping one block", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([[pathToolPart("/data/a.txt", MIN_EVICTABLE_BYTES)], ...fillerMessages(2)])
  await runTransform(hooks, bundle)

  const blocks = await runSystemTransform(hooks, SESSION_ID, [hintLineFor([LEGACY_HINT_SUBJECT]), BASE_SYSTEM_BLOCK])
  assert.equal(blocks.length, SYSTEM_BLOCK_COUNT_WITH_HINT)
  assert.equal(blocks[0], hintLineFor(["/data/a.txt"]))
  assert.equal(blocks[1], BASE_SYSTEM_BLOCK)
})

test("chat system transform keeps a foreign block that starts with the bare hint marker and appends the stored hint separately", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([[pathToolPart("/data/a.txt", MIN_EVICTABLE_BYTES)], ...fillerMessages(2)])
  await runTransform(hooks, bundle)

  const foreignBlock = `${HINT_MARKER} ${FOREIGN_HINT_BLOCK_TAIL}`
  const blocks = await runSystemTransform(hooks, SESSION_ID, [foreignBlock, BASE_SYSTEM_BLOCK])

  assert.equal(blocks.length, SYSTEM_BLOCK_COUNT_WITH_HINT + 1)
  assert.equal(blocks[0], foreignBlock)
  assert.equal(blocks[1], BASE_SYSTEM_BLOCK)
  assert.equal(blocks[2], hintLineFor(["/data/a.txt"]))
})

test("chat system transform leaves the system blocks untouched for a session without a stored hint", async () => {
  const hooks = await loadPluginHooks()

  const blocks = await runSystemTransform(hooks, SESSION_ID, [BASE_SYSTEM_BLOCK])

  assert.deepEqual(blocks, [BASE_SYSTEM_BLOCK])
})

test("transform strips a legacy hint text part recorded inside a message by earlier delivery", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart("/data/older.txt", MIN_EVICTABLE_BYTES)],
    [textPart(hintLineFor([LEGACY_HINT_SUBJECT]))],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(hintPartsIn(bundle).length, 0)
  const blocks = await runSystemTransform(hooks, SESSION_ID)
  assert.equal(hintBlocksIn(blocks).length, 1)
  assert.equal(blocks[0], hintLineFor(["/data/older.txt"]))
})

test("transform preserves a user text part that starts with the bare hint marker without the hint label", async () => {
  const hooks = await loadPluginHooks()
  const userText = `${HINT_MARKER} ${USER_TEXT_AFTER_BARE_MARKER}`

  const bundle = buildBundle([
    [pathToolPart("/data/older.txt", MIN_EVICTABLE_BYTES)],
    [textPart(userText)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(
    bundle.messages[1].parts.map((part) => part["text"]),
    [userText],
  )
})

const buildNoSessionBundle = (partsPerMessage: MessagePart[][]): StrictBundle => ({
  messages: partsPerMessage.map((parts) => ({ info: {}, parts })),
})

test("chat system transform delivers the hint stored under the no-session fallback when the system hook carries no session id", async () => {
  const hooks = await loadPluginHooks()
  await runTransform(
    hooks,
    buildNoSessionBundle([[pathToolPart(NO_SESSION_HINT_PATH, MIN_EVICTABLE_BYTES)], ...fillerMessages(2)]),
  )

  const blocks = await runSystemTransform(hooks, undefined)

  assert.equal(hintBlocksIn(blocks).length, 1)
  assert.equal(blocks[0], hintLineFor([NO_SESSION_HINT_PATH]))
})

test("chat system transform is a no-op without throwing when the system output is not an array", async () => {
  const hooks = await loadPluginHooks()
  const bundle = buildBundle([[pathToolPart(SYSTEM_GUARD_HINT_PATH, MIN_EVICTABLE_BYTES)], ...fillerMessages(2)])
  await runTransform(hooks, bundle)

  const output = { system: SYSTEM_GUARD_NON_ARRAY_VALUE } as unknown as { system: string[] }
  await hooks[SYSTEM_HOOK]({ sessionID: SESSION_ID }, output)

  assert.equal(output.system, SYSTEM_GUARD_NON_ARRAY_VALUE)
})

test("chat system transform caps the hint at the configured subject count keeping the most recent", async () => {
  const hooks = await loadPluginHooksWith({ hintSubjects: HINT_TEST_SUBJECT_CAP })

  const bundle = buildBundle([
    [pathToolPart("/data/a.txt", MIN_EVICTABLE_BYTES)],
    [pathToolPart("/data/b.txt", MIN_EVICTABLE_BYTES)],
    [pathToolPart("/data/c.txt", MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  const blocks = await runSystemTransform(hooks, SESSION_ID)
  const hintBlocks = hintBlocksIn(blocks)
  assert.equal(hintBlocks.length, 1)
  assert.equal(hintBlocks[0], hintLineFor(["/data/c.txt", "/data/b.txt"]))
  assert.ok(!hintBlocks[0].includes("/data/a.txt"))
})

test("chat system transform defaults the hint to ten subjects dropping older ones", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle(
    Array.from({ length: HINT_DEFAULT_ENTRY_COUNT }, (_, entryIndex) => [
      pathToolPart(`/data/hint${entryIndex}.txt`, MIN_EVICTABLE_BYTES),
    ]),
  )
  await runTransform(hooks, bundle)

  const expectedSubjects = Array.from(
    { length: DEFAULT_HINT_SUBJECT_COUNT },
    (_, offset) => `/data/hint${HINT_DEFAULT_ENTRY_COUNT - 1 - offset}.txt`,
  )
  const hintBlocks = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID))
  assert.equal(hintBlocks.length, 1)
  assert.equal(hintBlocks[0], hintLineFor(expectedSubjects))
  assert.ok(!hintBlocks[0].includes("/data/hint0.txt"))
})

test("chat system transform emits no hint block when hintSubjects is zero", async () => {
  const hooks = await loadPluginHooksWith({ hintSubjects: 0 })

  const bundle = buildBundle([[pathToolPart("/data/live.txt", MIN_EVICTABLE_BYTES)], ...fillerMessages(2)])
  await runTransform(hooks, bundle)

  const blocks = await runSystemTransform(hooks, SESSION_ID, [BASE_SYSTEM_BLOCK])
  assert.equal(hintBlocksIn(blocks).length, 0)
  assert.equal(blocks.length, 1)
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("chat system transform emits no hint block when every entry is tombstoned before any hint was stored", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, "/data/doomed.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const blocks = await runSystemTransform(hooks, SESSION_ID, [BASE_SYSTEM_BLOCK])
  assert.equal(hintBlocksIn(blocks).length, 0)
  assert.equal(blocks.length, 1)
})

test("transform serves the refreshed hint when the working set grows without adding message parts", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([[pathToolPart("/data/a.txt", MIN_EVICTABLE_BYTES)], ...fillerMessages(2)])
  await runTransform(hooks, bundle)

  const firstBlocks = await runSystemTransform(hooks, SESSION_ID, [BASE_SYSTEM_BLOCK])
  assert.equal(hintBlocksIn(firstBlocks).length, 1)
  assert.equal(firstBlocks[1], hintLineFor(["/data/a.txt"]))
  const partCountAfterFirst = totalPartCount(bundle)

  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart("/data/b.txt", MIN_EVICTABLE_BYTES)]))
  await runTransform(hooks, bundle)
  const secondBlocks = await runSystemTransform(hooks, SESSION_ID, [BASE_SYSTEM_BLOCK])

  assert.equal(hintBlocksIn(secondBlocks).length, 1)
  assert.equal(secondBlocks[1], hintLineFor(["/data/b.txt", "/data/a.txt"]))
  assert.equal(totalPartCount(bundle), partCountAfterFirst + 1)
  assert.equal(hintPartsIn(bundle).length, 0)
})

test("chat system transform keeps the last stored hint when no live subjects remain", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([[pathToolPart("/data/fading.txt", MIN_EVICTABLE_BYTES)], ...fillerMessages(2)])
  await runTransform(hooks, bundle)
  const firstHint = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID))
  assert.equal(firstHint.length, 1)

  bundle.messages.push(syntheticMessageFor(SESSION_ID, [textPart(textOfChars(OVER_WATERMARK_FILLER_TEXT_CHARS))]))
  bundle.messages.push(syntheticMessageFor(SESSION_ID, [textPart(textOfChars(OVER_WATERMARK_FILLER_TEXT_CHARS))]))
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const secondHint = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID))
  assert.equal(secondHint.length, 1)
  assert.equal(secondHint[0], firstHint[0])
})

test("transform never adds message parts across repeated transforms and system deliveries", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([[pathToolPart("/data/stable.txt", MIN_EVICTABLE_BYTES)], ...fillerMessages(2)])
  const partCountBefore = totalPartCount(bundle)
  for (let run = 0; run < REPEAT_TRANSFORM_COUNT; run += 1) {
    await runTransform(hooks, bundle)
    const blocks = await runSystemTransform(hooks, SESSION_ID, [BASE_SYSTEM_BLOCK])
    assert.equal(hintBlocksIn(blocks).length, 1)
  }
  assert.equal(totalPartCount(bundle), partCountBefore)
  assert.equal(hintPartsIn(bundle).length, 0)
})

test("chat system transform keeps hint subjects isolated between sessions", async () => {
  const hooks = await loadPluginHooks()

  const sessionA = buildBundle([[pathToolPart("/data/from-a.txt", MIN_EVICTABLE_BYTES)], ...fillerMessages(2)], SESSION_ID)
  const sessionB = buildBundle([[pathToolPart("/data/from-b.txt", MIN_EVICTABLE_BYTES)], ...fillerMessages(2)], SESSION_ID_B)
  await runTransform(hooks, sessionA)
  await runTransform(hooks, sessionB)
  await runTransform(hooks, sessionA)

  const hintA = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID))
  assert.equal(hintA.length, 1)
  assert.equal(hintA[0], hintLineFor(["/data/from-a.txt"]))
  const hintB = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID_B))
  assert.equal(hintB.length, 1)
  assert.equal(hintB[0], hintLineFor(["/data/from-b.txt"]))
})

test("chat system transform falls back to the default hint count when hintSubjects is negative", async () => {
  const hooks = await loadPluginHooksWith({ hintSubjects: NEGATIVE_HINT_SUBJECTS })

  const bundle = buildBundle([[pathToolPart("/data/fallback.txt", MIN_EVICTABLE_BYTES)], ...fillerMessages(2)])
  await runTransform(hooks, bundle)

  const hintBlocks = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID))
  assert.equal(hintBlocks.length, 1)
  assert.equal(hintBlocks[0], hintLineFor(["/data/fallback.txt"]))
})

test("chat system transform renders ranged subjects with start and end in the hint block", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [
      completedToolPart(
        READ_TOOL,
        { [PATH_INPUT_KEY]: RANGE_PATH, [OFFSET_INPUT_KEY]: READ_OFFSET_LINES, [LIMIT_INPUT_KEY]: READ_LIMIT_LINES },
        outputOfBytes(MIN_EVICTABLE_BYTES),
      ),
    ],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  const hintBlocks = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID))
  assert.equal(hintBlocks.length, 1)
  assert.equal(
    hintBlocks[0],
    hintLineFor([`${RANGE_PATH}:${READ_OFFSET_LINES}-${READ_OFFSET_LINES + READ_LIMIT_LINES}`]),
  )
})

test("chat system transform lists one hint entry from the retained copy when identical calls repeat a subject", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart("/data/dup.txt", MIN_EVICTABLE_BYTES)],
    [pathToolPart("/data/dup.txt", MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  const hintBlocks = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID))
  assert.equal(hintBlocks.length, 1)
  assert.equal(hintBlocks[0], hintLineFor(["/data/dup.txt"]))
  assert.equal(hintBlocks[0].split("/data/dup.txt").length - 1, 1)
})

test("read_evicted returns the full original output named by the tombstone after eviction", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const original = outputOfBytes(THREE_ENTRY_OUTPUT_BYTES)
  const bundle = buildBundle([[pathToolPart("/data/stashed.txt", THREE_ENTRY_OUTPUT_BYTES)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} read /data/stashed.txt (3000 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(READ_TOOL, "/data/stashed.txt", outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))}${reloadPointerFor("/data/stashed.txt")}`,
  )
  assert.equal(await readEvicted(hooks, "/data/stashed.txt", SESSION_ID), original)
})

test("read_evicted returns the newest match in full and one-line pointers to older matches", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([[pathToolPart("/data/dup.txt", THREE_ENTRY_OUTPUT_BYTES)], ...fillerMessages()])
  await runTransform(hooks, bundle)
  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart("/data/dup.txt", COLD_OUTPUT_BYTES)]))
  fillerMessages().forEach((parts) => bundle.messages.push(syntheticMessageFor(SESSION_ID, parts)))
  await runTransform(hooks, bundle)

  assert.equal(
    await readEvicted(hooks, "/data/dup.txt", SESSION_ID),
    `${outputOfBytes(COLD_OUTPUT_BYTES)}\n${olderMatchesLineFor("/data/dup.txt", [pointerFor(READ_TOOL, 0)])}`,
  )
})

test("read_evicted lists every older match oldest first when three evictions share one subject", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([[pathToolPart("/data/order.txt", THREE_ENTRY_OUTPUT_BYTES)], ...fillerMessages()])
  await runTransform(hooks, bundle)
  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart("/data/order.txt", COLD_OUTPUT_BYTES)]))
  fillerMessages().forEach((parts) => bundle.messages.push(syntheticMessageFor(SESSION_ID, parts)))
  await runTransform(hooks, bundle)
  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart("/data/order.txt", COLD_OUTPUT_BYTES)]))
  fillerMessages().forEach((parts) => bundle.messages.push(syntheticMessageFor(SESSION_ID, parts)))
  await runTransform(hooks, bundle)

  assert.equal(
    await readEvicted(hooks, "/data/order.txt", SESSION_ID),
    `${outputOfBytes(COLD_OUTPUT_BYTES)}\n${olderMatchesLineFor("/data/order.txt", [pointerFor(READ_TOOL, 0), pointerFor(READ_TOOL, 5)])}`,
  )
})

test("read_evicted returns an error-style miss naming the subject when nothing was stashed for it", async () => {
  const hooks = await loadPluginHooks()

  assert.equal(await readEvicted(hooks, "/data/never-evicted.txt", SESSION_ID), stashMissFor("/data/never-evicted.txt"))
})

test("read_evicted evicts the oldest stashed entry when a session stash exceeds the fifty entry bound", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const stashSubjects = Array.from({ length: STASH_OVERFLOW_COUNT }, (_, index) => `/data/stash${index}.txt`)
  const bundle = buildBundle([
    ...stashSubjects.map((subject) => [pathToolPart(subject, MIN_EVICTABLE_BYTES)]),
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(await readEvicted(hooks, stashSubjects[0], SESSION_ID), stashMissFor(stashSubjects[0]))
  assert.equal(await readEvicted(hooks, stashSubjects[1], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await readEvicted(hooks, stashSubjects[STASH_LIMIT], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("read_evicted keeps stashes isolated between sessions", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setContextLimit(hooks, SESSION_ID_B, WATERMARK_PROBE_CONTEXT_LIMIT)

  const sessionA = buildBundle(
    [[pathToolPart(STASH_ISOLATION_SUBJECT, COLD_OUTPUT_BYTES)], ...fillerMessages()],
    SESSION_ID,
  )
  const sessionB = buildBundle(
    [[pathToolPart(STASH_ISOLATION_SUBJECT, THREE_ENTRY_OUTPUT_BYTES)], ...fillerMessages()],
    SESSION_ID_B,
  )
  await runTransform(hooks, sessionA)
  await runTransform(hooks, sessionB)

  assert.equal(await readEvicted(hooks, STASH_ISOLATION_SUBJECT, SESSION_ID), outputOfBytes(COLD_OUTPUT_BYTES))
  assert.equal(await readEvicted(hooks, STASH_ISOLATION_SUBJECT, SESSION_ID_B), outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(
    await readEvicted(hooks, STASH_ISOLATION_SUBJECT, STASH_ISOLATION_SESSION_C),
    stashMissFor(STASH_ISOLATION_SUBJECT),
  )
})

test("transform leaves no stash behind when the estimate sits under the watermark", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForWatermarkTokens(tokensForChars(STANDARD_BUNDLE_CHARS) + HEADROOM_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, "/data/kept.txt")
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await readEvicted(hooks, "/data/kept.txt", SESSION_ID), stashMissFor("/data/kept.txt"))
})

test("read_evicted returns an error-style miss when the subject is not a non-empty string", async () => {
  const hooks = await loadPluginHooks()

  assert.equal(await readEvicted(hooks, INVALID_SUBJECT_VALUE, SESSION_ID), invalidSubjectMissFor("number"))
  assert.equal(await readEvicted(hooks, "", SESSION_ID), invalidSubjectMissFor("string"))
})

test("transform tombstones an older identical call with the dedup marker and keeps the newest output verbatim", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 3))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.ok(!toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform never re-evicts a dedup tombstone and leaves it byte-identical under eviction pressure", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart("/data/cold-dedup.txt", THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 1))
  assert.ok(toolPartAt(bundle.messages[2], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform dedups an older identical call with the estimate under the watermark and no eviction", async () => {
  const hooks = await loadPluginHooks()

  const postDedupChars =
    dedupTombstoneFor(READ_TOOL, 1).length + THREE_ENTRY_OUTPUT_BYTES + RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS
  await setContextLimit(hooks, SESSION_ID, contextForWatermarkTokens(tokensForChars(postDedupChars) + HEADROOM_TOKENS))

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 1))
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.ok(!toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform never stashes a dedup tombstoned output so read_evicted misses it", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(3),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 1))
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(await readEvicted(hooks, DEDUP_PATH, SESSION_ID), stashMissFor(DEDUP_PATH))
})

test("transform lists a deduped subject once from the retained copy and never from the tombstone", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(1),
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(DEDUP_MARKER))
  const hintBlocks = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID))
  assert.equal(hintBlocks.length, 1)
  assert.equal(hintBlocks[0], hintLineFor([DEDUP_PATH]))
})

test("transform dedups identical inputs whose object keys appear in a different order", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [
      completedToolPart(
        READ_TOOL,
        { [PATH_INPUT_KEY]: DEDUP_PATH, [DEDUP_ENCODING_KEY]: DEDUP_ENCODING_VALUE },
        outputOfBytes(THREE_ENTRY_OUTPUT_BYTES),
      ),
    ],
    ...fillerMessages(2),
    [
      completedToolPart(
        READ_TOOL,
        { [DEDUP_ENCODING_KEY]: DEDUP_ENCODING_VALUE, [PATH_INPUT_KEY]: DEDUP_PATH },
        outputOfBytes(THREE_ENTRY_OUTPUT_BYTES),
      ),
    ],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 3))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
})

test("transform dedups identical inputs with recursively reordered nested objects", async () => {
  const hooks = await loadPluginHooks()

  const nestedFirst = {
    [PATH_INPUT_KEY]: DEDUP_PATH,
    [DEDUP_NESTED_TOP_KEY]: {
      [DEDUP_NESTED_KEY_LATE]: DEDUP_NESTED_TOP_VALUE,
      [DEDUP_NESTED_KEY_EARLY]: { [DEDUP_LEAF_KEY_LATE]: DEDUP_LEAF_VALUE_LATE, [DEDUP_LEAF_KEY_EARLY]: DEDUP_LEAF_VALUE_EARLY },
    },
  }
  const nestedSecond = {
    [DEDUP_NESTED_TOP_KEY]: {
      [DEDUP_NESTED_KEY_EARLY]: { [DEDUP_LEAF_KEY_EARLY]: DEDUP_LEAF_VALUE_EARLY, [DEDUP_LEAF_KEY_LATE]: DEDUP_LEAF_VALUE_LATE },
      [DEDUP_NESTED_KEY_LATE]: DEDUP_NESTED_TOP_VALUE,
    },
    [PATH_INPUT_KEY]: DEDUP_PATH,
  }
  const bundle = buildBundle([
    [completedToolPart(READ_TOOL, nestedFirst, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))],
    ...fillerMessages(2),
    [completedToolPart(READ_TOOL, nestedSecond, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 3))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
})

test("transform leaves dedup results unchanged on a second transform pass", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)
  const afterFirstPass = structuredClone(bundle)
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle, afterFirstPass)
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 3))
})

test("transform never treats pending or error parts as dedup targets or superseders", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pendingToolPart(READ_TOOL, { [PATH_INPUT_KEY]: DEDUP_PATH }, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))],
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: DEDUP_PATH }, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))],
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal((bundle.messages[0].parts[0] as PendingToolPart).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, dedupTombstoneFor(READ_TOOL, 3))
  assert.equal((bundle.messages[2].parts[0] as ErrorToolPart).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
})

test("transform never dedups a substantial older output when the newest identical output sits below the size floor", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(1),
    [pathToolPart(DEDUP_PATH, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(bundle.messages[2], 0).state.output, outputOfBytes(APPEARANCE_ONLY_OUTPUT_BYTES))
  assert.ok(!toolPartAt(bundle.messages[0], 0).state.output.startsWith(DEDUP_MARKER))
})

test("transform dedups an older duplicate when the newest identical output sits exactly at the size floor", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 3))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform tombstones an older identical file attachment with the dedup marker and keeps the newest occurrence verbatim", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(2),
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[0].parts[0], { type: "text", text: fileDedupTombstoneFor(FILE_FILENAME, 3) })
  assert.deepEqual(bundle.messages[3].parts[0], fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME))
})

test("transform resolves three duplicate file attachments across messages to the single newest occurrence", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(2),
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[0].parts[0], { type: "text", text: fileDedupTombstoneFor(FILE_FILENAME, 5) })
  assert.deepEqual(bundle.messages[1].parts[0], { type: "text", text: fileDedupTombstoneFor(FILE_FILENAME, 5) })
  assert.deepEqual(bundle.messages[2].parts[0], { type: "text", text: fileDedupTombstoneFor(FILE_FILENAME, 5) })
  assert.deepEqual(bundle.messages[5].parts[0], fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME))
})

test("transform retains the last of two identical file parts within one message", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME), fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[0].parts[0], { type: "text", text: fileDedupTombstoneFor(FILE_FILENAME, 0) })
  assert.deepEqual(bundle.messages[0].parts[1], fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME))
})

test("transform tombstones an older duplicate file attachment whose newest copy sits inside the recent window", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [{ ...fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME), id: FILE_PART_ID }],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES - 1),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[0].parts[0], { type: "text", text: fileDedupTombstoneFor(FILE_FILENAME, 6) })
  assert.deepEqual(bundle.messages[6].parts[0], fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME))
})

test("transform leaves a duplicate file attachment inside the recent window untouched", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    ...fillerMessages(RECENT_WINDOW_MESSAGES - 2),
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[2].parts[0], fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME))
  assert.deepEqual(bundle.messages[3].parts[0], fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME))
})

test("transform never collapses file attachments that differ in url or mime", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL_OTHER, FILE_FILENAME)],
    [fileAttachmentPart(FILE_MIME_PDF, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[0].parts[0], fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME))
  assert.deepEqual(bundle.messages[1].parts[0], fileAttachmentPart(FILE_MIME_TEXT, FILE_URL_OTHER, FILE_FILENAME))
  assert.deepEqual(bundle.messages[2].parts[0], fileAttachmentPart(FILE_MIME_PDF, FILE_URL, FILE_FILENAME))
})

test("transform dedups filename-less file attachments by mime and url and labels the tombstone with the mime", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL)],
    ...fillerMessages(2),
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, "")],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[0].parts[0], { type: "text", text: fileDedupTombstoneFor(FILE_MIME_TEXT, 3) })
  assert.deepEqual(bundle.messages[3].parts[0], fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, ""))
})

test("transform leaves file dedup results unchanged on a second transform pass", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(2),
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)
  const afterFirstPass = structuredClone(bundle)
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle, afterFirstPass)
  assert.deepEqual(bundle.messages[0].parts[0], { type: "text", text: fileDedupTombstoneFor(FILE_FILENAME, 3) })
})

test("lru_stats counts file attachment dedup tombstones in the deduped counter", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(2),
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(countersOf(await lruStats(hooks, SESSION_ID)).deduped, 1)
})

test("transform purges the input of an errored tool part one message outside the recent window while keeping its error output", async () => {
  const hooks = await loadPluginHooks()
  const errorOutput = outputOfBytes(UNCOMPLETED_OUTPUT_BYTES)

  const bundle = buildBundle([
    ...fillerMessages(RECENT_WINDOW_MESSAGES - 1),
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, errorOutput)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES),
  ])
  await runTransform(hooks, bundle)

  assert.equal(inputAt(bundle.messages[RECENT_WINDOW_MESSAGES - 1]), PURGE_MARKER)
  assert.equal((bundle.messages[RECENT_WINDOW_MESSAGES - 1].parts[0] as ErrorToolPart).state.output, errorOutput)
})

test("transform keeps the input of an errored tool part sitting exactly at the recent window boundary", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    ...fillerMessages(RECENT_WINDOW_MESSAGES),
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_BOUNDARY_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(RECENT_WINDOW_MESSAGES - 1),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(inputAt(bundle.messages[RECENT_WINDOW_MESSAGES]), { [PATH_INPUT_KEY]: PURGE_BOUNDARY_PATH })
})

test("transform leaves purge results unchanged on a second transform pass", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])
  await runTransform(hooks, bundle)
  const afterFirstPass = structuredClone(bundle)
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle, afterFirstPass)
  assert.equal(inputAt(bundle.messages[0]), PURGE_MARKER)
})

test("transform purges errored tool inputs even when the bundle sits below the watermark with no eviction pressure", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])
  await runTransform(hooks, bundle)

  assert.equal(inputAt(bundle.messages[0]), PURGE_MARKER)
})

test("transform never purges the input of a pending tool part outside the recent window", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pendingToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_PENDING_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(inputAt(bundle.messages[0]), { [PATH_INPUT_KEY]: PURGE_PENDING_PATH })
})

test("transform never purges the input of a completed tool part outside the recent window", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart(PURGE_COMPLETED_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(toolPartAt(bundle.messages[0], 0).state.input, { [PATH_INPUT_KEY]: PURGE_COMPLETED_PATH })
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform purges errored tool inputs identically in both sessions with no cross-session coupling", async () => {
  const hooks = await loadPluginHooks()

  const buildPurgeBundle = (sessionID: string): StrictBundle =>
    buildBundle(
      [
        [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
        ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
      ],
      sessionID,
    )
  const sessionA = buildPurgeBundle(SESSION_ID)
  const sessionB = buildPurgeBundle(SESSION_ID_B)
  await runTransform(hooks, sessionA)
  await runTransform(hooks, sessionB)
  await runTransform(hooks, sessionA)

  assert.equal(inputAt(sessionA.messages[0]), PURGE_MARKER)
  assert.equal(inputAt(sessionB.messages[0]), PURGE_MARKER)
})

const REASONING_COLD_TEXT = "cold reasoning block"
const REASONING_SECOND_COLD_TEXT = "second cold reasoning block"
const REASONING_BOUNDARY_TEXT = "boundary reasoning block"
const REASONING_HOT_TEXT = "hot reasoning block"
const REASONING_SIGNATURE_KEY = "signature"
const REASONING_SIGNATURE_VALUE = "sig-abc123"
const REASONING_MIXED_NOTE_TEXT = "user note beside reasoning"
const REASONING_MIXED_REMAINING_PARTS = 2
const EXPIRED_REASONING_PAIR_COUNT = 2
const EXPIRED_REASONING_PAIR_BYTES = REASONING_COLD_TEXT.length + REASONING_SECOND_COLD_TEXT.length
const EXPIRED_REASONING_SINGLE_COUNT = 1
const EXPIRED_REASONING_METADATA = { [REASONING_SIGNATURE_KEY]: REASONING_SIGNATURE_VALUE }

test("transform expires a reasoning part strictly older than the recent window and keeps the parts at and inside the boundary", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [reasoningPart(REASONING_COLD_TEXT)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES),
    [reasoningPart(REASONING_BOUNDARY_TEXT)],
    [reasoningPart(REASONING_HOT_TEXT)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES - 2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(bundle.messages.length, RECENT_WINDOW_MESSAGES * 2 + 1)
  assert.equal(bundle.messages[0].parts.length, 0)
  assert.deepEqual(bundle.messages[RECENT_WINDOW_MESSAGES + 1].parts, [reasoningPart(REASONING_BOUNDARY_TEXT)])
  assert.deepEqual(bundle.messages[RECENT_WINDOW_MESSAGES + 2].parts, [reasoningPart(REASONING_HOT_TEXT)])
})

test("transform expires a metadata bearing reasoning part outside the recent window and keeps the identical in window part untouched", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [reasoningPart(REASONING_COLD_TEXT, EXPIRED_REASONING_METADATA)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES),
    [reasoningPart(REASONING_BOUNDARY_TEXT, EXPIRED_REASONING_METADATA)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES - 1),
  ])
  await runTransform(hooks, bundle)

  assert.equal(bundle.messages[0].parts.length, 0)
  assert.deepEqual(bundle.messages[RECENT_WINDOW_MESSAGES + 1].parts, [
    reasoningPart(REASONING_BOUNDARY_TEXT, EXPIRED_REASONING_METADATA),
  ])
})

test("transform removes only the expired reasoning part from a mixed message keeping its tool and text siblings in order", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [
      reasoningPart(REASONING_COLD_TEXT),
      pathToolPart("/data/mixed.txt", MIN_EVICTABLE_BYTES),
      textPart(REASONING_MIXED_NOTE_TEXT),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(bundle.messages[0].parts.length, REASONING_MIXED_REMAINING_PARTS)
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(bundle.messages[0].parts[1]["text"], REASONING_MIXED_NOTE_TEXT)
})

test("transform leaves expiry results unchanged on a second transform pass", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [reasoningPart(REASONING_COLD_TEXT)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES),
    [reasoningPart(REASONING_BOUNDARY_TEXT)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES - 1),
  ])
  await runTransform(hooks, bundle)
  const afterFirstPass = structuredClone(bundle)
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle, afterFirstPass)
  assert.equal(bundle.messages[0].parts.length, 0)
  assert.equal(bundle.messages[RECENT_WINDOW_MESSAGES + 1].parts.length, 1)
})

test("transform never tombstones a default protected task output under watermark pressure that evicts an unprotected sibling", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(
    hooks,
    SESSION_ID,
    contextForDeficit(PROTECTED_PRESSURE_BUNDLE_CHARS, PROTECTED_PRESSURE_DEFICIT_TOKENS),
  )

  const bundle = buildBundle([
    [completedToolPart(TASK_TOOL, {}, outputOfBytes(PROTECTED_OUTPUT_BYTES))],
    [pathToolPart(PROTECTED_PRESSURE_SIBLING_PATH, PROTECTED_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(PROTECTED_OUTPUT_BYTES))
  assert.ok(toolPartAt(bundle.messages[1], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform protects a task output from eviction by default when the estimate exceeds the watermark by one token", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildOverWatermarkProtectedBundle(TASK_TOOL)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform protects a todowrite output from eviction by default when the estimate exceeds the watermark by one token", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildOverWatermarkProtectedBundle(TODOWRITE_TOOL)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform honors a custom protectedTools override protecting read outputs by name", async () => {
  const hooks = await loadPluginHooksWith({ protectedTools: [READ_TOOL] })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, OVERRIDE_PROTECTED_PATH)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform falls back to the default protected tools when protectedTools is invalid", async () => {
  const invalidValueHooks = await loadPluginHooksWith({ protectedTools: INVALID_PROTECTED_TOOLS_VALUE })
  const nonStringEntryHooks = await loadPluginHooksWith({
    protectedTools: [TASK_TOOL, INVALID_PROTECTED_TOOLS_ENTRY],
  })
  const emptyEntryHooks = await loadPluginHooksWith({ protectedTools: [EMPTY_PROTECTED_TOOLS_ENTRY] })
  await setContextLimit(invalidValueHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await setContextLimit(nonStringEntryHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await setContextLimit(emptyEntryHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const invalidValueBundle = buildOverWatermarkProtectedBundle(TODOWRITE_TOOL)
  const nonStringEntryBundle = buildOverWatermarkProtectedBundle(TODOWRITE_TOOL)
  const emptyEntryBundle = buildOverWatermarkProtectedBundle(TODOWRITE_TOOL)
  await runTransform(invalidValueHooks, invalidValueBundle)
  await runTransform(nonStringEntryHooks, nonStringEntryBundle)
  await runTransform(emptyEntryHooks, emptyEntryBundle)

  assert.equal(toolPartAt(invalidValueBundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(nonStringEntryBundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(emptyEntryBundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform never stashes a protected output so read_evicted misses it after an eviction run under pressure", async () => {
  const hooks = await loadPluginHooksWith({ protectedTools: [GREP_TOOL] })
  await setContextLimit(
    hooks,
    SESSION_ID,
    contextForDeficit(PROTECTED_PRESSURE_BUNDLE_CHARS, PROTECTED_PRESSURE_DEFICIT_TOKENS),
  )

  const bundle = buildBundle([
    [
      completedToolPart(
        GREP_TOOL,
        { [PATTERN_INPUT_KEY]: STASH_PROTECTED_PATTERN, [INCLUDE_INPUT_KEY]: INCLUDE_GLOB },
        outputOfBytes(PROTECTED_OUTPUT_BYTES),
      ),
    ],
    [pathToolPart(STASH_PROTECTED_VICTIM_PATH, PROTECTED_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(PROTECTED_OUTPUT_BYTES))
  assert.ok(toolPartAt(bundle.messages[1], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(await readEvicted(hooks, STASH_PROTECTED_PATTERN, SESSION_ID), stashMissFor(STASH_PROTECTED_PATTERN))
  assert.equal(await readEvicted(hooks, STASH_PROTECTED_VICTIM_PATH, SESSION_ID), outputOfBytes(PROTECTED_OUTPUT_BYTES))
})

test("transform dedups protected tool duplicates with the newest substantial output superseding the older", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [completedToolPart(TASK_TOOL, {}, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))],
    ...fillerMessages(2),
    [completedToolPart(TASK_TOOL, {}, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(TASK_TOOL, 3))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
})

test("transform purges the input of an errored protected tool part outside the recent window", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [errorToolPart(TASK_TOOL, { prompt: PROTECTED_TASK_PROMPT }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])
  await runTransform(hooks, bundle)

  assert.equal(inputAt(bundle.messages[0]), PURGE_MARKER)
})

test("transform lists a protected live subject in the hint line like any live subject", async () => {
  const hooks = await loadPluginHooksWith({ protectedTools: [BASH_TOOL] })

  const bundle = buildBundle([[bashToolPart(PROTECTED_COMMAND, MIN_EVICTABLE_BYTES)], ...fillerMessages(2)])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  const hintBlocks = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID))
  assert.equal(hintBlocks.length, 1)
  assert.equal(hintBlocks[0], hintLineFor([PROTECTED_COMMAND]))
})

test("transform protects a read output whose path exactly matches a protectedPatterns entry under one token of pressure", async () => {
  const hooks = await loadPluginHooksWith({ protectedPatterns: [PROTECTED_PATTERN_EXACT] })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, PROTECTED_PATTERN_EXACT)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform protects a read output when a doublestar glob pattern matches the tail of its path", async () => {
  const hooks = await loadPluginHooksWith({ protectedPatterns: [PROTECTED_GLOB_PATTERN] })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, PROTECTED_GLOB_PATH)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform protects a read output when a slashless glob pattern matches a path segment", async () => {
  const hooks = await loadPluginHooksWith({ protectedPatterns: [PROTECTED_SEGMENT_PATTERN] })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, PROTECTED_SEGMENT_PATH)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform evicts a read output when no protectedPatterns entry matches its path", async () => {
  const hooks = await loadPluginHooksWith({ protectedPatterns: [UNMATCHED_PROTECTED_PATTERN] })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, UNPROTECTED_PLAIN_PATH)
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform protects a bash output when a glob pattern matches its command string", async () => {
  const hooks = await loadPluginHooksWith({ protectedPatterns: [PROTECTED_COMMAND_PATTERN] })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([[bashToolPart(PROTECTED_COMMAND, MIN_EVICTABLE_BYTES)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform protects a ranged read output when a glob pattern matches its file path", async () => {
  const hooks = await loadPluginHooksWith({ protectedPatterns: [RANGED_PROTECTED_GLOB] })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([
    [
      completedToolPart(
        READ_TOOL,
        {
          [PATH_INPUT_KEY]: RANGED_PROTECTED_PATH,
          [OFFSET_INPUT_KEY]: RANGED_ENTRY_OFFSET,
          [LIMIT_INPUT_KEY]: RANGED_ENTRY_LIMIT,
        },
        outputOfBytes(MIN_EVICTABLE_BYTES),
      ),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform protects a grep output when a glob pattern matches its extracted pattern subject", async () => {
  const hooks = await loadPluginHooksWith({ protectedPatterns: [GREP_PROTECTED_SUBJECT_PATTERN] })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([
    [
      completedToolPart(
        GREP_TOOL,
        { [PATTERN_INPUT_KEY]: PATTERN_QUERY, [INCLUDE_INPUT_KEY]: INCLUDE_GLOB },
        outputOfBytes(MIN_EVICTABLE_BYTES),
      ),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform still evicts a subjectless entry even when a match-all pattern is configured", async () => {
  const hooks = await loadPluginHooksWith({ protectedPatterns: [MATCH_ALL_PATTERN] })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([
    [completedToolPart(SUBJECTLESS_TOOL, { url: SUBJECTLESS_TOOL_URL }, outputOfBytes(MIN_EVICTABLE_BYTES))],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform leaves eviction unchanged when protectedPatterns is empty or invalid", async () => {
  const emptyListHooks = await loadPluginHooksWith({ protectedPatterns: [] })
  const nonArrayHooks = await loadPluginHooksWith({ protectedPatterns: PROTECTED_PATTERNS_NON_ARRAY })
  const nonStringEntryHooks = await loadPluginHooksWith({
    protectedPatterns: [MATCH_ALL_PATTERN, PROTECTED_PATTERNS_NON_STRING_ENTRY],
  })
  await setContextLimit(emptyListHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await setContextLimit(nonArrayHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await setContextLimit(nonStringEntryHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const emptyListBundle = buildStandardBundle(SESSION_ID, UNPROTECTED_PLAIN_PATH)
  const nonArrayBundle = buildStandardBundle(SESSION_ID, UNPROTECTED_PLAIN_PATH)
  const nonStringEntryBundle = buildStandardBundle(SESSION_ID, UNPROTECTED_PLAIN_PATH)
  await runTransform(emptyListHooks, emptyListBundle)
  await runTransform(nonArrayHooks, nonArrayBundle)
  await runTransform(nonStringEntryHooks, nonStringEntryBundle)

  assert.ok(toolPartAt(emptyListBundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.ok(toolPartAt(nonArrayBundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.ok(toolPartAt(nonStringEntryBundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform still dedups a pattern protected older duplicate with the newest substantial output retained", async () => {
  const hooks = await loadPluginHooksWith({ protectedPatterns: [PROTECTED_DEDUP_GLOB] })

  const bundle = buildBundle([
    [pathToolPart(PROTECTED_DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(PROTECTED_DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 3))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
})

const stashSessionId = (index: number): string => `lru-stash-session-${index}`

const stashSessionSubject = (index: number): string => `/data/stash-session-${index}.txt`

const stashOverflowSessionBundle = (index: number): StrictBundle =>
  buildStandardBundle(stashSessionId(index), stashSessionSubject(index))

const evictStashSession = async (hooks: HookMap, index: number): Promise<void> => {
  await setContextLimit(hooks, stashSessionId(index), WATERMARK_PROBE_CONTEXT_LIMIT)
  await runTransform(hooks, stashOverflowSessionBundle(index))
}

test("read_evicted drops the least recently active session stash when a ninth session stashes an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(STASH_SESSION_BOUND - 1), stashSessionId(STASH_SESSION_BOUND - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )

  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(1), stashSessionId(1)),
    stashMissFor(stashSessionSubject(1)),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(STASH_SESSION_BOUND - 1), stashSessionId(STASH_SESSION_BOUND - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("read_evicted protects a refreshed hot session stash when a ninth session stashes an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  await runTransform(hooks, stashOverflowSessionBundle(0))
  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(1), stashSessionId(1)),
    stashMissFor(stashSessionSubject(1)),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("read_evicted refreshes a reloading session stash so it survives when a ninth session stashes an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )

  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(1), stashSessionId(1)),
    stashMissFor(stashSessionSubject(1)),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("read_evicted does not refresh a session stash on a miss probe so the probing session drops when a ninth session stashes an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  assert.equal(
    await readEvicted(hooks, STASH_MISS_PROBE_SUBJECT, stashSessionId(0)),
    stashMissFor(STASH_MISS_PROBE_SUBJECT),
  )

  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0)),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(1), stashSessionId(1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

const limitSessionId = (index: number): string => `lru-limit-session-${index}`

test("chat params drops the least recently informed session limit when a ninth session stores a context limit", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < LIMIT_SESSION_BOUND; index += 1) {
    await setContextLimit(hooks, limitSessionId(index), WATERMARK_PROBE_CONTEXT_LIMIT)
  }
  await setContextLimit(hooks, limitSessionId(0), WATERMARK_PROBE_CONTEXT_LIMIT)
  await setContextLimit(hooks, limitSessionId(LIMIT_SESSION_OVERFLOW_COUNT - 1), WATERMARK_PROBE_CONTEXT_LIMIT)

  const refreshed = buildStandardBundle(limitSessionId(0), "/data/limit-refreshed.txt")
  const evicted = buildStandardBundle(limitSessionId(1), "/data/limit-evicted.txt")
  const newest = buildStandardBundle(limitSessionId(LIMIT_SESSION_OVERFLOW_COUNT - 1), "/data/limit-newest.txt")
  await runTransform(hooks, refreshed)
  await runTransform(hooks, evicted)
  await runTransform(hooks, newest)

  assert.ok(toolPartAt(refreshed.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(evicted.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.ok(toolPartAt(newest.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

const hintSessionId = (index: number): string => `lru-hint-session-${index}`

const hintSessionSubject = (index: number): string => `/data/hint-session-${index}.txt`

const storeHintSession = async (hooks: HookMap, index: number): Promise<void> => {
  await runTransform(hooks, buildStandardBundle(hintSessionId(index), hintSessionSubject(index)))
}

test("chat system transform drops the least recently active session hint when a ninth session stores a hint", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < HINT_SESSION_BOUND; index += 1) await storeHintSession(hooks, index)

  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(0))).length, 1)
  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(HINT_SESSION_BOUND - 1))).length, 1)

  await storeHintSession(hooks, HINT_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(0))).length, 1)
  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(1))).length, 0)
  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(HINT_SESSION_BOUND - 1))).length, 1)
  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(HINT_SESSION_OVERFLOW_COUNT - 1))).length, 1)
})

const truncatedRenderOf = (raw: string): string => {
  const singleLine = raw.replaceAll("\n", " ")
  return singleLine.length > RENDERED_SUBJECT_CAP
    ? `${singleLine.slice(0, RENDERED_SUBJECT_CAP - ELLIPSIS_MARKER.length)}${ELLIPSIS_MARKER}`
    : singleLine
}

test("transform truncates a multi kilobyte heredoc subject in the tombstone and reload pointer and still reloads from the truncated name", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([[bashToolPart(HEREDOC_COMMAND, MIN_EVICTABLE_BYTES)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  const truncated = truncatedRenderOf(HEREDOC_COMMAND)
  assert.equal(truncated.length, RENDERED_SUBJECT_CAP)
  assert.ok(truncated.endsWith(ELLIPSIS_MARKER))
  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} bash ${truncated} (2048 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(BASH_TOOL, truncated, outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor(truncated)}`,
  )
  assert.equal(await readEvicted(hooks, truncated, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("chat system transform renders a newline bearing heredoc subject as one truncated single line hint entry", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([[bashToolPart(HEREDOC_COMMAND, MIN_EVICTABLE_BYTES)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  const hintBlocks = hintBlocksIn(await runSystemTransform(hooks, SESSION_ID))
  assert.equal(hintBlocks.length, 1)
  assert.equal(hintBlocks[0], hintLineFor([truncatedRenderOf(HEREDOC_COMMAND)]))
  assert.ok(!hintBlocks[0].includes("\n"))
})

test("transform refresh matches a huge multi line subject on its raw value despite the truncated render", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [bashToolPart(HEREDOC_COMMAND, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(1),
    [bashToolPart(HEREDOC_COMMAND, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(bundle.messages[2], 0).state.output, outputOfBytes(APPEARANCE_ONLY_OUTPUT_BYTES))
})

const COLLISION_SUBJECT_PATH = "/data/collide.txt"
const COLLISION_ENCODING_KEY = "encoding"

test("read_evicted keeps both same message same subject evictions reloadable instead of overwriting the first stash", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [
      completedToolPart(
        READ_TOOL,
        { [PATH_INPUT_KEY]: COLLISION_SUBJECT_PATH, [COLLISION_ENCODING_KEY]: DEDUP_ENCODING_VALUE },
        outputOfBytes(THREE_ENTRY_OUTPUT_BYTES),
      ),
      pathToolPart(COLLISION_SUBJECT_PATH, COLD_OUTPUT_BYTES),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    await readEvicted(hooks, COLLISION_SUBJECT_PATH, SESSION_ID),
    `${outputOfBytes(COLD_OUTPUT_BYTES)}\n${olderMatchesLineFor(COLLISION_SUBJECT_PATH, [pointerFor(READ_TOOL, 0)])}`,
  )
})

const STATS_TOOL_NAME = "lru_stats"
const METRICS_DIR_SEGMENTS = [".local", "share", "opencode"]
const METRICS_LOG_BASENAME = "lru-metrics.jsonl"
const DEFAULT_METRICS_PATH = join(homedir(), ...METRICS_DIR_SEGMENTS, METRICS_LOG_BASENAME)
const METRICS_TEMP_DIR_PREFIX = "lru-metrics-test-"
const METRICS_LOG_FILE_NAME = "metrics.jsonl"
const METRICS_BLOCKED_DIR_NAME = "missing-subdir"
const METRICS_LINE_SEPARATOR = "\n"
const CONTEXT_TOKENS_SOURCE_OVERRIDE = "override"
const CONTEXT_TOKENS_SOURCE_MODEL = "model"
const CONTEXT_TOKENS_SOURCE_DEFAULT = "default"
const CONTEXT_TOKENS_SOURCE_UNKNOWN = "unknown"
const POST_EVICT_TOUCH_PATH = "/data/post-touch.txt"
const POST_EVICT_UNMATCHED_PATH = "/data/post-touch-unmatched.txt"
const STATS_MISS_SUBJECT = "/data/stats-miss.txt"
const STATS_SKIP_RUN_SUBJECT = "/data/stats-skip-run.txt"
const STATS_HIT_SUBJECT = "/data/stats-hit.txt"
const STATS_STASH_SUBJECT_PREFIX = "/data/stats-stash"
const STATS_STASH_SUBJECT_SUFFIX = ".txt"
const REMEMBERED_SUBJECT_OVERFLOW_COUNT = 101
const STATS_LOGGED_SUBJECT = "/data/logged.txt"
const STATS_RELOADED_SUBJECT = "/data/reload-logged.txt"
const STATS_UNLOGGED_SUBJECT = "/data/unlogged.txt"
const STATS_BLOCKED_SUBJECT = "/data/blocked-log.txt"
const STATS_SINGLE_EVICTION_SUBJECT = "/data/isolated-a.txt"
const STATS_ISOLATION_B_SUBJECTS = ["/data/isolated-b1.txt", "/data/isolated-b2.txt", "/data/isolated-b3.txt"]
const STATS_ISOLATION_B_EVICTED_COUNT = 2
const METRICS_SESSION_BOUND = 8
const METRICS_SESSION_OVERFLOW_COUNT = 9
const METRICS_PROBE_SESSION_ID = "lru-metrics-probe-session"
const METRICS_PROBE_MISS_SUBJECT = "/data/metrics-probe-miss.txt"
const METRICS_LINES_AFTER_RELOAD = 2
const METRICS_LINES_AFTER_RECOVERY = 1
const METRICS_ROTATION_SUFFIX = ".1"
const DEFAULT_METRICS_ROTATION_MAX_BYTES = 5 * 1024 * 1024
const METRICS_ROTATION_DISABLED_MAX_BYTES = 0
const METRICS_ROTATION_CUSTOM_CAP = 4096
const METRICS_ROTATION_TINY_CAP = 1
const METRICS_ROTATION_INVALID_CAPS = [-1, Infinity, Number.NaN]
const METRICS_ROTATION_SEED_CONTENT = "seed\n"
const METRICS_STALE_ROTATED_CONTENT = "stale rotated content\n"
const METRICS_ROTATION_DISABLED_TOTAL_LINES = 3
const METRICS_ROTATION_SUBJECT = "/data/rotation-boundary.txt"
const METRICS_ROTATION_DISABLED_SUBJECT = "/data/rotation-disabled.txt"
const METRICS_ROTATION_REPLACEMENT_SUBJECT = "/data/rotation-replacement.txt"
const METRICS_ROTATION_PANEL_SUBJECT = "/data/rotation-panel.txt"
const METRICS_ROTATION_PANEL_SEED_SUBJECT = "/data/rotation-panel-seed.txt"
const METRICS_ROTATION_PANEL_SEED_EVICTIONS = 5
const METRICS_ROTATION_PANEL_SEED_MESSAGES_AGO = 3
const METRICS_ROTATION_PANEL_SEED_ESTIMATED_TOKENS = 900
const METRICS_ROTATION_PANEL_SEED_BYTES = METRICS_ROTATION_PANEL_SEED_EVICTIONS * MIN_EVICTABLE_BYTES
const METRICS_ROTATION_PANEL_SEED_SESSION = "lru-rotation-seed-session"
const STATS_ZEROED_COUNTERS = {
  evictions: 0,
  bytesReclaimed: 0,
  evictionTokensSaved: 0,
  stashHits: 0,
  stashMisses: 0,
  stashDropped: 0,
  deduped: 0,
  dedupedBytes: 0,
  dedupTokensSaved: 0,
  postEvictionTouches: 0,
  reasoningExpired: 0,
  reasoningBytesExpired: 0,
  fenceEvicted: 0,
}
const STATS_LOG_FILE_LINES = 1

type StatsToolDefinition = { execute: (args: unknown, context: unknown) => Promise<unknown> }

const lruStats = async (hooks: HookMap, sessionID: string): Promise<Record<string, unknown>> =>
  JSON.parse(
    (await (hooks as Record<string, Record<string, StatsToolDefinition>>)[RELOAD_TOOL_MAP_KEY][STATS_TOOL_NAME].execute(
      {},
      { sessionID },
    )) as string,
  ) as Record<string, unknown>

const countersOf = (stats: Record<string, unknown>): Record<string, number> => stats.counters as Record<string, number>

const makeMetricsDir = (): string => mkdtempSync(join(tmpdir(), METRICS_TEMP_DIR_PREFIX))

const metricsLogPathIn = (dir: string): string => join(dir, METRICS_LOG_FILE_NAME)

const rotatedMetricsPathIn = (dir: string): string => join(dir, `${METRICS_LOG_FILE_NAME}${METRICS_ROTATION_SUFFIX}`)

const blockedMetricsPathIn = (dir: string): string => join(dir, METRICS_BLOCKED_DIR_NAME, METRICS_LOG_FILE_NAME)

const cleanupMetricsDir = (dir: string): void => rmSync(dir, { recursive: true, force: true })

const loadPluginHooksWithMetricsLog = async (metricsPath: string): Promise<HookMap> =>
  loadPluginHooksWith({ metricsLog: true, metricsPath })

const metricsLinesIn = (metricsPath: string): Record<string, unknown>[] =>
  readFileSync(metricsPath, "utf8")
    .split(METRICS_LINE_SEPARATOR)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

const metricsSessionId = (index: number): string => `lru-metrics-session-${index}`

const metricsSessionSubject = (index: number): string => `/data/metrics-session-${index}.txt`

const storeMetricsSession = async (hooks: HookMap, index: number): Promise<void> => {
  await setContextLimit(hooks, metricsSessionId(index), WATERMARK_PROBE_CONTEXT_LIMIT)
  await runTransform(hooks, buildStandardBundle(metricsSessionId(index), metricsSessionSubject(index)))
}

const metricsRotationPanelSeedLine = (session: string = SESSION_ID): Record<string, unknown> => ({
  ts: "2026-09-17T00:00:00.000Z",
  session,
  modelContextTokens: null,
  modelContextTokensSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
  estimatedTokens: METRICS_ROTATION_PANEL_SEED_ESTIMATED_TOKENS,
  watermarkTokens: null,
  deficitTokens: null,
  evictedThisRun: [
    {
      tool: READ_TOOL,
      subject: METRICS_ROTATION_PANEL_SEED_SUBJECT,
      bytes: MIN_EVICTABLE_BYTES,
      messagesAgo: METRICS_ROTATION_PANEL_SEED_MESSAGES_AGO,
    },
  ],
  dedupedThisRun: 0,
  reasoningExpiredThisRun: 0,
  reasoningBytesExpiredThisRun: 0,
  fenceEvictedThisRun: 0,
  postEvictionTouchesThisRun: 0,
  stashReadsSinceLastLine: 0,
  totals: {
    ...STATS_ZEROED_COUNTERS,
    evictions: METRICS_ROTATION_PANEL_SEED_EVICTIONS,
    bytesReclaimed: METRICS_ROTATION_PANEL_SEED_BYTES,
  },
})

test("lru_stats reports zeroed counters unknown budget and empty stash for a session without activity", async () => {
  const hooks = await loadPluginHooks()

  const stats = await lruStats(hooks, SESSION_ID)

  assert.equal(stats.session, SESSION_ID)
  assert.deepEqual(stats.options, {
    watermark: WATERMARK_RATIO,
    recentWindow: RECENT_WINDOW_MESSAGES,
    minEvictableBytes: MIN_EVICTABLE_BYTES,
    defaultContextTokens: null,
    modelContextTokens: {},
    metricsLog: false,
    metricsPath: DEFAULT_METRICS_PATH,
    metricsRotationMaxBytes: DEFAULT_METRICS_ROTATION_MAX_BYTES,
    liveStateLog: false,
    liveStatePath: DEFAULT_LIVE_STATE_DIR,
    liveStatePruneMaxAgeMs: DEFAULT_LIVE_STATE_PRUNE_MAX_AGE_MS,
    liveStatePruneMinIntervalMs: DEFAULT_LIVE_STATE_PRUNE_MIN_INTERVAL_MS,
    userFenceEviction: { enabled: false, minBlockLines: FENCE_DEFAULT_MIN_BLOCK_LINES },
    manualMode: false,
  })
  assert.equal(stats.modelContextTokens, null)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  assert.deepEqual(stats.stash, { entries: 0, capacity: STASH_LIMIT })
  assert.deepEqual(countersOf(stats), STATS_ZEROED_COUNTERS)
  assert.equal(stats.lastRun, null)
  assert.equal(Object.hasOwn(stats, "logWriteError"), false)
})

test("lru_stats reports the explicit defaultContextTokens option as the budget when no limit was captured", async () => {
  const hooks = await loadPluginHooksWith({ defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })

  const stats = await lruStats(hooks, SESSION_ID)

  assert.equal(stats.options.defaultContextTokens, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
  assert.equal(stats.modelContextTokens, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
})

test("lru_stats records an unknown budget last run with null watermark and deficit after a skip run", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildStandardBundle(SESSION_ID, STATS_SKIP_RUN_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, null)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: null,
    deficitTokens: null,
  })
})

test("lru_stats counts the eviction reclaimed bytes stash entry and last run deficit after one eviction run", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
  assert.deepEqual(countersOf(stats), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
  })
  assert.deepEqual(stats.stash, { entries: 1, capacity: STASH_LIMIT })
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: tokensForChars(STANDARD_BUNDLE_CHARS) - OVER_BY_ONE_TOKENS,
    deficitTokens: OVER_BY_ONE_TOKENS,
  })
})

test("lru_stats derives the eviction token-savings estimate from the reclaimed bytes over the default charsPerToken", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  await runTransform(hooks, bundle)

  assert.deepEqual(countersOf(await lruStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
  })
})

test("lru_stats scales the eviction token-savings estimate by the resolved charsPerToken", async () => {
  const hooks = await loadPluginHooksWith({ charsPerToken: SAVINGS_CUSTOM_CHARS_PER_TOKEN })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  await runTransform(hooks, bundle)

  const counters = countersOf(await lruStats(hooks, SESSION_ID))
  assert.equal(counters.evictions, 1)
  assert.equal(counters.bytesReclaimed, MIN_EVICTABLE_BYTES)
  assert.equal(counters.evictionTokensSaved, Math.ceil(MIN_EVICTABLE_BYTES / SAVINGS_CUSTOM_CHARS_PER_TOKEN))
})

test("lru_stats counts stash hits and misses from read_evicted and leaves invalid subject arguments uncounted", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  assert.equal(await readEvicted(hooks, STATS_MISS_SUBJECT, SESSION_ID), stashMissFor(STATS_MISS_SUBJECT))
  assert.deepEqual(countersOf(await lruStats(hooks, SESSION_ID)), STATS_ZEROED_COUNTERS)

  const bundle = buildStandardBundle(SESSION_ID, STATS_HIT_SUBJECT)
  await runTransform(hooks, bundle)

  assert.equal(await readEvicted(hooks, STATS_MISS_SUBJECT, SESSION_ID), stashMissFor(STATS_MISS_SUBJECT))
  const afterMiss = await lruStats(hooks, SESSION_ID)
  assert.deepEqual(countersOf(afterMiss), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    stashMisses: 1,
  })

  assert.equal(await readEvicted(hooks, INVALID_SUBJECT_VALUE, SESSION_ID), invalidSubjectMissFor("number"))
  assert.equal(await readEvicted(hooks, "", SESSION_ID), invalidSubjectMissFor("string"))
  const afterInvalid = await lruStats(hooks, SESSION_ID)
  assert.equal(countersOf(afterInvalid).stashMisses, 1)
  assert.equal(countersOf(afterInvalid).stashHits, 0)

  assert.equal(await readEvicted(hooks, STATS_HIT_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  const afterHit = await lruStats(hooks, SESSION_ID)
  assert.deepEqual(countersOf(afterHit), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    stashHits: 1,
    stashMisses: 1,
  })
})

test("lru_stats counts a post eviction touch exactly once for a matching later call and never recounts repeated transforms", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, POST_EVICT_TOUCH_PATH)
  await runTransform(hooks, bundle)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))

  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart(POST_EVICT_TOUCH_PATH, APPEARANCE_ONLY_OUTPUT_BYTES)]))
  await runTransform(hooks, bundle)
  assert.equal(countersOf(await lruStats(hooks, SESSION_ID)).postEvictionTouches, 1)

  await runTransform(hooks, bundle)
  assert.equal(countersOf(await lruStats(hooks, SESSION_ID)).postEvictionTouches, 1)
})

test("lru_stats leaves post eviction touches at zero when a later call matches nothing evicted", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, POST_EVICT_TOUCH_PATH)
  await runTransform(hooks, bundle)

  bundle.messages.push(
    syntheticMessageFor(SESSION_ID, [pathToolPart(POST_EVICT_UNMATCHED_PATH, APPEARANCE_ONLY_OUTPUT_BYTES)]),
  )
  await runTransform(hooks, bundle)

  assert.equal(countersOf(await lruStats(hooks, SESSION_ID)).postEvictionTouches, 0)
})

test("lru_stats forgets the oldest evicted subject past the hundred subject cap and stops counting its post eviction touches", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const subjects = Array.from(
    { length: REMEMBERED_SUBJECT_OVERFLOW_COUNT },
    (_, index) => `/data/cap${index}.txt`,
  )
  const bundle = buildBundle([
    ...subjects.map((subject) => [pathToolPart(subject, MIN_EVICTABLE_BYTES)]),
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  bundle.messages.push(
    syntheticMessageFor(SESSION_ID, [
      pathToolPart(subjects[0], APPEARANCE_ONLY_OUTPUT_BYTES),
      pathToolPart(subjects[REMEMBERED_SUBJECT_OVERFLOW_COUNT - 1], APPEARANCE_ONLY_OUTPUT_BYTES),
    ]),
  )
  await runTransform(hooks, bundle)

  assert.equal(countersOf(await lruStats(hooks, SESSION_ID)).postEvictionTouches, 1)
})

test("lru_stats counts dedup tombstones without counting evictions and stays incremental across repeated transforms", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).deduped, 1)
  assert.equal(countersOf(stats).evictions, 0)

  await runTransform(hooks, bundle)
  assert.equal(countersOf(await lruStats(hooks, SESSION_ID)).deduped, 1)
})

test("lru_stats accumulates the dedup token-savings estimate from each superseded duplicate's bytes", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_SECOND_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_SECOND_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(countersOf(await lruStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    deduped: DEDUP_SAVINGS_PAIR_COUNT,
    dedupedBytes: DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES,
    dedupTokensSaved: tokensForChars(DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES),
  })

  await runTransform(hooks, bundle)
  assert.equal(
    countersOf(await lruStats(hooks, SESSION_ID)).dedupTokensSaved,
    tokensForChars(DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES),
  )
})

test("lru_stats counts stash drops when a single run evicts fifty one entries past the stash bound", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    ...Array.from(
      { length: STASH_OVERFLOW_COUNT },
      (_, index) => [pathToolPart(`${STATS_STASH_SUBJECT_PREFIX}${index}${STATS_STASH_SUBJECT_SUFFIX}`, MIN_EVICTABLE_BYTES)],
    ),
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).evictions, STASH_OVERFLOW_COUNT)
  assert.equal(countersOf(stats).stashDropped, 1)
  assert.equal(countersOf(stats).bytesReclaimed, STASH_OVERFLOW_COUNT * MIN_EVICTABLE_BYTES)
  assert.deepEqual(stats.stash, { entries: STASH_LIMIT, capacity: STASH_LIMIT })
})

test("transform drops nothing from a session stash holding exactly the fifty entry bound", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const subjects = Array.from({ length: STASH_LIMIT }, (_, index) => `/data/bound${index}.txt`)
  const bundle = buildBundle([
    ...subjects.map((subject) => [pathToolPart(subject, MIN_EVICTABLE_BYTES)]),
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).stashDropped, 0)
  assert.deepEqual(stats.stash, { entries: STASH_LIMIT, capacity: STASH_LIMIT })
  assert.equal(await readEvicted(hooks, subjects[0], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("read_evicted drops the earliest runs' entries first when later runs push a session stash past the fifty entry bound", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const firstRunSubjects = Array.from(
    { length: STASH_CROSS_RUN_FIRST_COUNT },
    (_, index) => `/data/cross-run-a${index}.txt`,
  )
  const bundle = buildBundle([
    ...firstRunSubjects.map((subject) => [pathToolPart(subject, MIN_EVICTABLE_BYTES)]),
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const secondRunSubjects = Array.from(
    { length: STASH_CROSS_RUN_SECOND_COUNT },
    (_, index) => `/data/cross-run-b${index}.txt`,
  )
  bundle.messages.push(
    syntheticMessageFor(SESSION_ID, secondRunSubjects.map((subject) => pathToolPart(subject, MIN_EVICTABLE_BYTES))),
  )
  fillerMessages().forEach((parts) => bundle.messages.push(syntheticMessageFor(SESSION_ID, parts)))
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).evictions, STASH_CROSS_RUN_FIRST_COUNT + STASH_CROSS_RUN_SECOND_COUNT)
  assert.equal(countersOf(stats).stashDropped, STASH_CROSS_RUN_DROP_COUNT)
  assert.deepEqual(stats.stash, { entries: STASH_LIMIT, capacity: STASH_LIMIT })
  assert.equal(await readEvicted(hooks, firstRunSubjects[0], SESSION_ID), stashMissFor(firstRunSubjects[0]))
  assert.equal(
    await readEvicted(hooks, firstRunSubjects[STASH_CROSS_RUN_DROP_COUNT], SESSION_ID),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(await readEvicted(hooks, secondRunSubjects[0], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("metrics log appends one eventful jsonl line with expected fields and nothing for a quiet repeated run", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithMetricsLog(metricsLogPathIn(metricsDir))
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_LOGGED_SUBJECT)
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    const line = lines[0]
    assert.equal(typeof line.ts, "string")
    assert.ok(Number.isNaN(new Date(line.ts as string).getTime()) === false)
    assert.equal(line.session, SESSION_ID)
    assert.equal(line.modelContextTokens, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
    assert.equal(line.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
    assert.equal(line.estimatedTokens, tokensForChars(STANDARD_BUNDLE_CHARS))
    assert.equal(line.watermarkTokens, tokensForChars(STANDARD_BUNDLE_CHARS) - OVER_BY_ONE_TOKENS)
    assert.equal(line.deficitTokens, OVER_BY_ONE_TOKENS)
    assert.deepEqual(line.evictedThisRun, [
      { tool: READ_TOOL, subject: STATS_LOGGED_SUBJECT, bytes: MIN_EVICTABLE_BYTES, attachmentBytes: 0, messagesAgo: 5 },
    ])
    assert.equal(line.dedupedThisRun, 0)
    assert.equal(line.postEvictionTouchesThisRun, 0)
    assert.equal(line.stashReadsSinceLastLine, 0)
    assert.deepEqual(line.totals, {
      ...STATS_ZEROED_COUNTERS,
      evictions: 1,
      bytesReclaimed: MIN_EVICTABLE_BYTES,
      evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    })

    await runTransform(hooks, bundle)
    assert.equal(metricsLinesIn(metricsLogPathIn(metricsDir)).length, STATS_LOG_FILE_LINES)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log records an unknown budget skip state with null watermark on an eventful run without a captured limit", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithMetricsLog(metricsLogPathIn(metricsDir))

    const bundle = buildBundle([
      [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
      ...fillerMessages(2),
      [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
      ...fillerMessages(2),
    ])
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].modelContextTokens, null)
    assert.equal(lines[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
    assert.equal(lines[0].watermarkTokens, null)
    assert.equal(lines[0].deficitTokens, null)
    assert.deepEqual(lines[0].evictedThisRun, [])
    assert.equal(lines[0].dedupedThisRun, 1)
    assert.deepEqual(lines[0].totals, {
      ...STATS_ZEROED_COUNTERS,
      deduped: 1,
      dedupedBytes: THREE_ENTRY_OUTPUT_BYTES,
      dedupTokensSaved: tokensForChars(THREE_ENTRY_OUTPUT_BYTES),
    })
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log records the default source label fields for an eventful explicit-option run without a captured limit", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWith({
      metricsLog: true,
      metricsPath: metricsLogPathIn(metricsDir),
      defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS,
    })

    const bundle = buildBundle([
      [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
      ...fillerMessages(2),
      [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
      ...fillerMessages(2),
    ])
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].modelContextTokens, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
    assert.equal(lines[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log records the override source label fields for a per model map driven run", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWith({
      metricsLog: true,
      metricsPath: metricsLogPathIn(metricsDir),
      modelContextTokens: { [OVERRIDE_MODEL_KEY]: SMALL_CONTEXT_LIMIT },
    })
    await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, undefined)

    const bundle = buildStandardBundle(SESSION_ID, "/data/metrics-override.txt")
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].modelContextTokens, SMALL_CONTEXT_LIMIT)
    assert.equal(lines[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log records stash reads since the last line on the next transform after a reload", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithMetricsLog(metricsLogPathIn(metricsDir))
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_RELOADED_SUBJECT)
    await runTransform(hooks, bundle)
    assert.equal(await readEvicted(hooks, STATS_RELOADED_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))

    await runTransform(hooks, bundle)
    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, METRICS_LINES_AFTER_RELOAD)
    assert.deepEqual(lines[1].evictedThisRun, [])
    assert.equal(lines[1].stashReadsSinceLastLine, 1)
    assert.deepEqual(lines[1].totals, {
      ...STATS_ZEROED_COUNTERS,
      evictions: 1,
      bytesReclaimed: MIN_EVICTABLE_BYTES,
      evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
      stashHits: 1,
    })

    await runTransform(hooks, bundle)
    assert.equal(metricsLinesIn(metricsLogPathIn(metricsDir)).length, METRICS_LINES_AFTER_RELOAD)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log writes nothing when metricsLog is false while counters still update", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWith(metricsLogPathIn(metricsDir))
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_UNLOGGED_SUBJECT)
    await runTransform(hooks, bundle)

    assert.equal(existsSync(metricsLogPathIn(metricsDir)), false)
    assert.equal(countersOf(await lruStats(hooks, SESSION_ID)).evictions, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log records an unwritable path in logWriteError surfaced through lru_stats without throwing", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithMetricsLog(blockedMetricsPathIn(metricsDir))
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_BLOCKED_SUBJECT)
    await runTransform(hooks, bundle)

    const stats = await lruStats(hooks, SESSION_ID)
    assert.equal(typeof stats.logWriteError, "string")
    assert.ok((stats.logWriteError as string).length > 0)
    assert.equal(countersOf(stats).evictions, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("lru_stats keeps metrics isolated between two sessions", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await setContextLimit(hooks, SESSION_ID_B, contextForDeficit(THREE_ENTRY_BUNDLE_CHARS, TWO_ENTRY_DEFICIT_TOKENS))

  const sessionA = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  const sessionB = buildBundle(
    [
      STATS_ISOLATION_B_SUBJECTS.map((subject) => pathToolPart(subject, THREE_ENTRY_OUTPUT_BYTES)),
      ...fillerMessages(),
    ],
    SESSION_ID_B,
  )
  await runTransform(hooks, sessionB)
  await runTransform(hooks, sessionA)

  const statsA = await lruStats(hooks, SESSION_ID)
  assert.equal(statsA.session, SESSION_ID)
  assert.deepEqual(countersOf(statsA), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
  })
  const statsB = await lruStats(hooks, SESSION_ID_B)
  assert.equal(statsB.session, SESSION_ID_B)
  assert.deepEqual(countersOf(statsB), {
    ...STATS_ZEROED_COUNTERS,
    evictions: STATS_ISOLATION_B_EVICTED_COUNT,
    bytesReclaimed: STATS_ISOLATION_B_EVICTED_COUNT * THREE_ENTRY_OUTPUT_BYTES,
    evictionTokensSaved: tokensForChars(STATS_ISOLATION_B_EVICTED_COUNT * THREE_ENTRY_OUTPUT_BYTES),
  })
})

test("lru_stats drops the least recently active session metrics when a ninth session transforms", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  await storeMetricsSession(hooks, METRICS_SESSION_OVERFLOW_COUNT - 1)

  assert.deepEqual(countersOf(await lruStats(hooks, metricsSessionId(0))), STATS_ZEROED_COUNTERS)
  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(1))).evictions, 1)
  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(METRICS_SESSION_BOUND - 1))).evictions, 1)
  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(METRICS_SESSION_OVERFLOW_COUNT - 1))).evictions, 1)
})

test("read_evicted leaves live session metrics untouched when a never-transformed session probes a stash miss at the session bound", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  assert.equal(
    await readEvicted(hooks, METRICS_PROBE_MISS_SUBJECT, METRICS_PROBE_SESSION_ID),
    stashMissFor(METRICS_PROBE_MISS_SUBJECT),
  )

  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(0))).evictions, 1)
  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(METRICS_SESSION_BOUND - 1))).evictions, 1)
  assert.deepEqual(countersOf(await lruStats(hooks, METRICS_PROBE_SESSION_ID)), STATS_ZEROED_COUNTERS)
})

test("lru_stats refreshes a probing session's metrics so it survives when a ninth session transforms", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  await lruStats(hooks, metricsSessionId(0))
  await storeMetricsSession(hooks, METRICS_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(0))).evictions, 1)
  assert.deepEqual(countersOf(await lruStats(hooks, metricsSessionId(1))), STATS_ZEROED_COUNTERS)
  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(METRICS_SESSION_OVERFLOW_COUNT - 1))).evictions, 1)
})

test("lru_stats leaves live session metrics untouched when a never-transformed session opens the stats tool at the session bound", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  assert.deepEqual(countersOf(await lruStats(hooks, METRICS_PROBE_SESSION_ID)), STATS_ZEROED_COUNTERS)
  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(0))).evictions, 1)
  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(METRICS_SESSION_BOUND - 1))).evictions, 1)
})

test("lru_stats does not refresh a session stash so a stats-only probe leaves it exposed when a ninth session stashes an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  await lruStats(hooks, stashSessionId(0))
  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0)),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(1), stashSessionId(1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("metrics log clears a recorded write failure once a later write succeeds", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const blockedPath = blockedMetricsPathIn(metricsDir)
    const hooks = await loadPluginHooksWithMetricsLog(blockedPath)
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_BLOCKED_SUBJECT)
    await runTransform(hooks, bundle)
    assert.equal(typeof (await lruStats(hooks, SESSION_ID)).logWriteError, "string")

    mkdirSync(join(metricsDir, METRICS_BLOCKED_DIR_NAME), { recursive: true })
    bundle.messages.push(
      syntheticMessageFor(SESSION_ID, [pathToolPart(STATS_BLOCKED_SUBJECT, APPEARANCE_ONLY_OUTPUT_BYTES)]),
    )
    await runTransform(hooks, bundle)

    const stats = await lruStats(hooks, SESSION_ID)
    assert.equal(Object.hasOwn(stats, "logWriteError"), false)
    assert.equal(countersOf(stats).evictions, 1)
    assert.equal(countersOf(stats).postEvictionTouches, 1)
    assert.equal(metricsLinesIn(blockedPath).length, METRICS_LINES_AFTER_RECOVERY)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("lru_stats reports the metrics rotation cap in options defaulting to five MiB and falling back on invalid caps", async () => {
  assert.equal(
    ((await lruStats(await loadPluginHooks(), SESSION_ID)).options as Record<string, unknown>).metricsRotationMaxBytes,
    DEFAULT_METRICS_ROTATION_MAX_BYTES,
  )

  const customHooks = await loadPluginHooksWith({ metricsRotationMaxBytes: METRICS_ROTATION_CUSTOM_CAP })
  assert.equal(
    ((await lruStats(customHooks, SESSION_ID)).options as Record<string, unknown>).metricsRotationMaxBytes,
    METRICS_ROTATION_CUSTOM_CAP,
  )

  for (const invalidCap of METRICS_ROTATION_INVALID_CAPS) {
    const hooks = await loadPluginHooksWith({ metricsRotationMaxBytes: invalidCap })
    assert.equal(
      ((await lruStats(hooks, SESSION_ID)).options as Record<string, unknown>).metricsRotationMaxBytes,
      DEFAULT_METRICS_ROTATION_MAX_BYTES,
    )
  }
})

test("metrics log stays byte identical at exactly the rotation cap and rotates when an append would cross it", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const probeHooks = await loadPluginHooksWithMetricsLog(metricsPath)
    await setContextLimit(probeHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
    await runTransform(probeHooks, buildStandardBundle(SESSION_ID, METRICS_ROTATION_SUBJECT))
    const capBytes = statSync(metricsPath).size
    rmSync(metricsPath)

    const hooks = await loadPluginHooksWith({ metricsLog: true, metricsPath, metricsRotationMaxBytes: capBytes })
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, METRICS_ROTATION_SUBJECT)
    await runTransform(hooks, bundle)
    assert.equal(existsSync(rotatedMetricsPathIn(metricsDir)), false)
    assert.equal(statSync(metricsPath).size, capBytes)
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    assert.equal(await readEvicted(hooks, METRICS_ROTATION_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
    await runTransform(hooks, bundle)

    const rotatedLines = metricsLinesIn(rotatedMetricsPathIn(metricsDir))
    assert.equal(rotatedLines.length, STATS_LOG_FILE_LINES)
    assert.equal(rotatedLines[0].session, SESSION_ID)
    assert.deepEqual(rotatedLines[0].evictedThisRun, [
      { tool: READ_TOOL, subject: METRICS_ROTATION_SUBJECT, bytes: MIN_EVICTABLE_BYTES, attachmentBytes: 0, messagesAgo: 5 },
    ])
    const freshLines = metricsLinesIn(metricsPath)
    assert.equal(freshLines.length, STATS_LOG_FILE_LINES)
    assert.equal(freshLines[0].stashReadsSinceLastLine, 1)
    assert.deepEqual(freshLines[0].evictedThisRun, [])
    assert.deepEqual(countersOf(await lruStats(hooks, SESSION_ID)), {
      ...STATS_ZEROED_COUNTERS,
      evictions: 1,
      bytesReclaimed: MIN_EVICTABLE_BYTES,
      evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
      stashHits: 1,
    })
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log never rotates when metricsRotationMaxBytes is zero", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const seedLine = metricsRotationPanelSeedLine()
    writeFileSync(metricsPath, `${JSON.stringify(seedLine)}\n`)
    const hooks = await loadPluginHooksWith({
      metricsLog: true,
      metricsPath,
      metricsRotationMaxBytes: METRICS_ROTATION_DISABLED_MAX_BYTES,
    })
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, METRICS_ROTATION_DISABLED_SUBJECT)
    await runTransform(hooks, bundle)
    assert.equal(await readEvicted(hooks, METRICS_ROTATION_DISABLED_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
    await runTransform(hooks, bundle)

    assert.equal(existsSync(rotatedMetricsPathIn(metricsDir)), false)
    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_ROTATION_DISABLED_TOTAL_LINES)
    assert.deepEqual(lines[0], seedLine)
    assert.equal(lines[1].session, SESSION_ID)
    assert.equal(lines[2].session, SESSION_ID)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log rotation replaces a prior .1 sibling with the rotated file", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    writeFileSync(rotatedMetricsPathIn(metricsDir), METRICS_STALE_ROTATED_CONTENT)
    writeFileSync(metricsPath, METRICS_ROTATION_SEED_CONTENT)
    const hooks = await loadPluginHooksWith({
      metricsLog: true,
      metricsPath,
      metricsRotationMaxBytes: METRICS_ROTATION_TINY_CAP,
    })
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    await runTransform(hooks, buildStandardBundle(SESSION_ID, METRICS_ROTATION_REPLACEMENT_SUBJECT))

    assert.equal(readFileSync(rotatedMetricsPathIn(metricsDir), "utf8"), METRICS_ROTATION_SEED_CONTENT)
    const freshLines = metricsLinesIn(metricsPath)
    assert.equal(freshLines.length, STATS_LOG_FILE_LINES)
    assert.equal(freshLines[0].session, SESSION_ID)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("panel data parses the post rotation state with the pre rotation line gone from history", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    // The seed line sits on its own session so the pre-rotation history stays
    // out of SESSION_ID's rehydration totals, which this test does not vary.
    writeFileSync(metricsPath, `${JSON.stringify(metricsRotationPanelSeedLine(METRICS_ROTATION_PANEL_SEED_SESSION))}\n`)
    const hooks = await loadPluginHooksWith({
      metricsLog: true,
      metricsPath,
      metricsRotationMaxBytes: METRICS_ROTATION_TINY_CAP,
    })
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    await runTransform(hooks, buildStandardBundle(SESSION_ID, METRICS_ROTATION_PANEL_SUBJECT))

    const rotatedLines = metricsLinesIn(rotatedMetricsPathIn(metricsDir))
    assert.equal(rotatedLines.length, STATS_LOG_FILE_LINES)
    assert.equal(rotatedLines[0].session, METRICS_ROTATION_PANEL_SEED_SESSION)

    const panel = await loadPanelData({ path: metricsPath, sessionID: SESSION_ID })
    assert.equal(panel.error, undefined)
    assert.equal(panel.current?.session, SESSION_ID)
    assert.equal(panel.current?.runs, STATS_LOG_FILE_LINES)
    assert.equal(panel.current?.totals.evictions, 1)
    assert.equal(panel.global.sessions, STATS_LOG_FILE_LINES)
    assert.equal(panel.global.runs, STATS_LOG_FILE_LINES)
    assert.equal(panel.global.evictions, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

const LIVE_STATE_DIR_NAME = "lru-state"
const DEFAULT_LIVE_STATE_DIR = join(homedir(), ...METRICS_DIR_SEGMENTS, LIVE_STATE_DIR_NAME)
const LIVE_STATE_TEMP_DIR_PREFIX = "lru-live-state-test-"
const LIVE_STATE_FILE_SUFFIX = ".json"
const LIVE_STATE_BLOCKER_FILE = "blocker.txt"
const DEFAULT_LIVE_STATE_PRUNE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const LIVE_STATE_PRUNE_TEST_MAX_AGE_MS = 1000
const LIVE_STATE_PRUNE_TEST_MIN_INTERVAL_MS = 0
const LIVE_STATE_PRUNE_THROTTLED_INTERVAL_MS = 60 * 1000
const LIVE_STATE_PRUNE_EXPIRY_INTERVAL_MS = 250
const LIVE_STATE_PRUNE_EXPIRY_WAIT_MS = 400
const DEFAULT_LIVE_STATE_PRUNE_MIN_INTERVAL_MS = 60 * 1000
const LIVE_STATE_PRUNE_BACKDATED_MS = 10000
const LIVE_STATE_STALE_SESSION = "lru-state-stale-session"
const LIVE_STATE_TMP_ORPHAN_SESSION = "lru-state-tmp-orphan"
const LIVE_STATE_TMP_ORPHAN_CONTENT = '{"orphan": true}\n'
const LIVE_STATE_TEMP_FILE_SUFFIX = ".tmp"
const LIVE_STATE_THROTTLE_STALE_SESSION_A = "lru-state-throttle-stale-a"
const LIVE_STATE_THROTTLE_STALE_SESSION_B = "lru-state-throttle-stale-b"
const LIVE_STATE_STUCK_SESSION = "lru-state-stuck-entry"
const LIVE_STATE_FRESH_SESSION = "lru-state-fresh-session"
const LIVE_STATE_STALE_CONTENT = '{"stale": true}\n'
const LIVE_STATE_FRESH_CONTENT = '{"fresh": true}\n'
const LIVE_STATE_QUIET_SUBJECT = "/data/state-quiet.txt"
const LIVE_STATE_MANUAL_SUBJECT = "/data/state-manual.txt"
const LIVE_STATE_CUSTOM_STATE_DIR = "/tmp/custom-lru-state"
const LIVE_STATE_CUSTOM_PRUNE_MAX_AGE_MS = 1000
const LIVE_STATE_CUSTOM_PRUNE_MIN_INTERVAL_MS = 500
const LIVE_STATE_ZERO_HINT_SUBJECTS = 0
const LIVE_STATE_ESCAPE_SEGMENT = "escape-dir"

const liveStatePathIn = (dir: string, sessionID: string): string => join(dir, `${sessionID}${LIVE_STATE_FILE_SUFFIX}`)

const blockedLiveStateDirIn = (dir: string): string => join(dir, LIVE_STATE_BLOCKER_FILE, LIVE_STATE_DIR_NAME)

const makeLiveStateDir = (): string => mkdtempSync(join(tmpdir(), LIVE_STATE_TEMP_DIR_PREFIX))

const loadPluginHooksWithLiveState = async (stateDir: string, extra: Record<string, unknown> = {}): Promise<HookMap> =>
  loadPluginHooksWith({ liveStateLog: true, liveStatePath: stateDir, ...extra })

const snapshotIn = (dir: string, sessionID: string): Record<string, unknown> =>
  JSON.parse(readFileSync(liveStatePathIn(dir, sessionID), "utf8")) as Record<string, unknown>

const snapshotBodyOf = (dir: string, sessionID: string): { ts: unknown; snapshot: Record<string, unknown> } => {
  const { ts, ...snapshot } = snapshotIn(dir, sessionID)
  return { ts, snapshot }
}

const assertValidTimestamp = (ts: unknown): void => {
  assert.equal(typeof ts, "string")
  assert.ok(Number.isNaN(new Date(ts as string).getTime()) === false)
}

test("live state snapshot is written on a quiet run with the exact schema budget counters stash occupancy and hot subjects", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir)

    const bundle = buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT)
    await runTransform(hooks, bundle)

    const { ts, snapshot } = snapshotBodyOf(stateDir, SESSION_ID)
    assertValidTimestamp(ts)
    assert.deepEqual(snapshot, {
      session: SESSION_ID,
      manualMode: false,
      modelContextTokens: null,
      modelContextTokensSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
      lastRun: { estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS), watermarkTokens: null, deficitTokens: null },
      totals: { ...STATS_ZEROED_COUNTERS },
      stash: { entries: 0, capacity: STASH_LIMIT },
      hotSubjects: [LIVE_STATE_QUIET_SUBJECT],
    })

    await runTransform(hooks, bundle)
    assert.deepEqual(snapshotBodyOf(stateDir, SESSION_ID).snapshot, {
      session: SESSION_ID,
      manualMode: false,
      modelContextTokens: null,
      modelContextTokensSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
      lastRun: { estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS), watermarkTokens: null, deficitTokens: null },
      totals: { ...STATS_ZEROED_COUNTERS },
      stash: { entries: 0, capacity: STASH_LIMIT },
      hotSubjects: [LIVE_STATE_QUIET_SUBJECT],
    })
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state snapshots keep one file per session in the state directory", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))
    await runTransform(hooks, buildStandardBundle(SESSION_ID_B, LIVE_STATE_QUIET_SUBJECT))
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    assert.deepEqual(readdirSync(stateDir).sort(), [`${SESSION_ID}.json`, `${SESSION_ID_B}.json`].sort())
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state snapshot carries the captured budget source and manual mode with a null watermark on a manual run", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir, { manualMode: true })
    await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

    const bundle = buildStandardBundle(SESSION_ID, LIVE_STATE_MANUAL_SUBJECT)
    await runTransform(hooks, bundle)

    const { ts, snapshot } = snapshotBodyOf(stateDir, SESSION_ID)
    assertValidTimestamp(ts)
    assert.equal(snapshot.session, SESSION_ID)
    assert.equal(snapshot.manualMode, true)
    assert.equal(snapshot.modelContextTokens, WATERMARK_PROBE_CONTEXT_LIMIT)
    assert.equal(snapshot.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
    assert.deepEqual(snapshot.lastRun, {
      estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
      watermarkTokens: null,
      deficitTokens: null,
    })
    assert.deepEqual(snapshot.totals, { ...STATS_ZEROED_COUNTERS })
    assert.deepEqual(snapshot.stash, { entries: 0, capacity: STASH_LIMIT })
    assert.deepEqual(snapshot.hotSubjects, [LIVE_STATE_MANUAL_SUBJECT])
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state snapshot records eviction totals stash occupancy and an empty hot list after a pressured run", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir)
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT)
    await runTransform(hooks, bundle)

    const { snapshot } = snapshotBodyOf(stateDir, SESSION_ID)
    assert.equal(snapshot.manualMode, false)
    assert.equal(snapshot.modelContextTokens, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
    assert.equal(snapshot.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
    assert.deepEqual(snapshot.lastRun, {
      estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
      watermarkTokens: tokensForChars(STANDARD_BUNDLE_CHARS) - OVER_BY_ONE_TOKENS,
      deficitTokens: OVER_BY_ONE_TOKENS,
    })
    assert.deepEqual(snapshot.totals, {
      ...STATS_ZEROED_COUNTERS,
      evictions: 1,
      bytesReclaimed: MIN_EVICTABLE_BYTES,
      evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    })
    assert.deepEqual(snapshot.stash, { entries: 1, capacity: STASH_LIMIT })
    assert.deepEqual(snapshot.hotSubjects, [])
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state write skips an unsafe session key instead of writing outside the state directory", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir)

    const escapeBundle = buildBundle(
      [[pathToolPart(LIVE_STATE_QUIET_SUBJECT, MIN_EVICTABLE_BYTES)], ...fillerMessages()],
      `${LIVE_STATE_ESCAPE_SEGMENT}/${SESSION_ID}`,
    )
    await runTransform(hooks, escapeBundle)

    assert.equal(readdirSync(stateDir).length, 0)
    const stats = await lruStats(hooks, `${LIVE_STATE_ESCAPE_SEGMENT}/${SESSION_ID}`)
    assert.deepEqual(stats.lastRun, {
      estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
      watermarkTokens: null,
      deficitTokens: null,
    })
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state pruning on write removes files untouched past the age bound and keeps fresh ones", async () => {
  const stateDir = makeLiveStateDir()
  try {
    mkdirSync(stateDir, { recursive: true })
    const stalePath = liveStatePathIn(stateDir, LIVE_STATE_STALE_SESSION)
    writeFileSync(stalePath, LIVE_STATE_STALE_CONTENT)
    const staleMoment = new Date(Date.now() - LIVE_STATE_PRUNE_BACKDATED_MS)
    utimesSync(stalePath, staleMoment, staleMoment)
    const freshPath = liveStatePathIn(stateDir, LIVE_STATE_FRESH_SESSION)
    writeFileSync(freshPath, LIVE_STATE_FRESH_CONTENT)

    const hooks = await loadPluginHooksWithLiveState(stateDir, {
      liveStatePruneMaxAgeMs: LIVE_STATE_PRUNE_TEST_MAX_AGE_MS,
      liveStatePruneMinIntervalMs: LIVE_STATE_PRUNE_TEST_MIN_INTERVAL_MS,
    })
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    assert.equal(existsSync(stalePath), false)
    assert.equal(readFileSync(freshPath, "utf8"), LIVE_STATE_FRESH_CONTENT)
    assert.equal(existsSync(liveStatePathIn(stateDir, SESSION_ID)), true)
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state pruning removes a stale temp file orphan while keeping fresh snapshots", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir, {
      liveStatePruneMaxAgeMs: LIVE_STATE_PRUNE_TEST_MAX_AGE_MS,
      liveStatePruneMinIntervalMs: LIVE_STATE_PRUNE_TEST_MIN_INTERVAL_MS,
    })
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    const orphanPath = join(stateDir, `${LIVE_STATE_TMP_ORPHAN_SESSION}${LIVE_STATE_FILE_SUFFIX}${LIVE_STATE_TEMP_FILE_SUFFIX}`)
    writeFileSync(orphanPath, LIVE_STATE_TMP_ORPHAN_CONTENT)
    const staleMoment = new Date(Date.now() - LIVE_STATE_PRUNE_BACKDATED_MS)
    utimesSync(orphanPath, staleMoment, staleMoment)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    assert.equal(existsSync(orphanPath), false)
    assert.equal(existsSync(liveStatePathIn(stateDir, SESSION_ID)), true)
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state pruning skips an undeletable stale entry and still writes the fresh snapshot", async () => {
  const stateDir = makeLiveStateDir()
  try {
    mkdirSync(stateDir, { recursive: true })
    const stuckPath = liveStatePathIn(stateDir, LIVE_STATE_STUCK_SESSION)
    mkdirSync(stuckPath)
    const staleMoment = new Date(Date.now() - LIVE_STATE_PRUNE_BACKDATED_MS)
    utimesSync(stuckPath, staleMoment, staleMoment)

    const hooks = await loadPluginHooksWithLiveState(stateDir, {
      liveStatePruneMaxAgeMs: LIVE_STATE_PRUNE_TEST_MAX_AGE_MS,
      liveStatePruneMinIntervalMs: LIVE_STATE_PRUNE_TEST_MIN_INTERVAL_MS,
    })
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    assert.equal(existsSync(stuckPath), true)
    assert.equal(existsSync(liveStatePathIn(stateDir, SESSION_ID)), true)
    const stats = await lruStats(hooks, SESSION_ID)
    assert.equal(Object.hasOwn(stats, "stateWriteError"), false)
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state prune scan runs at most once per throttle interval per plugin instance while snapshot writes stay unaffected", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir, {
      liveStatePruneMaxAgeMs: LIVE_STATE_PRUNE_TEST_MAX_AGE_MS,
      liveStatePruneMinIntervalMs: LIVE_STATE_PRUNE_THROTTLED_INTERVAL_MS,
    })
    const staleMoment = new Date(Date.now() - LIVE_STATE_PRUNE_BACKDATED_MS)
    const firstStalePath = liveStatePathIn(stateDir, LIVE_STATE_THROTTLE_STALE_SESSION_A)
    writeFileSync(firstStalePath, LIVE_STATE_STALE_CONTENT)
    utimesSync(firstStalePath, staleMoment, staleMoment)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))
    assert.equal(existsSync(firstStalePath), false)

    const secondStalePath = liveStatePathIn(stateDir, LIVE_STATE_THROTTLE_STALE_SESSION_B)
    writeFileSync(secondStalePath, LIVE_STATE_STALE_CONTENT)
    utimesSync(secondStalePath, staleMoment, staleMoment)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    assert.equal(existsSync(secondStalePath), true)
    assert.equal(existsSync(liveStatePathIn(stateDir, SESSION_ID)), true)
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state prune scan runs again once the injected throttle interval has elapsed", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir, {
      liveStatePruneMaxAgeMs: LIVE_STATE_PRUNE_TEST_MAX_AGE_MS,
      liveStatePruneMinIntervalMs: LIVE_STATE_PRUNE_EXPIRY_INTERVAL_MS,
    })
    const staleMoment = new Date(Date.now() - LIVE_STATE_PRUNE_BACKDATED_MS)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    const lateStalePath = liveStatePathIn(stateDir, LIVE_STATE_THROTTLE_STALE_SESSION_A)
    writeFileSync(lateStalePath, LIVE_STATE_STALE_CONTENT)
    utimesSync(lateStalePath, staleMoment, staleMoment)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))
    assert.equal(existsSync(lateStalePath), true)

    await sleepMs(LIVE_STATE_PRUNE_EXPIRY_WAIT_MS)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    assert.equal(existsSync(lateStalePath), false)
    assert.equal(existsSync(liveStatePathIn(stateDir, SESSION_ID)), true)
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state write records stateWriteError and leaves no temp file behind when the rename fails", async () => {
  const stateDir = makeLiveStateDir()
  try {
    mkdirSync(liveStatePathIn(stateDir, SESSION_ID))
    const hooks = await loadPluginHooksWithLiveState(stateDir)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    const stats = await lruStats(hooks, SESSION_ID)
    assert.equal(typeof stats.stateWriteError, "string")
    assert.ok((stats.stateWriteError as string).length > 0)
    assert.deepEqual(readdirSync(stateDir), [`${SESSION_ID}.json`])
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state write failure records stateWriteError through lru_stats without interrupting the session", async () => {
  const stateDir = makeLiveStateDir()
  try {
    writeFileSync(join(stateDir, LIVE_STATE_BLOCKER_FILE), "not a directory")
    const hooks = await loadPluginHooksWithLiveState(blockedLiveStateDirIn(stateDir))
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_BLOCKED_SUBJECT)
    await runTransform(hooks, bundle)

    const stats = await lruStats(hooks, SESSION_ID)
    assert.equal(typeof stats.stateWriteError, "string")
    assert.ok((stats.stateWriteError as string).length > 0)
    assert.equal(countersOf(stats).evictions, 1)
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state clears a recorded write failure once a later write succeeds", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const blockedDir = blockedLiveStateDirIn(stateDir)
    writeFileSync(join(stateDir, LIVE_STATE_BLOCKER_FILE), "not a directory")
    const hooks = await loadPluginHooksWithLiveState(blockedDir)
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_BLOCKED_SUBJECT)
    await runTransform(hooks, bundle)
    assert.equal(typeof (await lruStats(hooks, SESSION_ID)).stateWriteError, "string")

    rmSync(join(stateDir, LIVE_STATE_BLOCKER_FILE))
    await runTransform(hooks, bundle)

    const stats = await lruStats(hooks, SESSION_ID)
    assert.equal(Object.hasOwn(stats, "stateWriteError"), false)
    assert.equal(countersOf(stats).evictions, 1)
    assert.equal(existsSync(liveStatePathIn(blockedDir, SESSION_ID)), true)
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state snapshot carries an empty hot subject list when hintSubjects is zero", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir, { hintSubjects: LIVE_STATE_ZERO_HINT_SUBJECTS })

    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    assert.deepEqual(snapshotBodyOf(stateDir, SESSION_ID).snapshot.hotSubjects, [])
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("lru_stats reports the live state options defaulting beside the metrics log and round tripping custom values", async () => {
  const defaultOptions = ((await lruStats(await loadPluginHooks(), SESSION_ID)).options as Record<string, unknown>)
  assert.equal(defaultOptions.liveStateLog, false)
  assert.equal(defaultOptions.liveStatePath, DEFAULT_LIVE_STATE_DIR)
  assert.equal(defaultOptions.liveStatePruneMaxAgeMs, DEFAULT_LIVE_STATE_PRUNE_MAX_AGE_MS)
  assert.equal(defaultOptions.liveStatePruneMinIntervalMs, DEFAULT_LIVE_STATE_PRUNE_MIN_INTERVAL_MS)
  assert.equal(DEFAULT_LIVE_STATE_DIR, join(homedir(), ".local", "share", "opencode", "lru-state"))

  const customHooks = await loadPluginHooksWith({
    liveStateLog: true,
    liveStatePath: LIVE_STATE_CUSTOM_STATE_DIR,
    liveStatePruneMaxAgeMs: LIVE_STATE_CUSTOM_PRUNE_MAX_AGE_MS,
    liveStatePruneMinIntervalMs: LIVE_STATE_CUSTOM_PRUNE_MIN_INTERVAL_MS,
  })
  const customOptions = (await lruStats(customHooks, SESSION_ID)).options as Record<string, unknown>
  assert.equal(customOptions.liveStateLog, true)
  assert.equal(customOptions.liveStatePath, LIVE_STATE_CUSTOM_STATE_DIR)
  assert.equal(customOptions.liveStatePruneMaxAgeMs, LIVE_STATE_CUSTOM_PRUNE_MAX_AGE_MS)
  assert.equal(customOptions.liveStatePruneMinIntervalMs, LIVE_STATE_CUSTOM_PRUNE_MIN_INTERVAL_MS)
})

test("lru_stats counts expired reasoning parts and bytes without counting them as evictions", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [reasoningPart(REASONING_COLD_TEXT), reasoningPart(REASONING_SECOND_COLD_TEXT)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(countersOf(await lruStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    reasoningExpired: EXPIRED_REASONING_PAIR_COUNT,
    reasoningBytesExpired: EXPIRED_REASONING_PAIR_BYTES,
  })
})

test("lru_stats leaves reasoning counters at zero when a pressured session has no reasoning parts", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, "/data/no-reasoning.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.deepEqual(countersOf(await lruStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
  })
})

test("metrics log counts expired reasoning bytes separately from evictions on a reasoning only quiet run", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithMetricsLog(metricsLogPathIn(metricsDir))

    const bundle = buildBundle([
      [reasoningPart(REASONING_COLD_TEXT), pathToolPart("/data/quiet.txt", APPEARANCE_ONLY_OUTPUT_BYTES)],
      ...fillerMessages(),
    ])
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].reasoningExpiredThisRun, EXPIRED_REASONING_SINGLE_COUNT)
    assert.equal(lines[0].reasoningBytesExpiredThisRun, REASONING_COLD_TEXT.length)
    assert.deepEqual(lines[0].evictedThisRun, [])
    assert.equal(lines[0].dedupedThisRun, 0)
    assert.deepEqual(lines[0].totals, {
      ...STATS_ZEROED_COUNTERS,
      reasoningExpired: EXPIRED_REASONING_SINGLE_COUNT,
      reasoningBytesExpired: REASONING_COLD_TEXT.length,
    })
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

const ATTACHMENTS_STATE_KEY = "attachments"
const ATTACHMENT_ID_KEY = "id"
const ATTACHMENT_MESSAGE_ID_KEY = "messageID"
const ATTACHMENT_MIME_KEY = "mime"
const ATTACHMENT_SESSION_ID_KEY = "sessionID"
const ATTACHMENT_TYPE_KEY = "type"
const ATTACHMENT_TYPE_FILE = "file"
const ATTACHMENT_URL_KEY = "url"
const ATTACHMENT_URL_PREFIX = "data"
const ATTACHMENT_URL_ENCODING = "base64"
const ATTACHMENT_URL_PAYLOAD_CHAR = "A"
const ATTACHMENT_MIME_PNG = "image/png"
const ATTACHMENT_MIME_JPEG = "image/jpeg"
const ATTACHMENT_PAYLOAD_CHARS_PRIMARY = 12000
const ATTACHMENT_PAYLOAD_CHARS_SECONDARY = 300
const ATTACHMENT_CALL_ID_OLDER = "call_older"
const ATTACHMENT_CALL_ID_NEWER = "call_newer"
const ATTACHMENT_CALL_ID_PRIMARY = "call_primary"
const ATTACHMENT_CALL_ID_DUAL = "call_dual"
const ATTACHMENT_CALL_ID_MIXED = "call_mixed"
const ATTACHMENT_CALL_ID_LOGGED = "call_logged"
const ATTACHMENT_CALL_ID_COUNTED = "call_counted"
const ATTACHMENT_MESSAGE_ID = "msg_lru_attachment"
const ATTACHED_PATH = "/data/attached.txt"
const TOMBSTONE_ATTACHMENTS_NOTICE = "attachments dropped"
const STASH_ATTACHMENTS_LEAD = "attachments evicted with this output"
const STASH_ATTACHMENT_DROPPED_TAIL = "payloads were dropped during eviction; re-run the tool to regenerate them"
const ATTACHED_MIXED_TOOL_PART_COUNT = 2
const ATTACHED_MIXED_BUNDLE_CHARS =
  ATTACHED_MIXED_TOOL_PART_COUNT * MIN_EVICTABLE_BYTES + RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS
const ATTACHED_TOMBSTONE_MESSAGES_AGO = 5
const SIBLING_PLAIN_PATH = "/data/plain-sibling.txt"
const NON_ARRAY_ATTACHMENTS_PATH = "/data/non-array-attachments.txt"
const NON_ARRAY_ATTACHMENTS_KEY = "attachments"
const NON_ARRAY_ATTACHMENTS_VALUE = "not an attachment array"

const attachmentUrlOf = (mime: string, payloadChars: number): string =>
  `${ATTACHMENT_URL_PREFIX}:${mime};${ATTACHMENT_URL_ENCODING},${ATTACHMENT_URL_PAYLOAD_CHAR.repeat(payloadChars)}`

const ATTACHED_URL_PRIMARY_CHARS = attachmentUrlOf(ATTACHMENT_MIME_PNG, ATTACHMENT_PAYLOAD_CHARS_PRIMARY).length
const ATTACHED_URL_SECONDARY_CHARS = attachmentUrlOf(ATTACHMENT_MIME_JPEG, ATTACHMENT_PAYLOAD_CHARS_SECONDARY).length

const attachmentItemOf = (mime: string, payloadChars: number, callID: string): AttachmentItem => ({
  [ATTACHMENT_ID_KEY]: `att_${callID}`,
  [ATTACHMENT_MESSAGE_ID_KEY]: ATTACHMENT_MESSAGE_ID,
  [ATTACHMENT_MIME_KEY]: mime,
  [ATTACHMENT_SESSION_ID_KEY]: SESSION_ID,
  [ATTACHMENT_TYPE_KEY]: ATTACHMENT_TYPE_FILE,
  [ATTACHMENT_URL_KEY]: attachmentUrlOf(mime, payloadChars),
})

const completedToolPartWithAttachments = (
  tool: string,
  input: Record<string, unknown>,
  output: string,
  attachments: AttachmentItem[],
): AttachedToolPart => ({
  type: "tool",
  tool,
  state: { status: "completed", input, output, [ATTACHMENTS_STATE_KEY]: attachments },
})

const attachmentsOf = (message: StrictMessage, partIndex: number): unknown =>
  (message.parts[partIndex] as { state: { attachments?: unknown } }).state.attachments

const evictionTombstoneFor = (
  tool: string,
  subject: string,
  bytes: number,
  messagesAgo: number,
  attachmentsDropped: boolean,
  output: string,
): string =>
  `${TOMBSTONE_MARKER} ${tool} ${subject} (${bytes} bytes${attachmentsDropped ? `, ${TOMBSTONE_ATTACHMENTS_NOTICE}` : ""}, ~${messagesAgo} messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(tool, subject, output)}`

const attachmentSummaryFor = (mime: string, uriChars: number): string => `${mime} data URI ${uriChars} chars`

const attachmentManifestLineFor = (summaries: string[]): string =>
  `${STASH_MARKER} ${STASH_ATTACHMENTS_LEAD}: ${summaries.join(HINT_SUBJECT_SEPARATOR)}; ${STASH_ATTACHMENT_DROPPED_TAIL}.`

const attachedReadPart = (callID: string, payloadChars: number): AttachedToolPart =>
  completedToolPartWithAttachments(
    READ_TOOL,
    { [PATH_INPUT_KEY]: ATTACHED_PATH },
    outputOfBytes(MIN_EVICTABLE_BYTES),
    [attachmentItemOf(ATTACHMENT_MIME_PNG, payloadChars, callID)],
  )

test("transform evicts an attachment bearing output writes the attachments dropped clause and removes the state attachments", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([[attachedReadPart(ATTACHMENT_CALL_ID_PRIMARY, ATTACHMENT_PAYLOAD_CHARS_PRIMARY)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${evictionTombstoneFor(READ_TOOL, ATTACHED_PATH, MIN_EVICTABLE_BYTES, ATTACHED_TOMBSTONE_MESSAGES_AGO, true, outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor(ATTACHED_PATH)}`,
  )
  assert.equal(attachmentsOf(bundle.messages[0], 0), undefined)
})

test("transform keeps the no attachment sibling tombstone in the plain format while evicting an attached sibling", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(ATTACHED_MIXED_BUNDLE_CHARS, TWO_ENTRY_DEFICIT_TOKENS))

  const bundle = buildBundle([
    [
      attachedReadPart(ATTACHMENT_CALL_ID_MIXED, ATTACHMENT_PAYLOAD_CHARS_PRIMARY),
      pathToolPart(SIBLING_PLAIN_PATH, MIN_EVICTABLE_BYTES),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${evictionTombstoneFor(READ_TOOL, ATTACHED_PATH, MIN_EVICTABLE_BYTES, ATTACHED_TOMBSTONE_MESSAGES_AGO, true, outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor(ATTACHED_PATH)}`,
  )
  assert.equal(attachmentsOf(bundle.messages[0], 0), undefined)
  assert.equal(
    toolPartAt(bundle.messages[0], 1).state.output,
    `${evictionTombstoneFor(READ_TOOL, SIBLING_PLAIN_PATH, MIN_EVICTABLE_BYTES, ATTACHED_TOMBSTONE_MESSAGES_AGO, false, outputOfBytes(MIN_EVICTABLE_BYTES))}${reloadPointerFor(SIBLING_PLAIN_PATH)}`,
  )
  assert.equal(Object.hasOwn(toolPartAt(bundle.messages[0], 1).state, ATTACHMENTS_STATE_KEY), false)
})

test("transform ignores a non array attachments field when evicting and leaves the field in place", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: NON_ARRAY_ATTACHMENTS_PATH }, outputOfBytes(MIN_EVICTABLE_BYTES))],
    ...fillerMessages(),
  ])
  const state = (bundle.messages[0].parts[0] as { state: Record<string, unknown> }).state
  state[NON_ARRAY_ATTACHMENTS_KEY] = NON_ARRAY_ATTACHMENTS_VALUE
  await runTransform(hooks, bundle)

  const output = toolPartAt(bundle.messages[0], 0).state.output
  assert.ok(output.startsWith(`${TOMBSTONE_MARKER} read ${NON_ARRAY_ATTACHMENTS_PATH} (${MIN_EVICTABLE_BYTES} bytes, ~5 messages ago)`))
  assert.equal(output.includes(TOMBSTONE_ATTACHMENTS_NOTICE), false)
  assert.equal(state[NON_ARRAY_ATTACHMENTS_KEY], NON_ARRAY_ATTACHMENTS_VALUE)
  assert.deepEqual(countersOf(await lruStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
  })
  assert.equal(await readEvicted(hooks, NON_ARRAY_ATTACHMENTS_PATH, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("read_evicted returns the original output plus a manifest naming the dropped attachment payload after an attachment bearing eviction", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([[attachedReadPart(ATTACHMENT_CALL_ID_PRIMARY, ATTACHMENT_PAYLOAD_CHARS_PRIMARY)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  assert.equal(
    await readEvicted(hooks, ATTACHED_PATH, SESSION_ID),
    `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${attachmentManifestLineFor([attachmentSummaryFor(ATTACHMENT_MIME_PNG, ATTACHED_URL_PRIMARY_CHARS)])}`,
  )
})

test("read_evicted lists every attachment in the manifest when an eviction drops multiple attachments", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([
    [
      completedToolPartWithAttachments(READ_TOOL, { [PATH_INPUT_KEY]: ATTACHED_PATH }, outputOfBytes(MIN_EVICTABLE_BYTES), [
        attachmentItemOf(ATTACHMENT_MIME_PNG, ATTACHMENT_PAYLOAD_CHARS_PRIMARY, ATTACHMENT_CALL_ID_DUAL),
        attachmentItemOf(ATTACHMENT_MIME_JPEG, ATTACHMENT_PAYLOAD_CHARS_SECONDARY, ATTACHMENT_CALL_ID_DUAL),
      ]),
    ],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    await readEvicted(hooks, ATTACHED_PATH, SESSION_ID),
    `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${attachmentManifestLineFor([
      attachmentSummaryFor(ATTACHMENT_MIME_PNG, ATTACHED_URL_PRIMARY_CHARS),
      attachmentSummaryFor(ATTACHMENT_MIME_JPEG, ATTACHED_URL_SECONDARY_CHARS),
    ])}`,
  )
})

test("transform strips attachments from a dedup tombstoned older call while the retained copy keeps its attachments", async () => {
  const hooks = await loadPluginHooks()

  const olderPart = completedToolPartWithAttachments(
    READ_TOOL,
    { [PATH_INPUT_KEY]: DEDUP_PATH },
    outputOfBytes(THREE_ENTRY_OUTPUT_BYTES),
    [attachmentItemOf(ATTACHMENT_MIME_PNG, ATTACHMENT_PAYLOAD_CHARS_PRIMARY, ATTACHMENT_CALL_ID_OLDER)],
  )
  const newerPart = completedToolPartWithAttachments(
    READ_TOOL,
    { [PATH_INPUT_KEY]: DEDUP_PATH },
    outputOfBytes(THREE_ENTRY_OUTPUT_BYTES),
    [attachmentItemOf(ATTACHMENT_MIME_JPEG, ATTACHMENT_PAYLOAD_CHARS_SECONDARY, ATTACHMENT_CALL_ID_NEWER)],
  )
  const bundle = buildBundle([[olderPart], ...fillerMessages(2), [newerPart], ...fillerMessages(2)])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 3))
  assert.equal(attachmentsOf(bundle.messages[0], 0), undefined)
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.deepEqual(attachmentsOf(bundle.messages[3], 0), [
    attachmentItemOf(ATTACHMENT_MIME_JPEG, ATTACHMENT_PAYLOAD_CHARS_SECONDARY, ATTACHMENT_CALL_ID_NEWER),
  ])
})

test("lru_stats counts a superseded duplicate's attachment payload chars in the dedup token-savings estimate", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [attachedReadPart(ATTACHMENT_CALL_ID_OLDER, ATTACHMENT_PAYLOAD_CHARS_PRIMARY)],
    ...fillerMessages(2),
    [attachedReadPart(ATTACHMENT_CALL_ID_NEWER, ATTACHMENT_PAYLOAD_CHARS_SECONDARY)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(countersOf(await lruStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    deduped: 1,
    dedupedBytes: MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS,
    dedupTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS),
  })
})

test("transform ignores a non array attachments field when deduplicating and leaves the field in place", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: NON_ARRAY_ATTACHMENTS_PATH }, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))],
    ...fillerMessages(2),
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: NON_ARRAY_ATTACHMENTS_PATH }, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))],
    ...fillerMessages(2),
  ])
  const olderState = (bundle.messages[0].parts[0] as { state: Record<string, unknown> }).state
  olderState[NON_ARRAY_ATTACHMENTS_KEY] = NON_ARRAY_ATTACHMENTS_VALUE
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 3))
  assert.equal(olderState[NON_ARRAY_ATTACHMENTS_KEY], NON_ARRAY_ATTACHMENTS_VALUE)
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
})

test("lru_stats counts attachment payload characters in bytesReclaimed for an attachment bearing eviction", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([[attachedReadPart(ATTACHMENT_CALL_ID_COUNTED, ATTACHMENT_PAYLOAD_CHARS_PRIMARY)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  assert.deepEqual(countersOf(await lruStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS),
  })
})

test("metrics log records attachmentBytes on each evicted entry and adds the payload to the reclaimed totals", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithMetricsLog(metricsLogPathIn(metricsDir))
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildBundle([[attachedReadPart(ATTACHMENT_CALL_ID_LOGGED, ATTACHMENT_PAYLOAD_CHARS_PRIMARY)], ...fillerMessages()])
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.deepEqual(lines[0].evictedThisRun, [
      {
        tool: READ_TOOL,
        subject: ATTACHED_PATH,
        bytes: MIN_EVICTABLE_BYTES,
        attachmentBytes: ATTACHED_URL_PRIMARY_CHARS,
        messagesAgo: ATTACHED_TOMBSTONE_MESSAGES_AGO,
      },
    ])
    assert.deepEqual(lines[0].totals, {
      ...STATS_ZEROED_COUNTERS,
      evictions: 1,
      bytesReclaimed: MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS,
      evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS),
    })
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

const FENCE_TICKS = "```"
const FENCE_FOUR_TICKS = "````"
const FENCE_LANGUAGE_TS = "ts"
const FENCE_LANGUAGE_JS = "js"
const FENCE_NO_LANGUAGE = undefined
const FENCE_INFO_STRING_TS = 'ts title="paste"'
const FENCE_INFO_STRING_WITH_BACKTICKS = "js `code` sample"
const FENCE_INDENT_FOUR_SPACES = "    "
const FENCE_INDENT_THREE_SPACES = "   "
const FENCE_INDENT_TWO_SPACES = "  "
const FENCE_INNER_TICK_LINE_INDEX = 1
const FENCE_EVICTED_MARKER = "[lru-evicted-fence]"
const FENCE_STASH_TOOL_LABEL = "fence"
const FENCE_DEFAULT_MIN_BLOCK_LINES = 40
const FENCE_OVER_LINES = 42
const FENCE_TEST_THRESHOLD = 3
const FENCE_PROSE_BEFORE = "here is the paste I mentioned"
const FENCE_PROSE_MIDDLE = "prose between the two fences"
const FENCE_PROSE_AFTER = "and that is the whole paste"
const FENCE_LINE_TAG = "log"
const FENCE_LINE_TAG_A = "alpha"
const FENCE_LINE_TAG_B = "beta"
const FENCE_BLANK_LEAD_LINES = 2
const FENCE_TRAILING_NEWLINE_CHARS = 1
const FENCE_COMPOSED_PAD_CHARS = 4000
const COMPOSED_COLD_PATH = "/data/fence-composed-cold.txt"
const USER_ROLE = "user"
const ASSISTANT_ROLE = "assistant"

const fenceFirstLineOf = (tag: string): string => `${tag} line 0`

const fenceContentLines = (count: number, tag: string): string[] =>
  Array.from({ length: count }, (_, index) => `${tag} line ${index}`)

const fenceBlockText = (language: string | undefined, contentLines: string[]): string =>
  `${FENCE_TICKS}${language ?? ""}\n${contentLines.join("\n")}\n${FENCE_TICKS}`

const userTextMessageFor = (sessionID: string, role: string, text: string): StrictMessage => ({
  info: { sessionID, role },
  parts: [textPart(text)],
})

const userFenceBundle = (text: string): StrictBundle => roleFenceBundle(USER_ROLE, text)

const roleFenceBundle = (role: string, text: string): StrictBundle => ({
  messages: [
    userTextMessageFor(SESSION_ID, role, text),
    ...fillerMessages().map((parts) => syntheticMessageFor(SESSION_ID, parts)),
  ],
})

const windowFenceBundle = (text: string): StrictBundle => ({
  messages: [
    ...fillerMessages().map((parts) => syntheticMessageFor(SESSION_ID, parts)),
    userTextMessageFor(SESSION_ID, USER_ROLE, text),
  ],
})

const textAt = (bundle: StrictBundle, messageIndex: number): string =>
  (bundle.messages[messageIndex].parts[0] as TextPart).text

const fenceTombstoneFor = (language: string | undefined, contentLineCount: number, firstLine: string): string =>
  `${FENCE_EVICTED_MARKER} ${language === undefined ? "code block" : `${language} code block`} (${contentLineCount} lines, first line "${firstLine}") was evicted to reclaim context.${reloadPointerFor(firstLine)}`

test("transform never opens a span from a fence opener whose info string contains backticks and treats it as content", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const unclosedBacktickBlock = `${FENCE_TICKS}${FENCE_INFO_STRING_WITH_BACKTICKS}\n${fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG).join("\n")}`
  const realBlock = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG_B))
  const text = `${FENCE_PROSE_BEFORE}\n${unclosedBacktickBlock}\n${FENCE_PROSE_MIDDLE}\n${realBlock}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${unclosedBacktickBlock}\n${FENCE_PROSE_MIDDLE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG_B))}\n${FENCE_PROSE_AFTER}`,
  )
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG)))
})

test("transform leaves every user fenced block byte-identical while userFenceEviction stays disabled by default", async () => {
  const hooks = await loadPluginHooks()
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG)))
})

test("transform evicts an over threshold fenced block from an old user message into a tombstone naming language line count and first non empty line", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const contentLines = [
    ...Array.from({ length: FENCE_BLANK_LEAD_LINES }, () => ""),
    fenceFirstLineOf(FENCE_LINE_TAG),
    ...fenceContentLines(FENCE_OVER_LINES - FENCE_BLANK_LEAD_LINES - 1, FENCE_LINE_TAG),
  ]
  const block = fenceBlockText(FENCE_LANGUAGE_TS, contentLines)
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG))}\n${FENCE_PROSE_AFTER}`,
  )
})

test("read_evicted returns the exact stashed fence block text after a fence eviction", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`))

  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)
})

test("transform keeps a fenced block exactly at minBlockLines and evicts the anonymous block one line over it", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true, minBlockLines: FENCE_TEST_THRESHOLD } })
  const atThreshold = fenceBlockText(FENCE_NO_LANGUAGE, fenceContentLines(FENCE_TEST_THRESHOLD, FENCE_LINE_TAG_A))
  const overThreshold = fenceBlockText(FENCE_NO_LANGUAGE, fenceContentLines(FENCE_TEST_THRESHOLD + 1, FENCE_LINE_TAG_B))
  const text = `${FENCE_PROSE_BEFORE}\n${atThreshold}\n${FENCE_PROSE_MIDDLE}\n${overThreshold}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${atThreshold}\n${FENCE_PROSE_MIDDLE}\n${fenceTombstoneFor(FENCE_NO_LANGUAGE, FENCE_TEST_THRESHOLD + 1, fenceFirstLineOf(FENCE_LINE_TAG_B))}\n${FENCE_PROSE_AFTER}`,
  )
})

test("transform evicts every over threshold fence in one user part and keeps the prose between them byte-identical", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const blockA = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG_A))
  const blockB = fenceBlockText(FENCE_LANGUAGE_JS, fenceContentLines(FENCE_OVER_LINES + 1, FENCE_LINE_TAG_B))
  const text = `${FENCE_PROSE_BEFORE}\n${blockA}\n${FENCE_PROSE_MIDDLE}\n${blockB}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG_A))}\n${FENCE_PROSE_MIDDLE}\n${fenceTombstoneFor(FENCE_LANGUAGE_JS, FENCE_OVER_LINES + 1, fenceFirstLineOf(FENCE_LINE_TAG_B))}\n${FENCE_PROSE_AFTER}`,
  )
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG_A), SESSION_ID), `${blockA}\n`)
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG_B), SESSION_ID), `${blockB}\n`)
})

test("transform never evicts an unterminated fence however large it grows", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const text = `${FENCE_PROSE_BEFORE}\n${FENCE_TICKS}${FENCE_LANGUAGE_TS}\n${fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG).join("\n")}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG)))
})

test("transform keeps an all blank fenced block untouched no matter how many blank lines it holds", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, Array.from({ length: FENCE_OVER_LINES }, () => ""))
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await readEvicted(hooks, UNKNOWN_TARGET_LABEL, SESSION_ID), stashMissFor(UNKNOWN_TARGET_LABEL))
})

test("transform truncates a long fence first line in the tombstone and reload pointer to the same capped subject", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const longLine = fenceContentLines(1, "L".repeat(RENDERED_SUBJECT_CAP)).join("")
  const contentLines = [longLine, ...fenceContentLines(FENCE_OVER_LINES - 1, FENCE_LINE_TAG)]
  const block = fenceBlockText(FENCE_LANGUAGE_TS, contentLines)
  const bundle = userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`)
  await runTransform(hooks, bundle)

  const truncated = `${longLine.slice(0, RENDERED_SUBJECT_CAP - ELLIPSIS_MARKER.length)}${ELLIPSIS_MARKER}`
  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, truncated)}\n${FENCE_PROSE_AFTER}`,
  )
  assert.equal(await readEvicted(hooks, truncated, SESSION_ID), `${block}\n`)
})

test("read_evicted evicts the oldest stashed entry when fence evictions push a session stash past the fifty entry bound", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const fenceCount = STASH_OVERFLOW_COUNT
  const blocks = Array.from({ length: fenceCount }, (_, index) =>
    fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, `block${index}`)),
  )
  const text = `${FENCE_PROSE_BEFORE}\n${blocks.join(`\n${FENCE_PROSE_MIDDLE}\n`)}\n${FENCE_PROSE_AFTER}`
  await runTransform(hooks, userFenceBundle(text))

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).fenceEvicted, fenceCount)
  assert.equal(countersOf(stats).stashDropped, 1)
  assert.deepEqual(stats.stash, { entries: STASH_LIMIT, capacity: STASH_LIMIT })
  assert.equal(await readEvicted(hooks, fenceFirstLineOf("block0"), SESSION_ID), stashMissFor(fenceFirstLineOf("block0")))
  assert.equal(await readEvicted(hooks, fenceFirstLineOf("block1"), SESSION_ID), `${blocks[1]}\n`)
})

test("transform lowers the estimate with fence bytes before the budget decision and lands the block in the shared bounded stash", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const padLine = "p".repeat(FENCE_COMPOSED_PAD_CHARS)
  const contentLines = [fenceFirstLineOf(FENCE_LINE_TAG), ...Array.from({ length: FENCE_OVER_LINES - 1 }, () => padLine)]
  const block = fenceBlockText(FENCE_LANGUAGE_TS, contentLines)
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const tombstone = fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG))
  const postFenceChars =
    text.replace(block, tombstone).length + MIN_EVICTABLE_BYTES + RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS
  await setContextLimit(hooks, SESSION_ID, contextForWatermarkTokens(tokensForChars(postFenceChars) + HEADROOM_TOKENS))

  const bundle: StrictBundle = {
    messages: [
      userTextMessageFor(SESSION_ID, USER_ROLE, text),
      syntheticMessageFor(SESSION_ID, [pathToolPart(COMPOSED_COLD_PATH, MIN_EVICTABLE_BYTES)]),
      ...fillerMessages().map((parts) => syntheticMessageFor(SESSION_ID, parts)),
    ],
  }
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), `${FENCE_PROSE_BEFORE}\n${tombstone}\n${FENCE_PROSE_AFTER}`)
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).fenceEvicted, 1)
  assert.equal(countersOf(stats).evictions, 0)
  assert.deepEqual(stats.stash, { entries: 1, capacity: STASH_LIMIT })
})

test("transform replaces a fence block whose closer ends the part text without dropping the prose before it", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG))}\n`,
  )
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)
})

test("transform keeps an over threshold user fence inside the recent window untouched", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = windowFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, bundle.messages.length - 1), text)
})

test("transform keeps fenced blocks in non user messages untouched while userFenceEviction is enabled", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = roleFenceBundle(ASSISTANT_ROLE, text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
})

test("read_evicted keeps two same subject fence evictions in one part reloadable instead of overwriting the first stash", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const blockA = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const blockB = fenceBlockText(FENCE_LANGUAGE_JS, fenceContentLines(FENCE_OVER_LINES + 1, FENCE_LINE_TAG))
  await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${blockA}\n${FENCE_PROSE_MIDDLE}\n${blockB}\n${FENCE_PROSE_AFTER}`))

  assert.equal(
    await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID),
    `${blockB}\n\n${olderMatchesLineFor(fenceFirstLineOf(FENCE_LINE_TAG), [pointerFor(FENCE_STASH_TOOL_LABEL, 0)])}`,
  )
})

test("lru_stats counts fence evictions in a distinct fenceEvicted counter without counting tool evictions", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`))

  const stats = await lruStats(hooks, SESSION_ID)
  assert.deepEqual(countersOf(stats), {
    ...STATS_ZEROED_COUNTERS,
    fenceEvicted: 1,
    bytesReclaimed: block.length + FENCE_TRAILING_NEWLINE_CHARS,
    evictionTokensSaved: tokensForChars(block.length + FENCE_TRAILING_NEWLINE_CHARS),
  })
  assert.deepEqual(stats.options.userFenceEviction, { enabled: true, minBlockLines: FENCE_DEFAULT_MIN_BLOCK_LINES })
  assert.deepEqual(stats.stash, { entries: 1, capacity: STASH_LIMIT })
})

test("metrics log records a fence only run as eventful with the fenceEvictedThisRun counter", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWith({
      metricsLog: true,
      metricsPath: metricsLogPathIn(metricsDir),
      userFenceEviction: { enabled: true },
    })
    const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
    await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`))

    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].fenceEvictedThisRun, 1)
    assert.deepEqual(lines[0].totals, {
      ...STATS_ZEROED_COUNTERS,
      fenceEvicted: 1,
      bytesReclaimed: block.length + FENCE_TRAILING_NEWLINE_CHARS,
      evictionTokensSaved: tokensForChars(block.length + FENCE_TRAILING_NEWLINE_CHARS),
    })
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("transform renders only the first word of the fence info string as the language tag in the tombstone", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_INFO_STRING_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG))}\n${FENCE_PROSE_AFTER}`,
  )
})

test("transform never opens a fence span on a four space indented fence line", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = `${FENCE_INDENT_FOUR_SPACES}${FENCE_TICKS}${FENCE_LANGUAGE_TS}\n${fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG).join("\n")}\n${FENCE_INDENT_FOUR_SPACES}${FENCE_TICKS}`
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG)))
})

test("transform never closes a fence span on a four space indented fence line", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const contentLines = fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG)
  contentLines.push(`${FENCE_INDENT_FOUR_SPACES}${FENCE_TICKS}`)
  const text = `${FENCE_PROSE_BEFORE}\n${FENCE_TICKS}${FENCE_LANGUAGE_TS}\n${contentLines.join("\n")}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG)))
})

test("transform evicts a four backtick fence holding three backtick lines as content", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const contentLines = fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG)
  contentLines[FENCE_INNER_TICK_LINE_INDEX] = FENCE_TICKS
  const block = `${FENCE_FOUR_TICKS}${FENCE_LANGUAGE_TS}\n${contentLines.join("\n")}\n${FENCE_FOUR_TICKS}`
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG))}\n${FENCE_PROSE_AFTER}`,
  )
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)
})

test("transform evicts a fence indented up to three spaces and stashes its exact indented text", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = `${FENCE_INDENT_THREE_SPACES}${FENCE_TICKS}${FENCE_LANGUAGE_TS}\n${fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG).join("\n")}\n${FENCE_INDENT_TWO_SPACES}${FENCE_TICKS}`
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG))}\n${FENCE_PROSE_AFTER}`,
  )
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)
})

test("transform keeps the user message sitting exactly at hotFromIndex untouched while userFenceEviction is enabled", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true }, recentWindow: RECENT_WINDOW_MESSAGES })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle: StrictBundle = {
    messages: [
      ...fillerMessages(1).map((parts) => syntheticMessageFor(SESSION_ID, parts)),
      userTextMessageFor(SESSION_ID, USER_ROLE, text),
      ...fillerMessages(RECENT_WINDOW_MESSAGES - 1).map((parts) => syntheticMessageFor(SESSION_ID, parts)),
    ],
  }
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 1), text)
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG)))
})

const MANUAL_MODE_INVALID_VALUE = "yes"
const MANUAL_FALSE_PIN_SUBJECT = "/data/manual-false-pin.txt"
const MANUAL_PRESSURE_SUBJECT = "/data/manual-pressure.txt"
const MANUAL_DEFAULT_BUDGET_SUBJECT = "/data/manual-default-budget.txt"
const MANUAL_OVERRIDE_BUDGET_SUBJECT = "/data/manual-override-budget.txt"
const MANUAL_CAPTURED_LIMIT_SUBJECT = "/data/manual-captured-limit.txt"
const MANUAL_HINT_SUBJECT = "/data/manual-hint.txt"
const MANUAL_STATS_SUBJECT = "/data/manual-stats.txt"
const MANUAL_INVALID_SUBJECT = "/data/manual-invalid.txt"
const MANUAL_REASONING_TEXT = "stale manual-mode reasoning"

test("transform keeps every output untouched under eviction pressure while manualMode is enabled", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_PRESSURE_SUBJECT)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform keeps an explicit defaultContextTokens from driving eviction while manualMode is enabled", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true, defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_DEFAULT_BUDGET_SUBJECT)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform keeps a per model override budget from driving eviction while manualMode is enabled", async () => {
  const hooks = await loadPluginHooksWith({
    manualMode: true,
    modelContextTokens: { [OVERRIDE_MODEL_KEY]: SMALL_CONTEXT_LIMIT },
  })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, undefined)

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_OVERRIDE_BUDGET_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(stats.modelContextTokens, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
})

test("transform under manualMode with an unknown budget is byte-identical to the unknown-budget stand-down", async () => {
  const manualHooks = await loadPluginHooksWith({ manualMode: true })
  const standDownHooks = await loadPluginHooks()

  const manualBundle = buildFallbackBudgetBundle(LEGACY_FALLBACK_BUNDLE_OVER_WATERMARK_CHARS)
  const standDownBundle = buildFallbackBudgetBundle(LEGACY_FALLBACK_BUNDLE_OVER_WATERMARK_CHARS)
  await runTransform(manualHooks, manualBundle)
  await runTransform(standDownHooks, standDownBundle)

  assert.deepEqual(manualBundle, standDownBundle)
})

test("transform under manualMode with a captured limit is byte-identical to the unknown-budget stand-down", async () => {
  const manualHooks = await loadPluginHooksWith({ manualMode: true })
  await setContextLimit(manualHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  const standDownHooks = await loadPluginHooks()

  const manualBundle = buildStandardBundle(SESSION_ID, MANUAL_CAPTURED_LIMIT_SUBJECT)
  const standDownBundle = buildStandardBundle(SESSION_ID, MANUAL_CAPTURED_LIMIT_SUBJECT)
  await runTransform(manualHooks, manualBundle)
  await runTransform(standDownHooks, standDownBundle)

  assert.deepEqual(manualBundle, standDownBundle)
})

test("transform behaves byte-identically with manualMode false configured and with it unset", async () => {
  const explicitHooks = await loadPluginHooksWith({ manualMode: false })
  const defaultHooks = await loadPluginHooks()
  await setContextLimit(explicitHooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setContextLimit(defaultHooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const explicitBundle = buildStandardBundle(SESSION_ID, MANUAL_FALSE_PIN_SUBJECT)
  const defaultBundle = buildStandardBundle(SESSION_ID, MANUAL_FALSE_PIN_SUBJECT)
  await runTransform(explicitHooks, explicitBundle)
  await runTransform(defaultHooks, defaultBundle)

  assert.deepEqual(explicitBundle, defaultBundle)
  assert.ok(toolPartAt(defaultBundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform keeps dedup active under pressure while manualMode is enabled", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, dedupTombstoneFor(READ_TOOL, 1))
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.ok(!toolPartAt(bundle.messages[1], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform keeps the errored-input purge active under pressure while manualMode is enabled", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])
  await runTransform(hooks, bundle)

  assert.equal(inputAt(bundle.messages[0]), PURGE_MARKER)
})

test("transform keeps reasoning expiry active under pressure while manualMode is enabled", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [reasoningPart(MANUAL_REASONING_TEXT), textPart(MANUAL_REASONING_TEXT)],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[0].parts, [textPart(MANUAL_REASONING_TEXT)])
})

test("chat system transform delivers a hint under pressure while manualMode is enabled", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_HINT_SUBJECT)
  await runTransform(hooks, bundle)

  assert.deepEqual(hintBlocksIn(await runSystemTransform(hooks, SESSION_ID)), [hintLineFor([MANUAL_HINT_SUBJECT])])
})

test("transform keeps fence eviction the stash and read_evicted active while manualMode is enabled", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true, userFenceEviction: { enabled: true } })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const bundle = userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG))}\n${FENCE_PROSE_AFTER}`,
  )
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)
})

test("lru_stats reports the manual state in the options block while the captured budget stays visible", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_STATS_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await lruStats(hooks, SESSION_ID)
  assert.equal(stats.options.manualMode, true)
  assert.equal(stats.modelContextTokens, WATERMARK_PROBE_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: null,
    deficitTokens: null,
  })
})

test("transform still evicts under pressure when manualMode is invalid and falls back to false", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: MANUAL_MODE_INVALID_VALUE })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_INVALID_SUBJECT)
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

const STASH_LIMIT_OVERRIDE = 2
const STASH_LIMIT_OVERFLOW_COUNT = 3
const STASH_LIMIT_INVALID_VALUES = [-1, Infinity, Number.NaN, "2"]
const SESSION_BOUND_OVERRIDE = 2
const SESSION_BOUND_INVALID_ZERO = 0
const BOUND_TEST_SESSION_C = "lru-bound-session-c"
const REMEMBERED_SUBJECTS_OVERRIDE = 1
const REMEMBERED_SUBJECTS_INVALID = -1
const REMEMBERED_FIRST_SUBJECT = "/data/remembered-first.txt"
const REMEMBERED_SECOND_SUBJECT = "/data/remembered-second.txt"
const CHARS_PER_TOKEN_OVERRIDE = 8
const CHARS_PER_TOKEN_INVALID_VALUES = [0, -1, Infinity, Number.NaN]
const CHARS_TOKEN_BOUND_CONTEXT_LIMIT = 1000
const SUBSTRING_FLOOR_OVERRIDE = 100
const SUBSTRING_FLOOR_ZERO = 0
const SUBSTRING_FLOOR_INVALID = -1
const STASH_LIMIT_OVERRIDE_SUBJECT_PREFIX = "/data/slim-stash"

test("lru_stats reports the default stash capacity of fifty entries when stashLimit is unset", async () => {
  const stats = await lruStats(await loadPluginHooks(), SESSION_ID)

  assert.deepEqual(stats.stash, { entries: 0, capacity: STASH_LIMIT })
})

test("read_evicted applies a custom stashLimit dropping the oldest stashed entry past the bound", async () => {
  const hooks = await loadPluginHooksWith({ stashLimit: STASH_LIMIT_OVERRIDE })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const subjects = Array.from({ length: STASH_LIMIT_OVERFLOW_COUNT }, (_, index) => `${STASH_LIMIT_OVERRIDE_SUBJECT_PREFIX}${index}.txt`)
  const bundle = buildBundle([
    ...subjects.map((subject) => [pathToolPart(subject, MIN_EVICTABLE_BYTES)]),
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual((await lruStats(hooks, SESSION_ID)).stash, {
    entries: STASH_LIMIT_OVERRIDE,
    capacity: STASH_LIMIT_OVERRIDE,
  })
  assert.equal(await readEvicted(hooks, subjects[0], SESSION_ID), stashMissFor(subjects[0]))
  assert.equal(await readEvicted(hooks, subjects[1], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await readEvicted(hooks, subjects[2], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("lru_stats keeps the default stash capacity when stashLimit is invalid", async () => {
  for (const invalidLimit of STASH_LIMIT_INVALID_VALUES) {
    const hooks = await loadPluginHooksWith({ stashLimit: invalidLimit })
    const stats = await lruStats(hooks, SESSION_ID)

    assert.deepEqual(stats.stash, { entries: 0, capacity: STASH_LIMIT })
  }
})

test("read_evicted drops the least recently active session stash when the stashSessions bound is exceeded", async () => {
  const hooks = await loadPluginHooksWith({ stashSessions: SESSION_BOUND_OVERRIDE })
  for (let index = 0; index < SESSION_BOUND_OVERRIDE; index += 1) await evictStashSession(hooks, index)

  await evictStashSession(hooks, SESSION_BOUND_OVERRIDE)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0)),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(1), stashSessionId(1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(SESSION_BOUND_OVERRIDE), stashSessionId(SESSION_BOUND_OVERRIDE)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("read_evicted keeps early session stashes when an invalid stashSessions falls back to the default bound", async () => {
  const hooks = await loadPluginHooksWith({ stashSessions: SESSION_BOUND_INVALID_ZERO })
  for (let index = 0; index < STASH_SESSION_OVERFLOW_COUNT; index += 1) await evictStashSession(hooks, index)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0)),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(1), stashSessionId(1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await readEvicted(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("chat params drops the oldest captured limit when the limitSessions bound is exceeded", async () => {
  const hooks = await loadPluginHooksWith({ limitSessions: SESSION_BOUND_OVERRIDE })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setContextLimit(hooks, SESSION_ID_B, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setContextLimit(hooks, BOUND_TEST_SESSION_C, WATERMARK_PROBE_CONTEXT_LIMIT)

  const dropped = buildStandardBundle(SESSION_ID, "/data/limit-bound-dropped.txt")
  await runTransform(hooks, dropped)
  assert.equal(toolPartAt(dropped.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))

  const retained = buildStandardBundle(SESSION_ID_B, "/data/limit-bound-retained.txt")
  await runTransform(hooks, retained)
  assert.ok(toolPartAt(retained.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("chat params keeps captured limits when an invalid limitSessions falls back to the default bound", async () => {
  const hooks = await loadPluginHooksWith({ limitSessions: SESSION_BOUND_INVALID_ZERO })
  for (let index = 0; index < LIMIT_SESSION_OVERFLOW_COUNT; index += 1) {
    await setContextLimit(hooks, limitSessionId(index), WATERMARK_PROBE_CONTEXT_LIMIT)
  }

  const dropped = buildStandardBundle(limitSessionId(0), "/data/limit-invalid-dropped.txt")
  await runTransform(hooks, dropped)
  assert.equal(toolPartAt(dropped.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))

  const retained = buildStandardBundle(limitSessionId(1), "/data/limit-invalid-retained.txt")
  await runTransform(hooks, retained)
  assert.ok(toolPartAt(retained.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("chat system transform drops the least recently active session hint when the hintSessions bound is exceeded", async () => {
  const hooks = await loadPluginHooksWith({ hintSessions: SESSION_BOUND_OVERRIDE })
  for (let index = 0; index < SESSION_BOUND_OVERRIDE; index += 1) await storeHintSession(hooks, index)

  await storeHintSession(hooks, SESSION_BOUND_OVERRIDE)

  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(0))).length, 0)
  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(1))).length, 1)
  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(SESSION_BOUND_OVERRIDE))).length, 1)
})

test("chat system transform keeps session hints when an invalid hintSessions falls back to the default bound", async () => {
  const hooks = await loadPluginHooksWith({ hintSessions: SESSION_BOUND_INVALID_ZERO })
  for (let index = 0; index < HINT_SESSION_OVERFLOW_COUNT; index += 1) await storeHintSession(hooks, index)

  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(0))).length, 0)
  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(1))).length, 1)
  assert.equal(hintBlocksIn(await runSystemTransform(hooks, hintSessionId(HINT_SESSION_OVERFLOW_COUNT - 1))).length, 1)
})

test("lru_stats drops the least recently active session metrics when the metricsSessions bound is exceeded", async () => {
  const hooks = await loadPluginHooksWith({ metricsSessions: SESSION_BOUND_OVERRIDE })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setContextLimit(hooks, SESSION_ID_B, WATERMARK_PROBE_CONTEXT_LIMIT)

  await runTransform(hooks, buildStandardBundle(SESSION_ID, "/data/metrics-bound-a.txt"))
  await runTransform(hooks, buildStandardBundle(SESSION_ID_B, "/data/metrics-bound-b.txt"))
  await runTransform(hooks, buildStandardBundle(BOUND_TEST_SESSION_C, "/data/metrics-bound-c.txt"))

  assert.equal(countersOf(await lruStats(hooks, SESSION_ID_B)).evictions, 1)
  assert.deepEqual(countersOf(await lruStats(hooks, SESSION_ID)), STATS_ZEROED_COUNTERS)
})

test("lru_stats keeps session metrics when an invalid metricsSessions falls back to the default bound", async () => {
  const hooks = await loadPluginHooksWith({ metricsSessions: SESSION_BOUND_INVALID_ZERO })
  for (let index = 0; index < METRICS_SESSION_OVERFLOW_COUNT; index += 1) await storeMetricsSession(hooks, index)

  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(0))).evictions, 0)
  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(1))).evictions, 1)
  assert.equal(countersOf(await lruStats(hooks, metricsSessionId(METRICS_SESSION_OVERFLOW_COUNT - 1))).evictions, 1)
})

const rememberedSubjectsTouchCountFor = async (optionValue: number): Promise<number> => {
  const hooks = await loadPluginHooksWith({ rememberedEvictedSubjects: optionValue })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([[pathToolPart(REMEMBERED_FIRST_SUBJECT, MIN_EVICTABLE_BYTES)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart(REMEMBERED_SECOND_SUBJECT, MIN_EVICTABLE_BYTES)]))
  fillerMessages().forEach((parts) => bundle.messages.push(syntheticMessageFor(SESSION_ID, parts)))
  await runTransform(hooks, bundle)

  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart(REMEMBERED_FIRST_SUBJECT, APPEARANCE_ONLY_OUTPUT_BYTES)]))
  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart(REMEMBERED_SECOND_SUBJECT, APPEARANCE_ONLY_OUTPUT_BYTES)]))
  await runTransform(hooks, bundle)

  return countersOf(await lruStats(hooks, SESSION_ID)).postEvictionTouches
}

test("lru_stats forgets the oldest evicted subject at the rememberedEvictedSubjects bound so its touch goes uncounted", async () => {
  assert.equal(await rememberedSubjectsTouchCountFor(REMEMBERED_SUBJECTS_OVERRIDE), 1)
})

test("lru_stats keeps both evicted subjects remembered when rememberedEvictedSubjects is invalid", async () => {
  assert.equal(await rememberedSubjectsTouchCountFor(REMEMBERED_SUBJECTS_INVALID), 2)
})

test("transform applies a custom charsPerToken so the coarser estimate sits under a limit that evicts by default", async () => {
  const defaultHooks = await loadPluginHooks()
  const coarseHooks = await loadPluginHooksWith({ charsPerToken: CHARS_PER_TOKEN_OVERRIDE })
  await setContextLimit(defaultHooks, SESSION_ID, CHARS_TOKEN_BOUND_CONTEXT_LIMIT)
  await setContextLimit(coarseHooks, SESSION_ID, CHARS_TOKEN_BOUND_CONTEXT_LIMIT)

  const defaultBundle = buildStandardBundle(SESSION_ID, "/data/estimate-default.txt")
  const coarseBundle = buildStandardBundle(SESSION_ID, "/data/estimate-coarse.txt")
  await runTransform(defaultHooks, defaultBundle)
  await runTransform(coarseHooks, coarseBundle)

  assert.ok(toolPartAt(defaultBundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(coarseBundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform falls back to the default charsPerToken when the option is invalid", async () => {
  for (const invalidCharsPerToken of CHARS_PER_TOKEN_INVALID_VALUES) {
    const hooks = await loadPluginHooksWith({ charsPerToken: invalidCharsPerToken })
    await setContextLimit(hooks, SESSION_ID, CHARS_TOKEN_BOUND_CONTEXT_LIMIT)

    const bundle = buildStandardBundle(SESSION_ID, "/data/estimate-invalid.txt")
    await runTransform(hooks, bundle)

    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  }
})

test("transform blocks a bash substring refresh when minSubstringMatchChars exceeds the subject length", async () => {
  const hooks = await loadPluginHooksWith({ minSubstringMatchChars: SUBSTRING_FLOOR_OVERRIDE })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [bashToolPart(SUBSTRING_ENTRY_COMMAND, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [bashToolPart(SUBSTRING_APPEARANCE_COMMAND, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(1),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("transform refreshes a three character bash entry via substring when minSubstringMatchChars is zero", async () => {
  const hooks = await loadPluginHooksWith({ minSubstringMatchChars: SUBSTRING_FLOOR_ZERO })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [bashToolPart(SHORT_SUBSTRING_ENTRY_COMMAND, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [bashToolPart(SHORT_SUBSTRING_APPEARANCE_COMMAND, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(1),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform keeps the default substring floor when minSubstringMatchChars is invalid", async () => {
  const hooks = await loadPluginHooksWith({ minSubstringMatchChars: SUBSTRING_FLOOR_INVALID })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [bashToolPart(SHORT_SUBSTRING_ENTRY_COMMAND, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [bashToolPart(SHORT_SUBSTRING_APPEARANCE_COMMAND, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(1),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

const REHYDRA_FRESH_SESSION = "lru-rehydrate-fresh-session"
const REHYDRA_SECOND_SESSION = "lru-rehydrate-second-session"
const REHYDRA_EVICTION_SUBJECT_A = "/data/rehydrate-eviction-a.txt"
const REHYDRA_EVICTION_SUBJECT_B = "/data/rehydrate-eviction-b.txt"
const REHYDRA_MISS_SUBJECT = "/data/rehydrate-miss.txt"
const REHYDRA_DEDUP_PATH = "/data/rehydrate-dedup.txt"
const REHYDRA_FENCE_TAG = "rehydrate"
const REHYDRA_FENCE_BLOCK = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, REHYDRA_FENCE_TAG))
const REHYDRA_FENCE_BYTES = REHYDRA_FENCE_BLOCK.length + FENCE_TRAILING_NEWLINE_CHARS
const REHYDRA_REASONING_TEXT = "rehydrated cold reasoning block"
const REHYDRA_PROBE_TEXT_CHARS = 60
const REHYDRA_DEDUP_POST_CHARS =
  dedupTombstoneFor(READ_TOOL, 1).length + THREE_ENTRY_OUTPUT_BYTES + 2 * FILLER_TEXT_CHARS
const REHYDRA_LINES_FROM_SECOND_SITTING = 5
const REHYDRA_STALE_RECORD_EVICTIONS = 10
const REHYDRA_NEWER_RECORD_EVICTIONS = 20
const REHYDRA_EARLIER_TS = "2026-09-17T00:00:00.000Z"
const REHYDRA_LATER_TS = "2026-09-17T00:05:00.000Z"

const loadPluginHooksWithPersistence = async (metricsPath: string, stateDir: string, extra: Record<string, unknown> = {}): Promise<HookMap> =>
  loadPluginHooksWithLiveState(stateDir, { metricsLog: true, metricsPath, ...extra })

const runEvictionTransform = async (hooks: HookMap, sessionID: string, path: string): Promise<void> => {
  await setContextLimit(hooks, sessionID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(sessionID, path))
}

const runDedupTransform = async (hooks: HookMap, sessionID: string): Promise<void> => {
  await setContextLimit(hooks, sessionID, contextForWatermarkTokens(tokensForChars(REHYDRA_DEDUP_POST_CHARS) + HEADROOM_TOKENS))
  await runTransform(
    hooks,
    buildBundle([
      [pathToolPart(REHYDRA_DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
      ...fillerMessages(2),
      [pathToolPart(REHYDRA_DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
      ...fillerMessages(2),
    ]),
  )
}

const runReasoningTransform = async (hooks: HookMap, sessionID: string): Promise<void> => {
  await setContextLimit(hooks, sessionID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await runTransform(
    hooks,
    buildBundle([
      [reasoningPart(REHYDRA_REASONING_TEXT), pathToolPart("/data/rehydrate-reasoning.txt", APPEARANCE_ONLY_OUTPUT_BYTES)],
      ...fillerMessages(),
    ]),
  )
}

const runFenceTransform = async (hooks: HookMap): Promise<void> => {
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${REHYDRA_FENCE_BLOCK}\n${FENCE_PROSE_AFTER}`))
}

const runQuietProbeTransform = async (hooks: HookMap, sessionID: string): Promise<void> =>
  runTransform(hooks, buildBundle([[textPart(textOfChars(REHYDRA_PROBE_TEXT_CHARS))], ...fillerMessages(2)], sessionID))

const metricsLinesForSession = (metricsPath: string, sessionID: string): Record<string, unknown>[] =>
  metricsLinesIn(metricsPath).filter((line) => line.session === sessionID)

const rehydrateSeedLine = (session: string, ts: string, evictions: number): Record<string, unknown> => ({
  ts,
  session,
  modelContextTokens: null,
  modelContextTokensSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
  estimatedTokens: 0,
  watermarkTokens: null,
  deficitTokens: null,
  evictedThisRun: [],
  dedupedThisRun: 0,
  reasoningExpiredThisRun: 0,
  reasoningBytesExpiredThisRun: 0,
  fenceEvictedThisRun: 0,
  postEvictionTouchesThisRun: 0,
  stashReadsSinceLastLine: 0,
  totals: { ...STATS_ZEROED_COUNTERS, evictions },
})

const rehydrateSeedSnapshot = (session: string, ts: string, evictions: number): string =>
  `${JSON.stringify({
    ts,
    session,
    manualMode: false,
    modelContextTokens: null,
    modelContextTokensSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
    lastRun: { estimatedTokens: 0, watermarkTokens: null, deficitTokens: null },
    totals: { ...STATS_ZEROED_COUNTERS, evictions },
    stash: { entries: 0, capacity: STASH_LIMIT },
    hotSubjects: [],
  })}\n`

const withCounterDeltas = (baseline: Record<string, number>, deltas: Record<string, number>): Record<string, number> => {
  const expected = { ...baseline }
  for (const [key, delta] of Object.entries(deltas)) expected[key] = (expected[key] ?? 0) + delta
  expected.evictionTokensSaved = tokensForChars(expected.bytesReclaimed)
  expected.dedupTokensSaved = tokensForChars(expected.dedupedBytes)
  return expected
}

const SECOND_SITTING_COUNTER_DELTAS = {
  evictions: 1,
  bytesReclaimed: MIN_EVICTABLE_BYTES + REHYDRA_FENCE_BYTES,
  stashHits: 1,
  stashMisses: 1,
  deduped: 1,
  dedupedBytes: THREE_ENTRY_OUTPUT_BYTES,
  reasoningExpired: 1,
  reasoningBytesExpired: REHYDRA_REASONING_TEXT.length,
  fenceEvicted: 1,
}

const runFirstSitting = async (hooks: HookMap): Promise<void> => {
  await runEvictionTransform(hooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)
  assert.equal(await readEvicted(hooks, REHYDRA_EVICTION_SUBJECT_A, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await readEvicted(hooks, REHYDRA_MISS_SUBJECT, SESSION_ID), stashMissFor(REHYDRA_MISS_SUBJECT))
  await runQuietProbeTransform(hooks, SESSION_ID)
  await runDedupTransform(hooks, SESSION_ID)
  await runReasoningTransform(hooks, SESSION_ID)
  await runFenceTransform(hooks)
}

const runSecondSitting = async (hooks: HookMap): Promise<void> => {
  await runEvictionTransform(hooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_B)
  assert.equal(await readEvicted(hooks, REHYDRA_EVICTION_SUBJECT_B, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  await runDedupTransform(hooks, SESSION_ID)
  await runReasoningTransform(hooks, SESSION_ID)
  await runFenceTransform(hooks)
  assert.equal(await readEvicted(hooks, REHYDRA_MISS_SUBJECT, SESSION_ID), stashMissFor(REHYDRA_MISS_SUBJECT))
  await runQuietProbeTransform(hooks, SESSION_ID)
}

test("resumed session continues its lifetime counters across a restart in the metrics log and the live snapshot", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, { userFenceEviction: { enabled: true } })
    await runFirstSitting(firstSittingHooks)
    const baseline = snapshotBodyOf(stateDir, SESSION_ID).snapshot.totals as Record<string, number>
    const lineCountAfterFirstSitting = metricsLinesForSession(metricsPath, SESSION_ID).length

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, { userFenceEviction: { enabled: true } })
    await runSecondSitting(secondSittingHooks)

    const expected = withCounterDeltas(baseline, SECOND_SITTING_COUNTER_DELTAS)
    assert.deepEqual(snapshotBodyOf(stateDir, SESSION_ID).snapshot.totals, expected)
    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, lineCountAfterFirstSitting + REHYDRA_LINES_FROM_SECOND_SITTING)
    assert.deepEqual(lines[lines.length - 1].totals, expected)
    assert.equal(lines[lines.length - 1].stashReadsSinceLastLine, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a session without persisted records starts at zeroed counters in a fresh process", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runFirstSitting(firstSittingHooks)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    assert.deepEqual(countersOf(await lruStats(secondSittingHooks, REHYDRA_FRESH_SESSION)), STATS_ZEROED_COUNTERS)
    await runQuietProbeTransform(secondSittingHooks, REHYDRA_FRESH_SESSION)
    assert.deepEqual(countersOf(await lruStats(secondSittingHooks, REHYDRA_FRESH_SESSION)), STATS_ZEROED_COUNTERS)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("resumed session falls back to the metrics log tail when its snapshot is missing", async () => {
  const metricsDir = makeMetricsDir()
  const firstSittingStateDir = makeLiveStateDir()
  const emptyStateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithLiveState(firstSittingStateDir, { metricsLog: true, metricsPath })
    await runEvictionTransform(firstSittingHooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)
    const baseline = metricsLinesForSession(metricsPath, SESSION_ID)[0].totals as Record<string, number>

    const secondSittingHooks = await loadPluginHooksWithLiveState(emptyStateDir, { metricsLog: true, metricsPath })
    await runEvictionTransform(secondSittingHooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_B)

    const expected = withCounterDeltas(baseline, { evictions: 1, bytesReclaimed: MIN_EVICTABLE_BYTES })
    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.deepEqual(lines[lines.length - 1].totals, expected)
    assert.deepEqual(snapshotBodyOf(emptyStateDir, SESSION_ID).snapshot.totals, expected)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(firstSittingStateDir)
    cleanupMetricsDir(emptyStateDir)
  }
})

test("resumed session with neither snapshot nor metrics log seeds zeroed counters", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithPersistence(metricsLogPathIn(metricsDir), stateDir)
    await runEvictionTransform(hooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)

    const lines = metricsLinesForSession(metricsLogPathIn(metricsDir), SESSION_ID)
    assert.deepEqual(lines[0].totals, {
      ...STATS_ZEROED_COUNTERS,
      evictions: 1,
      bytesReclaimed: MIN_EVICTABLE_BYTES,
      evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    })
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a quiet post restart run writes no metrics line because seeded stash reads are logged through", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runEvictionTransform(firstSittingHooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)
    assert.equal(await readEvicted(firstSittingHooks, REHYDRA_EVICTION_SUBJECT_A, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
    assert.equal(await readEvicted(firstSittingHooks, REHYDRA_MISS_SUBJECT, SESSION_ID), stashMissFor(REHYDRA_MISS_SUBJECT))
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)
    const lineCountAfterFirstSitting = metricsLinesForSession(metricsPath, SESSION_ID).length

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runQuietProbeTransform(secondSittingHooks, SESSION_ID)

    assert.equal(metricsLinesForSession(metricsPath, SESSION_ID).length, lineCountAfterFirstSitting)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("resumed session seeds from the newer of the metrics log and the snapshot whichever is fresher", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    writeFileSync(
      metricsPath,
      `${JSON.stringify(rehydrateSeedLine(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS))}\n` +
        `${JSON.stringify(rehydrateSeedLine(REHYDRA_SECOND_SESSION, REHYDRA_EARLIER_TS, REHYDRA_STALE_RECORD_EVICTIONS))}\n`,
    )
    writeFileSync(liveStatePathIn(stateDir, SESSION_ID), rehydrateSeedSnapshot(SESSION_ID, REHYDRA_EARLIER_TS, REHYDRA_STALE_RECORD_EVICTIONS))
    writeFileSync(liveStatePathIn(stateDir, REHYDRA_SECOND_SESSION), rehydrateSeedSnapshot(REHYDRA_SECOND_SESSION, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS))

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runQuietProbeTransform(hooks, SESSION_ID)
    await runQuietProbeTransform(hooks, REHYDRA_SECOND_SESSION)

    assert.equal(countersOf(await lruStats(hooks, SESSION_ID)).evictions, REHYDRA_NEWER_RECORD_EVICTIONS)
    assert.equal(countersOf(await lruStats(hooks, REHYDRA_SECOND_SESSION)).evictions, REHYDRA_NEWER_RECORD_EVICTIONS)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("recreated metrics entry re-seeds lifetime counters after the metricsSessions bound evicted it", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runEvictionTransform(firstSittingHooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, { metricsSessions: 1 })
    await runEvictionTransform(secondSittingHooks, REHYDRA_SECOND_SESSION, REHYDRA_EVICTION_SUBJECT_A)
    await runEvictionTransform(secondSittingHooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_B)
    // The interleaving evicts SESSION_ID's entry again, this time after its
    // first-touch hydration has settled: the re-created entry must seed from
    // a fresh disk read carrying this sitting's own newest record.
    await runEvictionTransform(secondSittingHooks, REHYDRA_SECOND_SESSION, "/data/rehydrate-eviction-c.txt")
    await runEvictionTransform(secondSittingHooks, SESSION_ID, "/data/rehydrate-eviction-d.txt")

    const counters = countersOf(await lruStats(secondSittingHooks, SESSION_ID))
    assert.equal(counters.evictions, 3)
    assert.equal(counters.bytesReclaimed, 3 * MIN_EVICTABLE_BYTES)
    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal((lines[lines.length - 1].totals as Record<string, number>).evictions, 3)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a stash miss issued while the session's first hydration is in flight counts against the seeded entry", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runEvictionTransform(firstSittingHooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)
    assert.equal(await readEvicted(firstSittingHooks, REHYDRA_MISS_SUBJECT, SESSION_ID), stashMissFor(REHYDRA_MISS_SUBJECT))
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setContextLimit(secondSittingHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
    const resumeTransform = runTransform(secondSittingHooks, buildStandardBundle(SESSION_ID, REHYDRA_EVICTION_SUBJECT_B))
    assert.equal(await readEvicted(secondSittingHooks, REHYDRA_MISS_SUBJECT, SESSION_ID), stashMissFor(REHYDRA_MISS_SUBJECT))
    await resumeTransform

    assert.equal(countersOf(await lruStats(secondSittingHooks, SESSION_ID)).stashMisses, 2)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a newest metrics line whose totals carry a non finite named counter is rejected in favor of the previous record", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    writeFileSync(
      metricsPath,
      `${JSON.stringify(rehydrateSeedLine(SESSION_ID, REHYDRA_EARLIER_TS, REHYDRA_STALE_RECORD_EVICTIONS))}\n` +
        `${JSON.stringify({ ...rehydrateSeedLine(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS), totals: { ...STATS_ZEROED_COUNTERS, evictions: null } })}\n`,
    )

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runQuietProbeTransform(hooks, SESSION_ID)

    assert.equal(countersOf(await lruStats(hooks, SESSION_ID)).evictions, REHYDRA_STALE_RECORD_EVICTIONS)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a metrics line predating dedupedBytes still seeds the resumed session with zero for it", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const legacyTotals: Record<string, unknown> = { ...STATS_ZEROED_COUNTERS, evictions: REHYDRA_NEWER_RECORD_EVICTIONS }
    delete legacyTotals.dedupedBytes
    writeFileSync(
      metricsPath,
      `${JSON.stringify({ ...rehydrateSeedLine(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS), totals: legacyTotals })}\n`,
    )

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runQuietProbeTransform(hooks, SESSION_ID)

    const counters = countersOf(await lruStats(hooks, SESSION_ID))
    assert.equal(counters.evictions, REHYDRA_NEWER_RECORD_EVICTIONS)
    assert.equal(counters.dedupedBytes, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})
