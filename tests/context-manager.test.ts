import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import contextManagerEntry, {
  DEFAULT_INGESTION_HYGIENE_ROTATION_MAX_BYTES,
  DEFAULT_METRICS_ROTATION_MAX_BYTES,
  DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES,
  METRIC_NUMBER_KEYS,
  METRICS_CURSOR_KEYS,
  RAW_COUNTER_KEYS,
} from "../plugin/context-manager.ts"
import { loadPanelData, PANEL_COMMAND_CATEGORY, PANEL_COMMAND_NAME, PANEL_COMMAND_NAMESPACE, PANEL_COMMAND_SLASH_NAME } from "../plugin/panel-data.ts"
import { PLUGIN_ID, TOTALS_KEYS } from "../plugin/schema.ts"

const contextManagerFactory = contextManagerEntry.server

const TRANSFORM_HOOK = "experimental.chat.messages.transform"
const CHAT_PARAMS_HOOK = "chat.params"
const SESSION_ID = "ctx-harness-session"
const SESSION_ID_B = "ctx-harness-session-b"
const BASH_TOOL = "bash"
const READ_TOOL = "read"
const TOMBSTONE_MARKER = "[ctx-evicted]"
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
const REPEATED_STANDING_RUNS = 2
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
const COMPACTION_STASH_CANDIDATE_COUNT = 4
const COMPACTION_STASH_BUNDLE_CHARS =
  COMPACTION_STASH_CANDIDATE_COUNT * THREE_ENTRY_OUTPUT_BYTES + RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS
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
const HINT_MARKER = "[ctx-hot]"
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
const STASH_MARKER = "[ctx-stash]"
const STASH_OLDER_LEAD = "older matches for subject"
const STASH_MESSAGE_LABEL = "at message"
const STASH_MATCH_SEPARATOR = "; "
const STASH_MISS_LEAD = "no stashed output for subject"
const STASH_MISS_HINT = "only outputs evicted during this session are stashed"
const STASH_OCCUPANCY_LEAD = "stash holds"
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
const STASH_EMPTY_OCCUPANCY = `${STASH_MARKER} ${STASH_OCCUPANCY_LEAD} ${STASH_OCCUPANCY_EMPTY_TAIL}.`
const OCCUPANCY_MISS_SUBJECT = "/data/occupancy-miss.txt"
const OCCUPANCY_PATH_A = "/data/occupancy-a.txt"
const OCCUPANCY_PATH_B = "/data/occupancy-b.txt"
const OCCUPANCY_COMMAND_A = "echo occupancy-a"
const OCCUPANCY_COMMAND_B = "echo occupancy-b"
const OCCUPANCY_PATTERN_A = "occupancy/*.go"
const OCCUPANCY_PATTERN_B = "OccupancyProbe"
const OCCUPANCY_SLIM_STASH_LIMIT = 1
const OCCUPANCY_SLIM_PATH = "/data/occupancy-slim.txt"
const OCCUPANCY_ZERO_STASH_LIMIT = 0
const OCCUPANCY_DROPPED_PATH = "/data/occupancy-dropped.txt"
const OCCUPANCY_CAPPED_TOOL_COUNT = 3
const OCCUPANCY_CAPPED_PATHS = ["/data/capped-a.txt", "/data/capped-b.txt", "/data/capped-c.txt"]
const OCCUPANCY_CAPPED_COMMAND_PREFIX = "echo capped"
const OCCUPANCY_CAPPED_GLOB_PREFIX = "/data/capped-glob"
const OCCUPANCY_CAPPED_GREP_PREFIX = "CappedProbe"
const OCCUPANCY_CAPPED_SIXTH_TOOL = "webfetch"
const OCCUPANCY_CAPPED_SIXTH_PREFIX = "/data/capped-sixth"
const FENCE_MIXED_TAG = "mixed"
const STASH_INVALID_SUBJECT_LEAD = "requires a non-empty subject string"
const PAGE_STORE_RESTORED_LINE = `${STASH_MARKER} restored from the page store.`
const PAGE_STORE_OLDER_LEAD = "older pages for subject"
const PAGE_STORE_MISS_LEAD = "no prior-session page for subject"
const RECEIVED_LABEL = "received"
const UNKNOWN_TARGET_LABEL = "unknown target"
const STASH_LIMIT = 50
const STASH_OVERFLOW_COUNT = 51
const INVALID_SUBJECT_VALUE = 42
const STASH_ISOLATION_SUBJECT = "/data/shared-stash.txt"
const STASH_ISOLATION_SESSION_C = "ctx-harness-session-c"
const DEDUP_MARKER = "[ctx-deduped]"
const TOOL_ERROR_PREFIX = "[ctx-error] "
const FAULT_SUBJECT = "/data/fault-subject.txt"
const FAULT_ORDER_RELOADED_PATH = "/data/fault-order-reloaded.txt"
const FAULT_ORDER_SIBLING_PATH = "/data/fault-order-sibling.txt"
const FAULT_SCALE_DOUBLE_PATH = "/data/fault-scale-double.txt"
const FAULT_SCALE_SINGLE_PATH = "/data/fault-scale-single.txt"
const FAULT_WINDOW_RELOADED_PATH = "/data/fault-window-reloaded.txt"
const FAULT_WINDOW_SIBLING_PATH = "/data/fault-window-sibling.txt"
const FAULT_CREDIT_RELOADED_PATH = "/data/fault-credit-reloaded.txt"
const FAULT_CREDIT_SIBLING_PATH = "/data/fault-credit-sibling.txt"
const FAULT_CREDIT_UNFAULTED_PATH = "/data/fault-credit-unfaulted.txt"
const FAULT_CREDIT_SINGLE_HIT_PATH = "/data/fault-credit-single-hit.txt"
const FAULT_INVARIANCE_FIRST_PATH = "/data/fault-invariance-first.txt"
const FAULT_INVARIANCE_SECOND_PATH = "/data/fault-invariance-second.txt"
const FAULT_INVARIANCE_COMMAND_PREFIX = "cat "
const FAULT_RESTART_RELOADED_PATH = "/data/fault-restart-reloaded.txt"
const FAULT_RESTART_PEER_PATH = "/data/fault-restart-peer.txt"
const FAULT_MAP_OVERFLOW_COUNT = 257
const FAULT_MAP_CYCLE_SIZE = 50
const FAULT_MAP_SUBJECT_PREFIX = "/data/fault-bound-"
const FAULT_MAP_TRIMMED_INDEX = 0
const FAULT_MAP_REFRESH_TRIMMED_INDEX = 1
const FAULT_MAP_REFRESHED_INDEX = 250
const FAULT_MAP_DEFERRED_INDEX = 255
const FAULT_MAP_NEW_INDEX = 257
const FAULT_DRY_RUN_RELOADED_PATH = "/data/fault-dry-run-reloaded.txt"
const FAULT_DRY_RUN_WARM_PATH = "/data/fault-dry-run-warm.txt"
const HINT_RENDERED_SUBJECT = "/data/hint-rendered.txt"
const COMPACTION_BLOCK_MARKER = "[ctx]"
const STASH_NOTE_SUBJECTS_LEAD = "newest subjects"
const COMPACTION_SUBJECT_BOUND = 2
const COMPACTION_BOUND_SUBJECTS = ["/data/comp-bound-a.txt", "/data/comp-bound-b.txt", "/data/comp-bound-c.txt"]
const COMPACTION_FAULT_MESSAGE = "compaction enrichment exploded"
const COMPACTION_STASH_NEWEST_SUBJECT = "/data/comp-stash-newest.txt"
const COMPACTION_STASH_DUP_SUBJECT = "/data/comp-stash-dup.txt"
const COMPACTION_STASH_HELD_SUBJECT = "/data/comp-stash-held.txt"
const AGED_EVICTION_MESSAGES = 3
const AGED_THRESHOLD_ABOVE_WINDOW = 8
const AGED_MID_AGE_FILLER_COUNT = 6
const AGED_THRESHOLD_INVALID_FLOAT = 3.5
const AGED_THRESHOLD_INVALID_ZERO = 0
const AGED_THRESHOLD_INVALID_NEGATIVE = -1
const AGED_READ_PATH = "/data/aged-read.txt"
const AGED_RETOUCHED_PATH = "/data/aged-retouched.txt"
const AGED_PROTECTED_PATH = "/data/aged-protected.txt"
const AGED_PROTECTED_GLOB = "**/aged-protected.txt"
const AGED_RETOUCH_OFFSET = 100
const AGED_FILLER_COUNT = 6
const AGED_BUNDLE_CHARS = MIN_EVICTABLE_BYTES + AGED_FILLER_COUNT * FILLER_TEXT_CHARS
const AGED_TWO_READ_BUNDLE_CHARS = 2 * MIN_EVICTABLE_BYTES + AGED_FILLER_COUNT * FILLER_TEXT_CHARS
const LEGACY_EVICTED_MARKER = "[lru-evicted]"
const LEGACY_DEDUPED_MARKER = "[lru-deduped]"
const LEGACY_HINT_LINE_PREFIX = "[lru-hot] recently active:"
const LEGACY_TOMBSTONE_PATH = "/data/legacy-tombstoned.txt"
const TOOL_FAULT_MESSAGE = "tool getter exploded"
const DEDUP_SUPERSEDED_LEAD = "identical call superseded by the newer output at message"
const DEDUP_RANGE_SUPERSEDED_LEAD = "range read superseded by the retained range at message"
const PATH_RANGE_SEPARATOR = ":"
const RANGE_SEPARATOR = "-"
const DEDUP_PATH = "/data/dedup.txt"
const RANGE_COLLAPSE_PATH = "/data/range-collapse.txt"
const RANGE_COLLAPSE_WINDOW_COUNT = 1
// A limit large enough that no eviction fires in the range-collapse tests:
// the post-collapse bundle (one tombstone, one retained 2560-byte read, six
// filler messages) sits far under this, so the tests isolate the collapse
// pass from the eviction pass.
const RANGE_COLLAPSE_SPACIOUS_CONTEXT_LIMIT = 100000
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
const FILE_PART_ID = "prt_ctx_file_fixture"
const PURGE_MARKER = "[ctx-purged-input]"
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
  (await contextManagerFactory(
    {},
    { metricsLog: false, liveStateLog: false, ingestionHygieneCopy: false, pageStore: false },
  )) as HookMap

const loadPluginHooksWith = async (options: Record<string, unknown>): Promise<HookMap> =>
  (await contextManagerFactory(
    {},
    { metricsLog: false, liveStateLog: false, ingestionHygieneCopy: false, pageStore: false, ...options },
  )) as HookMap

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

const pageStoreOlderLineFor = (subject: string, count: number): string =>
  `${STASH_MARKER} ${PAGE_STORE_OLDER_LEAD} "${subject}": ${count}.`

const pageStoreMissLineFor = (subject: string): string => `${STASH_MARKER} ${PAGE_STORE_MISS_LEAD} "${subject}".`

const stashMissFor = (subject: string, occupancy: string): string =>
  `${STASH_MARKER} ${STASH_MISS_LEAD} "${subject}"; ${STASH_MISS_HINT}.\n${occupancy}\n${pageStoreMissLineFor(subject)}`

type OccupancyEntryShape = { tool: string; subject: string; msgIndex: number }

const stashOccupancyLineFor = (entries: OccupancyEntryShape[]): string => {
  const categoryCounts = new Map<string, number>()
  let oldest = entries[0].msgIndex
  let newest = entries[0].msgIndex
  for (const entry of entries) {
    categoryCounts.set(entry.tool, (categoryCounts.get(entry.tool) ?? 0) + 1)
    oldest = Math.min(oldest, entry.msgIndex)
    newest = Math.max(newest, entry.msgIndex)
  }
  const categories = [...categoryCounts.keys()].sort()
  const shown = categories.slice(0, MAX_OCCUPANCY_CATEGORIES)
  const overflowCount = categories.length - shown.length
  const categoryList =
    shown.map((tool) => `${tool} ${categoryCounts.get(tool)}`).join(STASH_OCCUPANCY_CATEGORY_SEPARATOR) +
    (overflowCount > 0 ? `${STASH_OCCUPANCY_CATEGORY_SEPARATOR}+${overflowCount} ${STASH_OCCUPANCY_OVERFLOW_LABEL}` : "")
  const bounds =
    entries.length === 1
      ? `${STASH_MESSAGE_LABEL} ${oldest}`
      : `${STASH_OCCUPANCY_RANGE_OLDEST_LABEL} ${STASH_MESSAGE_LABEL} ${oldest}, ${STASH_OCCUPANCY_RANGE_NEWEST_LABEL} ${STASH_MESSAGE_LABEL} ${newest}`
  const subjectCount = new Set(entries.map((entry) => entry.subject)).size
  return `${STASH_MARKER} ${STASH_OCCUPANCY_LEAD} ${entries.length} ${
    entries.length === 1 ? STASH_OCCUPANCY_ENTRY_LABEL : STASH_OCCUPANCY_ENTRIES_LABEL
  } across ${subjectCount} ${subjectCount === 1 ? STASH_OCCUPANCY_SUBJECT_LABEL : STASH_OCCUPANCY_SUBJECTS_LABEL}: ${categoryList}; ${bounds}.`
}

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

const faultMapBoundSubject = (index: number): string => `${FAULT_MAP_SUBJECT_PREFIX}${index}.txt`

const faultContestBundle = (paths: string[]): StrictBundle =>
  buildBundle([paths.map((path) => pathToolPart(path, MIN_EVICTABLE_BYTES)), ...fillerMessages()])

const runFaultContest = async (hooks: HookMap, paths: string[], deficitTokens: number): Promise<StrictBundle> => {
  const contestChars = paths.length * MIN_EVICTABLE_BYTES + RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(contestChars, deficitTokens))
  const bundle = faultContestBundle(paths)
  await runTransform(hooks, bundle)
  return bundle
}

const evictAndReload = async (hooks: HookMap, path: string): Promise<void> => {
  await runTransform(hooks, buildBundle([[pathToolPart(path, MIN_EVICTABLE_BYTES)], ...fillerMessages()]))
  assert.equal(await readEvicted(hooks, path, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
}

const evictAndReloadEach = async (hooks: HookMap, paths: string[]): Promise<void> => {
  await runTransform(
    hooks,
    buildBundle([...paths.map((path) => [pathToolPart(path, MIN_EVICTABLE_BYTES)]), ...fillerMessages()]),
  )
  for (const path of paths) {
    assert.equal(await readEvicted(hooks, path, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  }
}

const assertEntryTombstoned = (bundle: StrictBundle, partIndex: number): void => {
  assert.ok(toolPartAt(bundle.messages[0], partIndex).state.output.startsWith(TOMBSTONE_MARKER))
}

const assertEntryKept = (bundle: StrictBundle, partIndex: number): void => {
  assert.equal(toolPartAt(bundle.messages[0], partIndex).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
}

const runFaultBoundCycles = async (hooks: HookMap): Promise<void> => {
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  const subjects = Array.from({ length: FAULT_MAP_OVERFLOW_COUNT }, (_, index) => faultMapBoundSubject(index))
  for (let start = 0; start < subjects.length; start += FAULT_MAP_CYCLE_SIZE) {
    await evictAndReloadEach(hooks, subjects.slice(start, start + FAULT_MAP_CYCLE_SIZE))
  }
}

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

test("transform defers a reloaded subject past its unfaulted sibling when both candidates tie on recency", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await evictAndReload(hooks, FAULT_ORDER_RELOADED_PATH)

  const bundle = await runFaultContest(
    hooks,
    [FAULT_ORDER_RELOADED_PATH, FAULT_ORDER_SIBLING_PATH],
    OVER_BY_ONE_TOKENS,
  )

  assertEntryTombstoned(bundle, 1)
  assertEntryKept(bundle, 0)
})

test("transform scales the eviction deferral with the fault count when differently faulted candidates tie on recency", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  await evictAndReload(hooks, FAULT_SCALE_DOUBLE_PATH)
  await evictAndReload(hooks, FAULT_SCALE_DOUBLE_PATH)
  await evictAndReload(hooks, FAULT_SCALE_SINGLE_PATH)

  const bundle = await runFaultContest(
    hooks,
    [FAULT_SCALE_DOUBLE_PATH, FAULT_SCALE_SINGLE_PATH],
    OVER_BY_ONE_TOKENS,
  )

  assertEntryTombstoned(bundle, 1)
  assertEntryKept(bundle, 0)
})

test("transform keeps a faulted candidate evictable past the recent window while ordering it after its unfaulted sibling", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await evictAndReload(hooks, FAULT_WINDOW_RELOADED_PATH)

  const shallow = await runFaultContest(
    hooks,
    [FAULT_WINDOW_RELOADED_PATH, FAULT_WINDOW_SIBLING_PATH],
    OVER_BY_ONE_TOKENS,
  )
  assertEntryTombstoned(shallow, 1)
  assertEntryKept(shallow, 0)

  const contestChars = 2 * MIN_EVICTABLE_BYTES + (RECENT_WINDOW_FILLER_MESSAGES + 2) * FILLER_TEXT_CHARS
  await setContextLimit(
    hooks,
    SESSION_ID,
    contextForDeficit(contestChars, tokensForChars(MIN_EVICTABLE_BYTES) + OVER_BY_ONE_TOKENS),
  )
  const deepened = faultContestBundle([FAULT_WINDOW_RELOADED_PATH, FAULT_WINDOW_SIBLING_PATH])
  deepened.messages.push(
    syntheticMessageFor(SESSION_ID, [textPart(textOfChars(FILLER_TEXT_CHARS))]),
    syntheticMessageFor(SESSION_ID, [textPart(textOfChars(FILLER_TEXT_CHARS))]),
  )
  await runTransform(hooks, deepened)
  assertEntryTombstoned(deepened, 0)
  assertEntryTombstoned(deepened, 1)
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

  const stats = await readStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.modelContextTokens, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
})

test("transform lets the per model override beat the model reported limit and labels the budget source override", async () => {
  const hooks = await loadPluginHooksWith({ modelContextTokens: { [OVERRIDE_MODEL_KEY]: SMALL_CONTEXT_LIMIT } })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, LARGE_DEFAULT_CONTEXT_TOKENS)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-beats-reported.txt")
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
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

  const stats = await readStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.modelContextTokens, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
})

test("transform applies the per model override when chat params carry no reported context limit", async () => {
  const hooks = await loadPluginHooksWith({ modelContextTokens: { [OVERRIDE_MODEL_KEY]: SMALL_CONTEXT_LIMIT } })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, undefined)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-without-reported.txt")
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.modelContextTokens, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
})

test("transform ignores per model map entries for unknown model ids and keeps the reported limit in charge", async () => {
  const hooks = await loadPluginHooksWith({ modelContextTokens: { [OTHER_MODEL_KEY]: SMALL_CONTEXT_LIMIT } })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-unknown-model.txt")
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
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

  const stats = await readStats(hooks, SESSION_ID)
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

  const stats = await readStats(hooks, SESSION_ID)
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
  const stats = await readStats(hooks, SESSION_ID)
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
  const stats = await readStats(hooks, SESSION_ID)
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
  const stats = await readStats(hooks, SESSION_ID)
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
  const stats = await readStats(hooks, SESSION_ID)
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
  const stats = await readStats(hooks, SESSION_ID)
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

  assert.equal(await readEvicted(hooks, "/data/never-evicted.txt", SESSION_ID), stashMissFor("/data/never-evicted.txt", STASH_EMPTY_OCCUPANCY))
})

test("read_evicted appends a populated occupancy line with alphabetical categories and the message range on a miss against a multi tool stash", async () => {
  const hooks = await loadPluginHooksWith({ protectedTools: [] })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(OCCUPANCY_PATH_A, MIN_EVICTABLE_BYTES)],
    [bashToolPart(OCCUPANCY_COMMAND_A, MIN_EVICTABLE_BYTES)],
    [completedToolPart(GLOB_TOOL, { [PATH_INPUT_KEY]: OCCUPANCY_PATTERN_A }, outputOfBytes(MIN_EVICTABLE_BYTES))],
    [bashToolPart(OCCUPANCY_COMMAND_B, MIN_EVICTABLE_BYTES)],
    [completedToolPart(GREP_TOOL, { [PATTERN_INPUT_KEY]: OCCUPANCY_PATTERN_B }, outputOfBytes(MIN_EVICTABLE_BYTES))],
    [pathToolPart(OCCUPANCY_PATH_B, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    await readEvicted(hooks, OCCUPANCY_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      OCCUPANCY_MISS_SUBJECT,
      "[ctx-stash] stash holds 6 entries across 6 subjects: bash 2, glob 1, grep 1, read 2; oldest at message 0, newest at message 5.",
    ),
  )
})

test("read_evicted reports the single message bound on a miss whose stashed entries all sit at one message index", async () => {
  const hooks = await loadPluginHooksWith({ stashLimit: OCCUPANCY_SLIM_STASH_LIMIT })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(OCCUPANCY_SLIM_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    await readEvicted(hooks, OCCUPANCY_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      OCCUPANCY_MISS_SUBJECT,
      "[ctx-stash] stash holds 1 entry across 1 subject: read 1; at message 0.",
    ),
  )
})

test("read_evicted states the stash holds nothing when the session stash exists but is empty", async () => {
  const hooks = await loadPluginHooksWith({ stashLimit: OCCUPANCY_ZERO_STASH_LIMIT })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(OCCUPANCY_DROPPED_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)
  assert.deepEqual((await readStats(hooks, SESSION_ID)).stash, {
    entries: OCCUPANCY_ZERO_STASH_LIMIT,
    capacity: OCCUPANCY_ZERO_STASH_LIMIT,
  })

  assert.equal(
    await readEvicted(hooks, OCCUPANCY_MISS_SUBJECT, SESSION_ID),
    stashMissFor(OCCUPANCY_MISS_SUBJECT, "[ctx-stash] stash holds nothing from this session."),
  )
})

test("read_evicted caps the occupancy category list at five categories with an overflow clause", async () => {
  const hooks = await loadPluginHooksWith({ protectedTools: [], userFenceEviction: { enabled: true } })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const cappedBashSubjects = Array.from({ length: OCCUPANCY_CAPPED_TOOL_COUNT }, (_, index) => OCCUPANCY_CAPPED_PATHS[index])
  const bundle = buildBundle([
    ...cappedBashSubjects.map((path) => [pathToolPart(path, MIN_EVICTABLE_BYTES)]),
    ...Array.from({ length: OCCUPANCY_CAPPED_TOOL_COUNT }, (_, index) => [
      bashToolPart(`${OCCUPANCY_CAPPED_COMMAND_PREFIX}${index}`, MIN_EVICTABLE_BYTES),
    ]),
    ...Array.from({ length: OCCUPANCY_CAPPED_TOOL_COUNT }, (_, index) => [
      completedToolPart(GLOB_TOOL, { [PATH_INPUT_KEY]: `${OCCUPANCY_CAPPED_GLOB_PREFIX}${index}.ts` }, outputOfBytes(MIN_EVICTABLE_BYTES)),
    ]),
    ...Array.from({ length: OCCUPANCY_CAPPED_TOOL_COUNT }, (_, index) => [
      completedToolPart(GREP_TOOL, { [PATTERN_INPUT_KEY]: `${OCCUPANCY_CAPPED_GREP_PREFIX}${index}` }, outputOfBytes(MIN_EVICTABLE_BYTES)),
    ]),
    ...Array.from({ length: OCCUPANCY_CAPPED_TOOL_COUNT }, (_, index) => [
      completedToolPart(OCCUPANCY_CAPPED_SIXTH_TOOL, { [SECONDARY_PATH_INPUT_KEY]: `${OCCUPANCY_CAPPED_SIXTH_PREFIX}${index}.txt` }, outputOfBytes(MIN_EVICTABLE_BYTES)),
    ]),
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const cappedBlocks = [
    fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, `${FENCE_MIXED_TAG}-a`)),
    fenceBlockText(FENCE_LANGUAGE_JS, fenceContentLines(FENCE_OVER_LINES + 1, `${FENCE_MIXED_TAG}-b`)),
  ]
  await runTransform(
    hooks,
    userFenceBundle(`${FENCE_PROSE_BEFORE}\n${cappedBlocks[0]}\n${FENCE_PROSE_MIDDLE}\n${cappedBlocks[1]}\n${FENCE_PROSE_AFTER}`),
  )

  assert.equal(
    await readEvicted(hooks, OCCUPANCY_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      OCCUPANCY_MISS_SUBJECT,
      "[ctx-stash] stash holds 17 entries across 17 subjects: bash 3, fence 2, glob 3, grep 3, read 3, +1 more; oldest at message 0, newest at message 14.",
    ),
  )
})

test("read_evicted categorizes fence stashed entries under the fence label alongside tool entries", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_MIXED_TAG))
  const bundle = buildBundle([
    [pathToolPart(OCCUPANCY_PATH_A, MIN_EVICTABLE_BYTES)],
    [pathToolPart(OCCUPANCY_PATH_B, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)
  await runTransform(hooks, userFenceBundle(block))

  assert.equal(
    await readEvicted(hooks, OCCUPANCY_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      OCCUPANCY_MISS_SUBJECT,
      "[ctx-stash] stash holds 3 entries across 3 subjects: fence 1, read 2; oldest at message 0, newest at message 1.",
    ),
  )
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

  assert.equal(
    await readEvicted(hooks, stashSubjects[0], SESSION_ID),
    stashMissFor(
      stashSubjects[0],
      stashOccupancyLineFor(stashSubjects.slice(1).map((subject, index) => ({ tool: READ_TOOL, subject, msgIndex: index + 1 }))),
    ),
  )
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
    stashMissFor(STASH_ISOLATION_SUBJECT, STASH_EMPTY_OCCUPANCY),
  )
})

test("transform leaves no stash behind when the estimate sits under the watermark", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForWatermarkTokens(tokensForChars(STANDARD_BUNDLE_CHARS) + HEADROOM_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, "/data/kept.txt")
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await readEvicted(hooks, "/data/kept.txt", SESSION_ID), stashMissFor("/data/kept.txt", STASH_EMPTY_OCCUPANCY))
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
  assert.equal(await readEvicted(hooks, DEDUP_PATH, SESSION_ID), stashMissFor(DEDUP_PATH, STASH_EMPTY_OCCUPANCY))
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

const rangeReadPart = (path: string, offset: number, limit: number, outputBytes: number): CompletedToolPart =>
  completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: path, [OFFSET_INPUT_KEY]: offset, [LIMIT_INPUT_KEY]: limit }, outputOfBytes(outputBytes))

const rangeTombstoneFor = (path: string, start: number, end: number, retainedMsgIndex: number, retainedStart: number, retainedEnd: number): string =>
  `${DEDUP_MARKER} ${READ_TOOL} ${path}${PATH_RANGE_SEPARATOR}${start}${RANGE_SEPARATOR}${end} ${DEDUP_RANGE_SUPERSEDED_LEAD} ${retainedMsgIndex} (${path}${PATH_RANGE_SEPARATOR}${retainedStart}${RANGE_SEPARATOR}${retainedEnd})`

test("transform collapses a range read fully contained in a newer read of the same path", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, RANGE_COLLAPSE_SPACIOUS_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [rangeReadPart(RANGE_COLLAPSE_PATH, 100, 50, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [rangeReadPart(RANGE_COLLAPSE_PATH, 80, 120, MIN_EVICTABLE_BYTES + 512)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[0].parts[0], {
    type: "text",
    text: rangeTombstoneFor(RANGE_COLLAPSE_PATH, 100, 150, 3, 80, 200),
  })
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES + 512))
})

test("metrics log counts a collapsed range read and its bytes in the savings totals", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWith({ metricsLog: true, metricsPath })
    await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

    const bundle = buildBundle([
      [rangeReadPart(RANGE_COLLAPSE_PATH, 100, 50, MIN_EVICTABLE_BYTES)],
      ...fillerMessages(2),
      [rangeReadPart(RANGE_COLLAPSE_PATH, 80, 120, MIN_EVICTABLE_BYTES + 512)],
      ...fillerMessages(),
    ])
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].totals.collapsedWindows, RANGE_COLLAPSE_WINDOW_COUNT)
    assert.equal(lines[0].totals.collapsedWindowBytes, MIN_EVICTABLE_BYTES)
    assert.equal(lines[0].totals.collapsedWindowTokensSaved, tokensForChars(MIN_EVICTABLE_BYTES))
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).collapsedWindows, RANGE_COLLAPSE_WINDOW_COUNT)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("transform collapses a duplicate window whose sibling input key differs so tool dedup does not claim it", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, RANGE_COLLAPSE_SPACIOUS_CONTEXT_LIMIT)

  // Identical offset/limit to the retained read, but the differing
  // encoding key makes the input distinct, so tool dedup (exact input
  // identity) leaves both and range collapse must catch the equal range.
  // The containment operators are non-strict (start <= and end >=) on
  // purpose: an equal range is fully contained in itself and carries no
  // lines the retained window lacks.
  const bundle = buildBundle([
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: RANGE_COLLAPSE_PATH, [OFFSET_INPUT_KEY]: 80, [LIMIT_INPUT_KEY]: 120, [DEDUP_ENCODING_KEY]: "other" }, outputOfBytes(MIN_EVICTABLE_BYTES))],
    ...fillerMessages(2),
    [rangeReadPart(RANGE_COLLAPSE_PATH, 80, 120, MIN_EVICTABLE_BYTES + 512)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[0].parts[0], {
    type: "text",
    text: rangeTombstoneFor(RANGE_COLLAPSE_PATH, 80, 200, 3, 80, 200),
  })
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES + 512))
})

test("transform never collapses a read whose range is malformed", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, RANGE_COLLAPSE_SPACIOUS_CONTEXT_LIMIT)

  const negativeOffset = buildBundle([
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: RANGE_COLLAPSE_PATH, [OFFSET_INPUT_KEY]: -20, [LIMIT_INPUT_KEY]: 300 }, outputOfBytes(MIN_EVICTABLE_BYTES))],
    ...fillerMessages(2),
    [rangeReadPart(RANGE_COLLAPSE_PATH, 80, 120, MIN_EVICTABLE_BYTES + 512)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, negativeOffset)
  assert.equal(toolPartAt(negativeOffset.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))

  const zeroLimit = buildBundle([
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: RANGE_COLLAPSE_PATH, [OFFSET_INPUT_KEY]: 100, [LIMIT_INPUT_KEY]: 0 }, outputOfBytes(MIN_EVICTABLE_BYTES))],
    ...fillerMessages(2),
    [rangeReadPart(RANGE_COLLAPSE_PATH, 80, 120, MIN_EVICTABLE_BYTES + 512)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, zeroLimit)
  assert.equal(toolPartAt(zeroLimit.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))

  const fractional = buildBundle([
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: RANGE_COLLAPSE_PATH, [OFFSET_INPUT_KEY]: 100.5, [LIMIT_INPUT_KEY]: 119.5 }, outputOfBytes(MIN_EVICTABLE_BYTES))],
    ...fillerMessages(2),
    [rangeReadPart(RANGE_COLLAPSE_PATH, 80, 120, MIN_EVICTABLE_BYTES + 512)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, fractional)
  assert.equal(toolPartAt(fractional.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform keeps overlapping range reads that are not contained in a newer window", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, RANGE_COLLAPSE_SPACIOUS_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [rangeReadPart(RANGE_COLLAPSE_PATH, 100, 50, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [rangeReadPart(RANGE_COLLAPSE_PATH, 120, 50, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform never collapses a range read inside the recent window", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, RANGE_COLLAPSE_SPACIOUS_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [rangeReadPart(RANGE_COLLAPSE_PATH, 80, 120, MIN_EVICTABLE_BYTES + 512)],
    [rangeReadPart(RANGE_COLLAPSE_PATH, 100, 50, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES + 512))
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform never collapses a range read whose output sits below the size floor", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, RANGE_COLLAPSE_SPACIOUS_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [rangeReadPart(RANGE_COLLAPSE_PATH, 100, 50, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [rangeReadPart(RANGE_COLLAPSE_PATH, 80, 120, MIN_EVICTABLE_BYTES + 512)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(APPEARANCE_ONLY_OUTPUT_BYTES))
})

test("a contained window scrolled into the recent window keeps counting as collapsed without resurrecting its output", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, RANGE_COLLAPSE_SPACIOUS_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [rangeReadPart(RANGE_COLLAPSE_PATH, 100, 50, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [rangeReadPart(RANGE_COLLAPSE_PATH, 80, 120, MIN_EVICTABLE_BYTES + 512)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)
  assert.deepEqual(bundle.messages[0].parts[0], {
    type: "text",
    text: rangeTombstoneFor(RANGE_COLLAPSE_PATH, 100, 150, 3, 80, 200),
  })

  // The stored session re-offers the same message list every run, with the
  // former tombstone's message now inside the recent window: the contained
  // read must stay tombstoned (never resurrect) and the counters must not
  // grow, because a tombstoned output is never a collapse candidate again.
  // The tombstone text is stable from the first run: the pass does not
  // rewrite it, so it still names the retained read's original message
  // index even though later unshifts moved both messages down.
  bundle.messages.unshift(syntheticMessage([textPart(textOfChars(FILLER_TEXT_CHARS))]))
  bundle.messages.unshift(syntheticMessage([textPart(textOfChars(FILLER_TEXT_CHARS))]))
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle.messages[2].parts[0], {
    type: "text",
    text: rangeTombstoneFor(RANGE_COLLAPSE_PATH, 100, 150, 3, 80, 200),
  })
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).collapsedWindows, RANGE_COLLAPSE_WINDOW_COUNT)
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

test("context_stats counts file attachment dedup tombstones in the deduped counter", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(2),
    [fileAttachmentPart(FILE_MIME_TEXT, FILE_URL, FILE_FILENAME)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).deduped, 1)
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
const RETENTION_WIDE_MESSAGES = 16
const RETENTION_MID_MESSAGES = 12
const RETENTION_BOUNDARY_AGE_MESSAGES = 6
const RETENTION_MIXED_AGED_READ_MESSAGES = 10
const RETENTION_MIXED_READ_PATH = "/data/retention-aged-read.txt"
const RETENTION_INVALID_VALUES = [12.5, 0, -1, "16"]

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

test("transform with reasoningRetentionMessages set to the window produces the same message list as unset", async () => {
  const unsetHooks = await loadPluginHooks()
  const explicitHooks = await loadPluginHooksWith({ reasoningRetentionMessages: RECENT_WINDOW_MESSAGES })

  const buildExpiryBundle = (): StrictBundle =>
    buildBundle([
      [reasoningPart(REASONING_COLD_TEXT)],
      ...fillerMessages(RECENT_WINDOW_MESSAGES),
      [reasoningPart(REASONING_BOUNDARY_TEXT)],
      [reasoningPart(REASONING_HOT_TEXT)],
      ...fillerMessages(RECENT_WINDOW_MESSAGES - 2),
    ])
  const unsetBundle = buildExpiryBundle()
  const explicitBundle = buildExpiryBundle()
  await runTransform(unsetHooks, unsetBundle)
  await runTransform(explicitHooks, explicitBundle)

  assert.deepEqual(explicitBundle, unsetBundle)
})

test("transform clamps a reasoningRetentionMessages value below the recent window up to the window", async () => {
  const hooks = await loadPluginHooksWith({ reasoningRetentionMessages: 2 })

  const bundle = buildBundle([
    [reasoningPart(REASONING_COLD_TEXT)],
    ...fillerMessages(1),
    [reasoningPart(REASONING_BOUNDARY_TEXT)],
    [reasoningPart(REASONING_HOT_TEXT)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.equal(bundle.messages[0].parts.length, 0)
  assert.deepEqual(bundle.messages[2].parts, [reasoningPart(REASONING_BOUNDARY_TEXT)])
  assert.deepEqual(bundle.messages[3].parts, [reasoningPart(REASONING_HOT_TEXT)])
})

test("transform drops invalid reasoningRetentionMessages values to the unset window behavior", async () => {
  for (const invalidValue of RETENTION_INVALID_VALUES) {
    const hooks = await loadPluginHooksWith({ reasoningRetentionMessages: invalidValue })

    const bundle = buildBundle([
      [reasoningPart(REASONING_COLD_TEXT)],
      ...fillerMessages(RECENT_WINDOW_MESSAGES),
      [reasoningPart(REASONING_BOUNDARY_TEXT)],
      ...fillerMessages(RECENT_WINDOW_MESSAGES - 1),
    ])
    await runTransform(hooks, bundle)

    assert.equal(bundle.messages[0].parts.length, 0, `value ${String(invalidValue)}`)
    assert.equal(bundle.messages[RECENT_WINDOW_MESSAGES + 1].parts.length, 1, `value ${String(invalidValue)}`)
  }
})

test("transform keeps reasoning between the recent window and a widened retention age and expires only what sits beyond it", async () => {
  const hooks = await loadPluginHooksWith({ reasoningRetentionMessages: RETENTION_WIDE_MESSAGES })

  const bundle = buildBundle([
    [reasoningPart(REASONING_COLD_TEXT)],
    ...fillerMessages(6),
    [reasoningPart(REASONING_SECOND_COLD_TEXT)],
    ...fillerMessages(10),
  ])
  await runTransform(hooks, bundle)

  assert.equal(bundle.messages[0].parts.length, 0)
  assert.deepEqual(bundle.messages[7].parts, [reasoningPart(REASONING_SECOND_COLD_TEXT)])
})

test("transform keeps the reasoning part exactly at the retention age and expires the first part beyond it", async () => {
  const hooks = await loadPluginHooksWith({ reasoningRetentionMessages: RETENTION_BOUNDARY_AGE_MESSAGES })

  const bundle = buildBundle([
    [reasoningPart(REASONING_COLD_TEXT)],
    ...fillerMessages(RETENTION_BOUNDARY_AGE_MESSAGES + 3),
    [reasoningPart(REASONING_BOUNDARY_TEXT)],
    ...fillerMessages(RETENTION_BOUNDARY_AGE_MESSAGES - 1),
  ])
  await runTransform(hooks, bundle)

  assert.equal(bundle.messages[0].parts.length, 0)
  assert.deepEqual(bundle.messages[RETENTION_BOUNDARY_AGE_MESSAGES + 4].parts, [reasoningPart(REASONING_BOUNDARY_TEXT)])
})

test("transform expires a retained reasoning part once it ages past the retention boundary as the list grows", async () => {
  const hooks = await loadPluginHooksWith({ reasoningRetentionMessages: RETENTION_BOUNDARY_AGE_MESSAGES })

  const bundle = buildBundle([[reasoningPart(REASONING_COLD_TEXT)], ...fillerMessages(RETENTION_BOUNDARY_AGE_MESSAGES - 1)])
  await runTransform(hooks, bundle)
  assert.deepEqual(bundle.messages[0].parts, [reasoningPart(REASONING_COLD_TEXT)])

  fillerMessages(2).forEach((parts) => bundle.messages.push(syntheticMessageFor(SESSION_ID, parts)))
  await runTransform(hooks, bundle)
  assert.equal(bundle.messages[0].parts.length, 0)
})

test("a widened retention keeps reasoning at an age the aged read tier still evicts a read output at", async () => {
  const hooks = await loadPluginHooksWith({
    agedReadEvictionMessages: RETENTION_MIXED_AGED_READ_MESSAGES,
    reasoningRetentionMessages: RETENTION_WIDE_MESSAGES,
  })

  const bundle = buildBundle([
    [reasoningPart(REASONING_COLD_TEXT), pathToolPart(RETENTION_MIXED_READ_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(RETENTION_MIXED_AGED_READ_MESSAGES),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 1).state.output.startsWith(TOMBSTONE_MARKER))
  assert.deepEqual(bundle.messages[0].parts[0], reasoningPart(REASONING_COLD_TEXT))
})

test("metrics line counts retained aged reasoning in reasoningInWindowBytes and expires only parts beyond the retention age", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWith({
      metricsLog: true,
      metricsPath,
      manualMode: true,
      reasoningRetentionMessages: RETENTION_MID_MESSAGES,
    })

    const bundle = buildBundle([
      [reasoningPart(REASONING_COLD_TEXT)],
      ...fillerMessages(8),
      [reasoningPart(REASONING_SECOND_COLD_TEXT)],
      ...fillerMessages(3),
      [reasoningPart(REASONING_HOT_TEXT)],
      ...fillerMessages(3),
    ])
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].reasoningExpiredThisRun, EXPIRED_REASONING_SINGLE_COUNT)
    assert.equal(lines[0].reasoningBytesExpiredThisRun, REASONING_COLD_TEXT.length)
    assert.equal(lines[0].reasoningInWindowBytes, REASONING_SECOND_COLD_TEXT.length + REASONING_HOT_TEXT.length)

    const stats = await readStats(hooks, SESSION_ID)
    const composition = stats.composition as Record<string, unknown>
    assert.equal(composition.reasoningInWindowBytes, REASONING_SECOND_COLD_TEXT.length + REASONING_HOT_TEXT.length)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("transform leaves a widened-retention expiry result unchanged on a second transform pass", async () => {
  const hooks = await loadPluginHooksWith({ reasoningRetentionMessages: RETENTION_MID_MESSAGES })

  const bundle = buildBundle([
    [reasoningPart(REASONING_COLD_TEXT)],
    ...fillerMessages(8),
    [reasoningPart(REASONING_SECOND_COLD_TEXT)],
    ...fillerMessages(6),
  ])
  await runTransform(hooks, bundle)
  const afterFirstPass = structuredClone(bundle)
  await runTransform(hooks, bundle)

  assert.deepEqual(bundle, afterFirstPass)
  assert.equal(bundle.messages[0].parts.length, 0)
  assert.deepEqual(bundle.messages[9].parts, [reasoningPart(REASONING_SECOND_COLD_TEXT)])
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
  assert.equal(
    await readEvicted(hooks, STASH_PROTECTED_PATTERN, SESSION_ID),
    stashMissFor(
      STASH_PROTECTED_PATTERN,
      stashOccupancyLineFor([{ tool: READ_TOOL, subject: STASH_PROTECTED_VICTIM_PATH, msgIndex: 1 }]),
    ),
  )
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

const stashSessionId = (index: number): string => `ctx-stash-session-${index}`

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
    stashMissFor(stashSessionSubject(1), STASH_EMPTY_OCCUPANCY),
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
    stashMissFor(stashSessionSubject(1), STASH_EMPTY_OCCUPANCY),
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
    stashMissFor(stashSessionSubject(1), STASH_EMPTY_OCCUPANCY),
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
    stashMissFor(
      STASH_MISS_PROBE_SUBJECT,
      stashOccupancyLineFor([{ tool: READ_TOOL, subject: stashSessionSubject(0), msgIndex: 0 }]),
    ),
  )

  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0), STASH_EMPTY_OCCUPANCY),
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

const limitSessionId = (index: number): string => `ctx-limit-session-${index}`

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

const hintSessionId = (index: number): string => `ctx-hint-session-${index}`

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

const STATS_TOOL_NAME = "context_stats"
const METRICS_DIR_SEGMENTS = [".local", "share", "opencode"]
const METRICS_LOG_BASENAME = "context-metrics.jsonl"
const DEFAULT_METRICS_PATH = join(homedir(), ...METRICS_DIR_SEGMENTS, METRICS_LOG_BASENAME)
const HYGIENE_LOG_BASENAME = "context-hygiene.jsonl"
const DEFAULT_INGESTION_HYGIENE_PATH = join(homedir(), ...METRICS_DIR_SEGMENTS, HYGIENE_LOG_BASENAME)
const PAGE_STORE_LOG_BASENAME = "context-pages.jsonl"
const DEFAULT_PAGE_STORE_PATH = join(homedir(), ...METRICS_DIR_SEGMENTS, PAGE_STORE_LOG_BASENAME)
const METRICS_TEMP_DIR_PREFIX = "ctx-metrics-test-"
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
const METRICS_PROBE_SESSION_ID = "ctx-metrics-probe-session"
const METRICS_PROBE_MISS_SUBJECT = "/data/metrics-probe-miss.txt"
const METRICS_LINES_AFTER_RELOAD = 2
const METRICS_LINES_AFTER_RECOVERY = 1
const METRICS_ROTATION_SUFFIX = ".1"
const DEFAULT_METRICS_MIN_LINE_INTERVAL_MS = 60 * 1000
const METRICS_MIN_LINE_INTERVAL_INVALID_VALUES = [-1, Number.NaN, Number.POSITIVE_INFINITY, "soon"]
const METRICS_COALESCING_DISABLED_MS = 0
const METRICS_COALESCE_TEST_INTERVAL_MS = 250
const METRICS_COALESCE_WRITE_ANCHOR_INTERVAL_MS = 400
const METRICS_COALESCE_WRITE_ANCHOR_FIRST_DELAY_MS = 150
const METRICS_COALESCE_WRITE_ANCHOR_SECOND_DELAY_MS = 150
const METRICS_COALESCE_WRITE_ANCHOR_FINAL_DELAY_MS = 200
const METRICS_COALESCE_RUN_COUNT = 3
const METRICS_COALESCE_LINES_AFTER_ELAPSED = 2
const METRICS_COALESCE_LINES_AFTER_FLUSH = 2
const METRICS_COALESCE_LINES_AFTER_SPAN = 3
const METRICS_COALESCE_STASH_HIT_COUNT = 2
const METRICS_COALESCE_EVICTION_SUBJECT = "/data/coalesce-evicted.txt"
const METRICS_COALESCE_DEDUP_PATH = "/data/coalesce-dedup.txt"
const METRICS_COALESCE_RELOAD_SUBJECT = "/data/coalesce-reload.txt"
const METRICS_COALESCE_QUIET_SUBJECT = "/data/coalesce-quiet.txt"
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
const METRICS_ROTATION_PANEL_SEED_SESSION = "ctx-rotation-seed-session"
const STATS_ZEROED_COUNTERS = {
  evictions: 0,
  bytesReclaimed: 0,
  evictionTokensSaved: 0,
  stashHits: 0,
  stashMisses: 0,
  stashDropped: 0,
  deduped: 0,
  dedupedBytes: 0,
  dedupedUnique: 0,
  dedupTokensSaved: 0,
  collapsedWindows: 0,
  collapsedWindowBytes: 0,
  collapsedWindowTokensSaved: 0,
  postEvictionTouches: 0,
  reasoningExpiredUnique: 0,
  reasoningBytesExpiredUnique: 0,
  reasoningTokensSaved: 0,
  fenceEvicted: 0,
  processedContextBytes: 0,
  processedContextTokens: 0,
}
const STATS_LOG_FILE_LINES = 1

// Producer-direction schema lockstep, pinned at runtime because type
// stripping makes the core's compile-time exhaustiveness assertion inert:
// the zeroed fixture's key set must equal the persisted totals schema
// exactly (a totals key missing from the fixture would make totalsOf emit
// a key no assertion covers), and the producer's numeric SessionMetrics
// inventory must be raw counters plus the documented cursors exactly — a
// numeric field lacking a schema key fails here instead of silently
// skipping persistence.
test("the zeroed counters fixture, the totals schema, and the producer's numeric metrics stay in lockstep", () => {
  const fixtureKeys = Object.keys(STATS_ZEROED_COUNTERS).sort()
  const totalsKeys = [...TOTALS_KEYS].sort()
  assert.deepEqual(fixtureKeys, totalsKeys)
  const expectedMetricKeys = [...RAW_COUNTER_KEYS, ...METRICS_CURSOR_KEYS].sort()
  assert.deepEqual([...METRIC_NUMBER_KEYS], expectedMetricKeys)
})

type StatsToolDefinition = { execute: (args: unknown, context: unknown) => Promise<unknown> }

const readStats = async (hooks: HookMap, sessionID: string): Promise<Record<string, unknown>> =>
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

const metricsSessionId = (index: number): string => `ctx-metrics-session-${index}`

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

test("context_stats reports zeroed counters unknown budget and empty stash for a session without activity", async () => {
  const hooks = await loadPluginHooks()

  const stats = await readStats(hooks, SESSION_ID)

  assert.equal(stats.session, SESSION_ID)
  assert.deepEqual(stats.options, {
    watermark: WATERMARK_RATIO,
    watermarkTokens: null,
    recentWindow: RECENT_WINDOW_MESSAGES,
    reasoningRetentionMessages: RECENT_WINDOW_MESSAGES,
    minEvictableBytes: MIN_EVICTABLE_BYTES,
    defaultContextTokens: null,
    agedReadEvictionMessages: null,
    modelContextTokens: {},
    metricsLog: false,
    metricsPath: DEFAULT_METRICS_PATH,
    metricsRotationMaxBytes: DEFAULT_METRICS_ROTATION_MAX_BYTES,
    metricsMinLineIntervalMs: DEFAULT_METRICS_MIN_LINE_INTERVAL_MS,
    ingestionHygiene: true,
    ingestionHygieneCopy: false,
    ingestionHygienePath: DEFAULT_INGESTION_HYGIENE_PATH,
    ingestionHygieneRotationMaxBytes: DEFAULT_INGESTION_HYGIENE_ROTATION_MAX_BYTES,
    pageStore: false,
    pageStorePath: DEFAULT_PAGE_STORE_PATH,
    pageStoreRotationMaxBytes: DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES,
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

test("context_stats reports the explicit defaultContextTokens option as the budget when no limit was captured", async () => {
  const hooks = await loadPluginHooksWith({ defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })

  const stats = await readStats(hooks, SESSION_ID)

  assert.equal(stats.options.defaultContextTokens, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
  assert.equal(stats.modelContextTokens, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
})

test("context_stats records an unknown budget last run with null watermark and deficit after a skip run", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildStandardBundle(SESSION_ID, STATS_SKIP_RUN_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, null)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: null,
    deficitTokens: null,
  })
})

test("context_stats counts the eviction reclaimed bytes stash entry and last run deficit after one eviction run", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
  assert.deepEqual(countersOf(stats), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    processedContextBytes: 482,
    processedContextTokens: tokensForChars(482),
  })
  assert.deepEqual(stats.stash, { entries: 1, capacity: STASH_LIMIT })
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: tokensForChars(STANDARD_BUNDLE_CHARS) - OVER_BY_ONE_TOKENS,
    deficitTokens: OVER_BY_ONE_TOKENS,
  })
})

test("context_stats derives the eviction token-savings estimate from the reclaimed bytes over the default charsPerToken", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  await runTransform(hooks, bundle)

  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    processedContextBytes: 482,
    processedContextTokens: tokensForChars(482),
  })
})

test("context_stats scales the eviction token-savings estimate by the resolved charsPerToken", async () => {
  const hooks = await loadPluginHooksWith({ charsPerToken: SAVINGS_CUSTOM_CHARS_PER_TOKEN })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  await runTransform(hooks, bundle)

  const counters = countersOf(await readStats(hooks, SESSION_ID))
  assert.equal(counters.evictions, 1)
  assert.equal(counters.bytesReclaimed, MIN_EVICTABLE_BYTES)
  assert.equal(counters.evictionTokensSaved, Math.ceil(MIN_EVICTABLE_BYTES / SAVINGS_CUSTOM_CHARS_PER_TOKEN))
})

test("context_stats counts stash hits and misses from read_evicted and leaves invalid subject arguments uncounted", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  assert.equal(await readEvicted(hooks, STATS_MISS_SUBJECT, SESSION_ID), stashMissFor(STATS_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY))
  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), STATS_ZEROED_COUNTERS)

  const bundle = buildStandardBundle(SESSION_ID, STATS_HIT_SUBJECT)
  await runTransform(hooks, bundle)

  assert.equal(
    await readEvicted(hooks, STATS_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      STATS_MISS_SUBJECT,
      stashOccupancyLineFor([{ tool: READ_TOOL, subject: STATS_HIT_SUBJECT, msgIndex: 0 }]),
    ),
  )
  const afterMiss = await readStats(hooks, SESSION_ID)
  assert.deepEqual(countersOf(afterMiss), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    stashMisses: 1,
    processedContextBytes: 480,
    processedContextTokens: tokensForChars(480),
  })

  assert.equal(await readEvicted(hooks, INVALID_SUBJECT_VALUE, SESSION_ID), invalidSubjectMissFor("number"))
  assert.equal(await readEvicted(hooks, "", SESSION_ID), invalidSubjectMissFor("string"))
  const afterInvalid = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(afterInvalid).stashMisses, 1)
  assert.equal(countersOf(afterInvalid).stashHits, 0)

  assert.equal(await readEvicted(hooks, STATS_HIT_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  const afterHit = await readStats(hooks, SESSION_ID)
  assert.deepEqual(countersOf(afterHit), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    stashHits: 1,
    stashMisses: 1,
    processedContextBytes: 480,
    processedContextTokens: tokensForChars(480),
  })
})

test("context_stats counts a post eviction touch exactly once for a matching later call and never recounts repeated transforms", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, POST_EVICT_TOUCH_PATH)
  await runTransform(hooks, bundle)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))

  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart(POST_EVICT_TOUCH_PATH, APPEARANCE_ONLY_OUTPUT_BYTES)]))
  await runTransform(hooks, bundle)
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).postEvictionTouches, 1)

  await runTransform(hooks, bundle)
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).postEvictionTouches, 1)
})

test("context_stats leaves post eviction touches at zero when a later call matches nothing evicted", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, POST_EVICT_TOUCH_PATH)
  await runTransform(hooks, bundle)

  bundle.messages.push(
    syntheticMessageFor(SESSION_ID, [pathToolPart(POST_EVICT_UNMATCHED_PATH, APPEARANCE_ONLY_OUTPUT_BYTES)]),
  )
  await runTransform(hooks, bundle)

  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).postEvictionTouches, 0)
})

test("context_stats forgets the oldest evicted subject past the hundred subject cap and stops counting its post eviction touches", async () => {
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

  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).postEvictionTouches, 1)
})

test("transform credits a subject's fault from both a reload and a post eviction appearance and defers it past single source subjects", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(FAULT_CREDIT_RELOADED_PATH, MIN_EVICTABLE_BYTES), pathToolPart(FAULT_CREDIT_SIBLING_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)
  assert.equal(await readEvicted(hooks, FAULT_CREDIT_RELOADED_PATH, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  await evictAndReload(hooks, FAULT_CREDIT_SINGLE_HIT_PATH)

  bundle.messages.push(
    syntheticMessageFor(SESSION_ID, [
      pathToolPart(FAULT_CREDIT_RELOADED_PATH, APPEARANCE_ONLY_OUTPUT_BYTES),
      pathToolPart(FAULT_CREDIT_SIBLING_PATH, APPEARANCE_ONLY_OUTPUT_BYTES),
    ]),
  )
  await runTransform(hooks, bundle)
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).postEvictionTouches, 2)

  const touchContest = await runFaultContest(
    hooks,
    [FAULT_CREDIT_SIBLING_PATH, FAULT_CREDIT_UNFAULTED_PATH],
    OVER_BY_ONE_TOKENS,
  )
  assertEntryTombstoned(touchContest, 1)
  assertEntryKept(touchContest, 0)

  const accumulationContest = await runFaultContest(
    hooks,
    [FAULT_CREDIT_RELOADED_PATH, FAULT_CREDIT_SINGLE_HIT_PATH],
    OVER_BY_ONE_TOKENS,
  )
  assertEntryTombstoned(accumulationContest, 1)
  assertEntryKept(accumulationContest, 0)
})

test("context_stats counts one post eviction touch when a single bash appearance matches two evicted subjects", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWith({ metricsLog: true, metricsPath: metricsLogPathIn(metricsDir) })
    await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

    const bundle = buildBundle([
      [pathToolPart(FAULT_INVARIANCE_FIRST_PATH, MIN_EVICTABLE_BYTES), pathToolPart(FAULT_INVARIANCE_SECOND_PATH, MIN_EVICTABLE_BYTES)],
      ...fillerMessages(),
    ])
    await runTransform(hooks, bundle)

    bundle.messages.push(
      syntheticMessageFor(SESSION_ID, [
        bashToolPart(
          `${FAULT_INVARIANCE_COMMAND_PREFIX}${FAULT_INVARIANCE_FIRST_PATH} ${FAULT_INVARIANCE_SECOND_PATH}`,
          APPEARANCE_ONLY_OUTPUT_BYTES,
        ),
      ]),
    )
    await runTransform(hooks, bundle)

    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).postEvictionTouches, 1)
    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, 2)
    assert.equal(lines[1].postEvictionTouchesThisRun, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("the fault map forgets the least recently faulted subject past its bound and a fresh fault refreshes a subject's recency", async () => {
  const hooks = await loadPluginHooks()
  await runFaultBoundCycles(hooks)
  // The 257th distinct fault trims subject 0; re-faulting subject 250
  // refreshes its recency, so the 258th fault trims subject 1 instead.
  assert.equal(
    await readEvicted(hooks, faultMapBoundSubject(FAULT_MAP_REFRESHED_INDEX), SESSION_ID),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  await evictAndReloadEach(hooks, [faultMapBoundSubject(FAULT_MAP_NEW_INDEX)])

  const boundContest = await runFaultContest(
    hooks,
    [faultMapBoundSubject(FAULT_MAP_DEFERRED_INDEX), faultMapBoundSubject(FAULT_MAP_TRIMMED_INDEX)],
    OVER_BY_ONE_TOKENS,
  )
  assertEntryTombstoned(boundContest, 1)
  assertEntryKept(boundContest, 0)

  const refreshContest = await runFaultContest(
    hooks,
    [faultMapBoundSubject(FAULT_MAP_REFRESHED_INDEX), faultMapBoundSubject(FAULT_MAP_REFRESH_TRIMMED_INDEX)],
    OVER_BY_ONE_TOKENS,
  )
  assertEntryTombstoned(refreshContest, 1)
  assertEntryKept(refreshContest, 0)
})

test("a refresh at the fault map bound preserves bystander subjects' faults so a once faulted subject defers an unfaulted peer", async () => {
  const hooks = await loadPluginHooks()
  await runFaultBoundCycles(hooks)
  // The refresh is the setup's last faulting event on purpose: the next
  // insertion would trim subject 1 (or refill a freed slot) and heal the
  // observable state, so contesting subject 1 now isolates whether a
  // refresh at the bound preserves its neighbors' counts. Subject 1 keeps
  // one fault and defers count-0 subject 0; a refresh that drops bystander
  // counts ties the contest at zero and evicts first-listed subject 1.
  assert.equal(
    await readEvicted(hooks, faultMapBoundSubject(FAULT_MAP_REFRESHED_INDEX), SESSION_ID),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )

  const bystanderContest = await runFaultContest(
    hooks,
    [faultMapBoundSubject(FAULT_MAP_REFRESH_TRIMMED_INDEX), faultMapBoundSubject(FAULT_MAP_TRIMMED_INDEX)],
    OVER_BY_ONE_TOKENS,
  )
  assertEntryKept(bystanderContest, 0)
  assertEntryTombstoned(bystanderContest, 1)
})

test("context_stats counts dedup tombstones without counting evictions and stays incremental across repeated transforms", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).deduped, 1)
  assert.equal(countersOf(stats).evictions, 0)

  await runTransform(hooks, bundle)
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).deduped, 1)
})

test("context_stats accumulates the dedup token-savings estimate from each superseded duplicate's bytes", async () => {
  const hooks = await loadPluginHooks()
  const dedupSavingsParts = (): MessagePart[][] => [
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_SECOND_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_SECOND_PATH, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(2),
  ]

  await runTransform(hooks, buildBundle(dedupSavingsParts()))

  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    deduped: DEDUP_SAVINGS_PAIR_COUNT,
    dedupedBytes: DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES,
    dedupedUnique: DEDUP_SAVINGS_PAIR_COUNT,
    dedupTokensSaved: tokensForChars(DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES),
    processedContextBytes: 6234,
    processedContextTokens: tokensForChars(6234),
  })

  // The host re-materializes the stored messages on every run, so a standing
  // pair re-tombstones every run: the repeat runs on a fresh identical copy.
  await runTransform(hooks, buildBundle(dedupSavingsParts()))
  const counters = countersOf(await readStats(hooks, SESSION_ID))
  assert.equal(counters.deduped, DEDUP_SAVINGS_PAIR_COUNT * REPEATED_STANDING_RUNS)
  assert.equal(counters.dedupedUnique, DEDUP_SAVINGS_PAIR_COUNT)
  assert.equal(counters.dedupedBytes, DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES * REPEATED_STANDING_RUNS)
  assert.equal(counters.dedupTokensSaved, tokensForChars(DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES * REPEATED_STANDING_RUNS))
})

test("context_stats counts stash drops when a single run evicts fifty one entries past the stash bound", async () => {
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

  const stats = await readStats(hooks, SESSION_ID)
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

  const stats = await readStats(hooks, SESSION_ID)
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

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).evictions, STASH_CROSS_RUN_FIRST_COUNT + STASH_CROSS_RUN_SECOND_COUNT)
  assert.equal(countersOf(stats).stashDropped, STASH_CROSS_RUN_DROP_COUNT)
  assert.deepEqual(stats.stash, { entries: STASH_LIMIT, capacity: STASH_LIMIT })
  assert.equal(
    await readEvicted(hooks, firstRunSubjects[0], SESSION_ID),
    stashMissFor(
      firstRunSubjects[0],
      stashOccupancyLineFor([
        ...firstRunSubjects.slice(STASH_CROSS_RUN_DROP_COUNT).map((subject, index) => ({
          tool: READ_TOOL,
          subject,
          msgIndex: index + STASH_CROSS_RUN_DROP_COUNT,
        })),
        ...secondRunSubjects.map((subject) => ({
          tool: READ_TOOL,
          subject,
          msgIndex: STASH_CROSS_RUN_FIRST_COUNT + RECENT_WINDOW_FILLER_MESSAGES,
        })),
      ]),
    ),
  )
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
      processedContextBytes: 474,
      processedContextTokens: tokensForChars(474),
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
      dedupedUnique: 1,
      dedupTokensSaved: tokensForChars(THREE_ENTRY_OUTPUT_BYTES),
      processedContextBytes: 3117,
      processedContextTokens: tokensForChars(3117),
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
      processedContextBytes: 976,
      processedContextTokens: tokensForChars(976),
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
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log records an unwritable path in logWriteError surfaced through context_stats without throwing", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithMetricsLog(blockedMetricsPathIn(metricsDir))
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_BLOCKED_SUBJECT)
    await runTransform(hooks, bundle)

    const stats = await readStats(hooks, SESSION_ID)
    assert.equal(typeof stats.logWriteError, "string")
    assert.ok((stats.logWriteError as string).length > 0)
    assert.equal(countersOf(stats).evictions, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("context_stats keeps metrics isolated between two sessions", async () => {
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

  const statsA = await readStats(hooks, SESSION_ID)
  assert.equal(statsA.session, SESSION_ID)
  assert.deepEqual(countersOf(statsA), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    processedContextBytes: 482,
    processedContextTokens: tokensForChars(482),
  })
  const statsB = await readStats(hooks, SESSION_ID_B)
  assert.equal(statsB.session, SESSION_ID_B)
  assert.deepEqual(countersOf(statsB), {
    ...STATS_ZEROED_COUNTERS,
    evictions: STATS_ISOLATION_B_EVICTED_COUNT,
    bytesReclaimed: STATS_ISOLATION_B_EVICTED_COUNT * THREE_ENTRY_OUTPUT_BYTES,
    evictionTokensSaved: tokensForChars(STATS_ISOLATION_B_EVICTED_COUNT * THREE_ENTRY_OUTPUT_BYTES),
    processedContextBytes: 3928,
    processedContextTokens: tokensForChars(3928),
  })
})

test("context_stats drops the least recently active session metrics when a ninth session transforms", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  await storeMetricsSession(hooks, METRICS_SESSION_OVERFLOW_COUNT - 1)

  assert.deepEqual(countersOf(await readStats(hooks, metricsSessionId(0))), STATS_ZEROED_COUNTERS)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(1))).evictions, 1)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_BOUND - 1))).evictions, 1)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_OVERFLOW_COUNT - 1))).evictions, 1)
})

test("read_evicted leaves live session metrics untouched when a never-transformed session probes a stash miss at the session bound", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  assert.equal(
    await readEvicted(hooks, METRICS_PROBE_MISS_SUBJECT, METRICS_PROBE_SESSION_ID),
    stashMissFor(METRICS_PROBE_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY),
  )

  assert.equal(countersOf(await readStats(hooks, metricsSessionId(0))).evictions, 1)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_BOUND - 1))).evictions, 1)
  assert.deepEqual(countersOf(await readStats(hooks, METRICS_PROBE_SESSION_ID)), STATS_ZEROED_COUNTERS)
})

test("context_stats refreshes a probing session's metrics so it survives when a ninth session transforms", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  await readStats(hooks, metricsSessionId(0))
  await storeMetricsSession(hooks, METRICS_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(countersOf(await readStats(hooks, metricsSessionId(0))).evictions, 1)
  assert.deepEqual(countersOf(await readStats(hooks, metricsSessionId(1))), STATS_ZEROED_COUNTERS)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_OVERFLOW_COUNT - 1))).evictions, 1)
})

test("context_stats leaves live session metrics untouched when a never-transformed session opens the stats tool at the session bound", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  assert.deepEqual(countersOf(await readStats(hooks, METRICS_PROBE_SESSION_ID)), STATS_ZEROED_COUNTERS)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(0))).evictions, 1)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_BOUND - 1))).evictions, 1)
})

test("context_stats does not refresh a session stash so a stats-only probe leaves it exposed when a ninth session stashes an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  await readStats(hooks, stashSessionId(0))
  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0), STASH_EMPTY_OCCUPANCY),
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
    assert.equal(typeof (await readStats(hooks, SESSION_ID)).logWriteError, "string")

    mkdirSync(join(metricsDir, METRICS_BLOCKED_DIR_NAME), { recursive: true })
    bundle.messages.push(
      syntheticMessageFor(SESSION_ID, [pathToolPart(STATS_BLOCKED_SUBJECT, APPEARANCE_ONLY_OUTPUT_BYTES)]),
    )
    await runTransform(hooks, bundle)

    const stats = await readStats(hooks, SESSION_ID)
    assert.equal(Object.hasOwn(stats, "logWriteError"), false)
    assert.equal(countersOf(stats).evictions, 1)
    assert.equal(countersOf(stats).postEvictionTouches, 1)
    assert.equal(metricsLinesIn(blockedPath).length, METRICS_LINES_AFTER_RECOVERY)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("context_stats reports the metrics rotation cap in options defaulting to twenty MiB and falling back on invalid caps", async () => {
  assert.equal(
    ((await readStats(await loadPluginHooks(), SESSION_ID)).options as Record<string, unknown>).metricsRotationMaxBytes,
    DEFAULT_METRICS_ROTATION_MAX_BYTES,
  )

  const customHooks = await loadPluginHooksWith({ metricsRotationMaxBytes: METRICS_ROTATION_CUSTOM_CAP })
  assert.equal(
    ((await readStats(customHooks, SESSION_ID)).options as Record<string, unknown>).metricsRotationMaxBytes,
    METRICS_ROTATION_CUSTOM_CAP,
  )

  for (const invalidCap of METRICS_ROTATION_INVALID_CAPS) {
    const hooks = await loadPluginHooksWith({ metricsRotationMaxBytes: invalidCap })
    assert.equal(
      ((await readStats(hooks, SESSION_ID)).options as Record<string, unknown>).metricsRotationMaxBytes,
      DEFAULT_METRICS_ROTATION_MAX_BYTES,
    )
  }
})

test("context_stats reports metricsMinLineIntervalMs defaulting to sixty seconds and falling back on invalid values", async () => {
  assert.equal(
    ((await readStats(await loadPluginHooks(), SESSION_ID)).options as Record<string, unknown>).metricsMinLineIntervalMs,
    DEFAULT_METRICS_MIN_LINE_INTERVAL_MS,
  )

  const customHooks = await loadPluginHooksWith({ metricsMinLineIntervalMs: METRICS_COALESCE_TEST_INTERVAL_MS })
  assert.equal(
    ((await readStats(customHooks, SESSION_ID)).options as Record<string, unknown>).metricsMinLineIntervalMs,
    METRICS_COALESCE_TEST_INTERVAL_MS,
  )

  for (const invalidInterval of METRICS_MIN_LINE_INTERVAL_INVALID_VALUES) {
    const hooks = await loadPluginHooksWith({ metricsMinLineIntervalMs: invalidInterval })
    assert.equal(
      ((await readStats(hooks, SESSION_ID)).options as Record<string, unknown>).metricsMinLineIntervalMs,
      DEFAULT_METRICS_MIN_LINE_INTERVAL_MS,
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
    assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
      ...STATS_ZEROED_COUNTERS,
      evictions: 1,
      bytesReclaimed: MIN_EVICTABLE_BYTES,
      evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
      stashHits: 1,
      processedContextBytes: 992,
      processedContextTokens: tokensForChars(992),
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

const LIVE_STATE_DIR_NAME = "context-state"
const DEFAULT_LIVE_STATE_DIR = join(homedir(), ...METRICS_DIR_SEGMENTS, LIVE_STATE_DIR_NAME)
const LIVE_STATE_TEMP_DIR_PREFIX = "ctx-live-state-test-"
const LIVE_STATE_FILE_SUFFIX = ".json"
const LIVE_STATE_BLOCKER_FILE = "blocker.txt"
const DEFAULT_LIVE_STATE_PRUNE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const LIVE_STATE_PRUNE_TEST_MAX_AGE_MS = 1000
const LIVE_STATE_PRUNE_TEST_MIN_INTERVAL_MS = 0
const LIVE_STATE_PRUNE_THROTTLED_INTERVAL_MS = 60 * 1000
const LIVE_STATE_PRUNE_BACKDATED_MS = 10000
const DEFAULT_LIVE_STATE_PRUNE_MIN_INTERVAL_MS = 60 * 1000
// The fake-clock throttle pair: the advance step crosses the throttle but
// stays under max age minus the backdate, so the session's own fresh
// snapshot (mtime inside the window) survives the scan while the stale
// file does not.
const LIVE_STATE_PRUNE_FAKE_THROTTLE_INTERVAL_MS = 400
const LIVE_STATE_PRUNE_FAKE_MAX_AGE_MS = 6000

// Deterministic fake clock matching the plugin's now() option seam: tests
// advance it in explicit steps instead of sleeping real milliseconds. The
// default start is the real epoch so fs mtime comparisons (state-file
// pruning) stay consistent with real file timestamps; deltas come only
// from advanceMs.
const fakeClock = (startMs: number = Date.now()): { now: () => number; advanceMs: (ms: number) => void } => {
  let currentMs = startMs
  return {
    now: (): number => currentMs,
    advanceMs: (ms: number): void => {
      currentMs += ms
    },
  }
}

const LIVE_STATE_STALE_SESSION = "ctx-state-stale-session"
const LIVE_STATE_TMP_ORPHAN_SESSION = "ctx-state-tmp-orphan"
const LIVE_STATE_TMP_ORPHAN_CONTENT = '{"orphan": true}\n'
const LIVE_STATE_TEMP_FILE_SUFFIX = ".tmp"
const LIVE_STATE_THROTTLE_STALE_SESSION_A = "ctx-state-throttle-stale-a"
const LIVE_STATE_THROTTLE_STALE_SESSION_B = "ctx-state-throttle-stale-b"
const LIVE_STATE_STUCK_SESSION = "ctx-state-stuck-entry"
const LIVE_STATE_FRESH_SESSION = "ctx-state-fresh-session"
const LIVE_STATE_STALE_CONTENT = '{"stale": true}\n'
const LIVE_STATE_FRESH_CONTENT = '{"fresh": true}\n'
const LIVE_STATE_QUIET_SUBJECT = "/data/state-quiet.txt"
const LIVE_STATE_MANUAL_SUBJECT = "/data/state-manual.txt"
const LIVE_STATE_CUSTOM_STATE_DIR = "/tmp/custom-ctx-state"
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
      modelContextTokensModelKey: null,
      lastRun: { estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS), watermarkTokens: null, deficitTokens: null },
      totals: { ...STATS_ZEROED_COUNTERS, processedContextBytes: STANDARD_BUNDLE_CHARS, processedContextTokens: tokensForChars(STANDARD_BUNDLE_CHARS) },
      stash: { entries: 0, capacity: STASH_LIMIT },
      hotSubjects: [LIVE_STATE_QUIET_SUBJECT],
    })

    await runTransform(hooks, bundle)
    assert.deepEqual(snapshotBodyOf(stateDir, SESSION_ID).snapshot, {
      session: SESSION_ID,
      manualMode: false,
      modelContextTokens: null,
      modelContextTokensSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
      modelContextTokensModelKey: null,
      lastRun: { estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS), watermarkTokens: null, deficitTokens: null },
      totals: { ...STATS_ZEROED_COUNTERS, processedContextBytes: 2 * STANDARD_BUNDLE_CHARS, processedContextTokens: tokensForChars(2 * STANDARD_BUNDLE_CHARS) },
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

test("live state snapshot carries the captured budget source manual mode and the armed watermark on a manual run", async () => {
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
      watermarkTokens: MANUAL_ARMED_WATERMARK_TOKENS,
      deficitTokens: MANUAL_ARMED_DEFICIT_TOKENS,
    })
    assert.deepEqual(snapshot.totals, {
      ...STATS_ZEROED_COUNTERS,
      processedContextBytes: STANDARD_BUNDLE_CHARS,
      processedContextTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    })
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
      processedContextBytes: 484,
      processedContextTokens: tokensForChars(484),
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
    const stats = await readStats(hooks, `${LIVE_STATE_ESCAPE_SEGMENT}/${SESSION_ID}`)
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
    const stats = await readStats(hooks, SESSION_ID)
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
    const clock = fakeClock()
    const hooks = await loadPluginHooksWithLiveState(stateDir, {
      liveStatePruneMaxAgeMs: LIVE_STATE_PRUNE_FAKE_MAX_AGE_MS,
      liveStatePruneMinIntervalMs: LIVE_STATE_PRUNE_FAKE_THROTTLE_INTERVAL_MS,
      now: clock.now,
    })
    // The stale file's mtime is pinned to the fake clock's start so the
    // max-age check works against the injected clock instead of real fs
    // time drift: mtime = clock start - backdate, then the clock advances
    // one throttle interval, putting the file far past max age.
    const staleMoment = new Date(clock.now() - LIVE_STATE_PRUNE_BACKDATED_MS)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    const lateStalePath = liveStatePathIn(stateDir, LIVE_STATE_THROTTLE_STALE_SESSION_A)
    writeFileSync(lateStalePath, LIVE_STATE_STALE_CONTENT)
    utimesSync(lateStalePath, staleMoment, staleMoment)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))
    assert.equal(existsSync(lateStalePath), true)

    clock.advanceMs(LIVE_STATE_PRUNE_FAKE_THROTTLE_INTERVAL_MS)
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

    const stats = await readStats(hooks, SESSION_ID)
    assert.equal(typeof stats.stateWriteError, "string")
    assert.ok((stats.stateWriteError as string).length > 0)
    assert.deepEqual(readdirSync(stateDir), [`${SESSION_ID}.json`])
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state write failure records stateWriteError through context_stats without interrupting the session", async () => {
  const stateDir = makeLiveStateDir()
  try {
    writeFileSync(join(stateDir, LIVE_STATE_BLOCKER_FILE), "not a directory")
    const hooks = await loadPluginHooksWithLiveState(blockedLiveStateDirIn(stateDir))
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_BLOCKED_SUBJECT)
    await runTransform(hooks, bundle)

    const stats = await readStats(hooks, SESSION_ID)
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
    assert.equal(typeof (await readStats(hooks, SESSION_ID)).stateWriteError, "string")

    rmSync(join(stateDir, LIVE_STATE_BLOCKER_FILE))
    await runTransform(hooks, bundle)

    const stats = await readStats(hooks, SESSION_ID)
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

test("context_stats reports the live state options defaulting beside the metrics log and round tripping custom values", async () => {
  const defaultOptions = ((await readStats(await loadPluginHooks(), SESSION_ID)).options as Record<string, unknown>)
  assert.equal(defaultOptions.liveStateLog, false)
  assert.equal(defaultOptions.liveStatePath, DEFAULT_LIVE_STATE_DIR)
  assert.equal(defaultOptions.liveStatePruneMaxAgeMs, DEFAULT_LIVE_STATE_PRUNE_MAX_AGE_MS)
  assert.equal(defaultOptions.liveStatePruneMinIntervalMs, DEFAULT_LIVE_STATE_PRUNE_MIN_INTERVAL_MS)
  assert.equal(DEFAULT_LIVE_STATE_DIR, join(homedir(), ".local", "share", "opencode", "context-state"))

  const customHooks = await loadPluginHooksWith({
    liveStateLog: true,
    liveStatePath: LIVE_STATE_CUSTOM_STATE_DIR,
    liveStatePruneMaxAgeMs: LIVE_STATE_CUSTOM_PRUNE_MAX_AGE_MS,
    liveStatePruneMinIntervalMs: LIVE_STATE_CUSTOM_PRUNE_MIN_INTERVAL_MS,
  })
  const customOptions = (await readStats(customHooks, SESSION_ID)).options as Record<string, unknown>
  assert.equal(customOptions.liveStateLog, true)
  assert.equal(customOptions.liveStatePath, LIVE_STATE_CUSTOM_STATE_DIR)
  assert.equal(customOptions.liveStatePruneMaxAgeMs, LIVE_STATE_CUSTOM_PRUNE_MAX_AGE_MS)
  assert.equal(customOptions.liveStatePruneMinIntervalMs, LIVE_STATE_CUSTOM_PRUNE_MIN_INTERVAL_MS)
})

// The aged reasoning bundle's post-transform composition: the expired
// reasoning parts leave the list, so only the four filler messages remain.
const AGED_REASONING_PROCESSED_CHARS = RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS

const SIBLING_FIRST_CROSSING_COUNTERS = {
  ...STATS_ZEROED_COUNTERS,
  reasoningExpiredUnique: EXPIRED_REASONING_PAIR_COUNT,
  reasoningBytesExpiredUnique: EXPIRED_REASONING_PAIR_BYTES,
  reasoningTokensSaved: tokensForChars(EXPIRED_REASONING_PAIR_BYTES),
  processedContextBytes: AGED_REASONING_PROCESSED_CHARS,
  processedContextTokens: tokensForChars(AGED_REASONING_PROCESSED_CHARS),
}

const agedReasoningBundleFor = (sessionID: string): StrictBundle =>
  buildBundle(
    [[reasoningPart(REASONING_COLD_TEXT), reasoningPart(REASONING_SECOND_COLD_TEXT)], ...fillerMessages()],
    sessionID,
  )

test("context_stats credits each expired reasoning part once and holds the totals constant across repeated standing runs", async () => {
  const hooks = await loadPluginHooks()

  await runTransform(hooks, agedReasoningBundleFor(SESSION_ID))

  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), SIBLING_FIRST_CROSSING_COUNTERS)

  // The stored session retains its parts, so the same aged reasoning set is
  // re-expired on every run: the repeat runs on a fresh identical copy
  // recount the standing set per request but credit the lifetime totals
  // only at the first crossing, in count and in bytes alike.
  await runTransform(hooks, agedReasoningBundleFor(SESSION_ID))
  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
    ...SIBLING_FIRST_CROSSING_COUNTERS,
    processedContextBytes: 2 * AGED_REASONING_PROCESSED_CHARS,
    processedContextTokens: tokensForChars(2 * AGED_REASONING_PROCESSED_CHARS),
  })
})

test("sibling sessions expiring identical cold reasoning content each count their own first crossings", async () => {
  const hooks = await loadPluginHooks()

  await runTransform(hooks, agedReasoningBundleFor(SESSION_ID))
  await runTransform(hooks, agedReasoningBundleFor(SESSION_ID_B))

  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), SIBLING_FIRST_CROSSING_COUNTERS)
  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID_B)), SIBLING_FIRST_CROSSING_COUNTERS)
})

const SIBLING_REPEATED_STANDING_COUNTERS = {
  ...SIBLING_FIRST_CROSSING_COUNTERS,
  processedContextBytes: (REPEATED_STANDING_RUNS + 1) * AGED_REASONING_PROCESSED_CHARS,
  processedContextTokens: tokensForChars((REPEATED_STANDING_RUNS + 1) * AGED_REASONING_PROCESSED_CHARS),
}

test("sibling reasoning counters stay isolated across interleaved repeated standing runs", async () => {
  const hooks = await loadPluginHooks()

  await runTransform(hooks, agedReasoningBundleFor(SESSION_ID))
  await runTransform(hooks, agedReasoningBundleFor(SESSION_ID_B))
  for (let round = 0; round < REPEATED_STANDING_RUNS; round += 1) {
    await runTransform(hooks, agedReasoningBundleFor(SESSION_ID))
    await runTransform(hooks, agedReasoningBundleFor(SESSION_ID_B))
  }

  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), SIBLING_REPEATED_STANDING_COUNTERS)
  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID_B)), SIBLING_REPEATED_STANDING_COUNTERS)
})

test("context_stats reports only the calling session's reasoning counters", async () => {
  const hooks = await loadPluginHooks()

  await runTransform(hooks, agedReasoningBundleFor(SESSION_ID))
  await runTransform(hooks, buildBundle(fillerMessages(), SESSION_ID_B))

  const sessionStats = await readStats(hooks, SESSION_ID)
  assert.equal(sessionStats["session"], SESSION_ID)
  assert.deepEqual(countersOf(sessionStats), SIBLING_FIRST_CROSSING_COUNTERS)
  const siblingStats = await readStats(hooks, SESSION_ID_B)
  assert.equal(siblingStats["session"], SESSION_ID_B)
  assert.deepEqual(countersOf(siblingStats), {
    ...STATS_ZEROED_COUNTERS,
    processedContextBytes: AGED_REASONING_PROCESSED_CHARS,
    processedContextTokens: tokensForChars(AGED_REASONING_PROCESSED_CHARS),
  })
})

test("context_stats counts identical-content reasoning parts once in the unique count and credits their bytes once", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [reasoningPart(REASONING_COLD_TEXT)],
    ...fillerMessages(),
    [reasoningPart(REASONING_COLD_TEXT)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const counters = countersOf(await readStats(hooks, SESSION_ID))
  assert.equal(counters.reasoningExpiredUnique, EXPIRED_REASONING_SINGLE_COUNT)
  assert.equal(counters.reasoningBytesExpiredUnique, REASONING_COLD_TEXT.length)
  assert.equal(counters.reasoningTokensSaved, tokensForChars(REASONING_COLD_TEXT.length))
})

test("context_stats leaves reasoning counters at zero when a pressured session has no reasoning parts", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, "/data/no-reasoning.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    processedContextBytes: 486,
    processedContextTokens: tokensForChars(486),
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
      reasoningExpiredUnique: EXPIRED_REASONING_SINGLE_COUNT,
      reasoningBytesExpiredUnique: REASONING_COLD_TEXT.length,
      reasoningTokensSaved: tokensForChars(REASONING_COLD_TEXT.length),
      processedContextBytes: 50,
      processedContextTokens: tokensForChars(50),
    })
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

// The composition-known bundle both composition tests run: 17 messages, the
// recent window covering the last 4 (indices 13-16). Construction with
// distinct paths so each pass's effect is countable:
// - msg0: aged reasoning (expired, its bytes leave the list) + a 4000-byte
//   read of A; msg4's read of A has identical input, so dedup tombstones
//   msg0's output into a 77-char tombstone naming message 4, which stays
//   inside the tool pool
// - msg8: a 3000-byte read of B at (100,150), contained in msg13's (90,180)
//   read of B -> range collapse tombstones it as a 141-char text part,
//   leaving msg13's 3500 live
// - msg13 sits inside the recent window, so its reasoning part survives and
//   reasoningInWindowBytes counts it
const compositionKnownBundle = (): StrictBundle => {
  const compositionTextMessages = (count: number): MessagePart[][] =>
    Array.from({ length: count }, () => [textPart(textOfChars(COMPOSITION_TEXT_CHARS))])
  return buildBundle([
    [reasoningPart(REASONING_COLD_TEXT), completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: COMPOSITION_PATH_A, [OFFSET_INPUT_KEY]: 100, [LIMIT_INPUT_KEY]: 50 }, outputOfBytes(COMPOSITION_TOOL_COLD_BYTES))],
    ...compositionTextMessages(1),
    ...fillerMessages(2),
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: COMPOSITION_PATH_A, [OFFSET_INPUT_KEY]: 100, [LIMIT_INPUT_KEY]: 50 }, outputOfBytes(COMPOSITION_TOOL_RETAINED_BYTES))],
    ...compositionTextMessages(1),
    ...fillerMessages(2),
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: COMPOSITION_PATH_B, [OFFSET_INPUT_KEY]: 100, [LIMIT_INPUT_KEY]: 50 }, outputOfBytes(COMPOSITION_TOOL_CONTAINED_BYTES))],
    ...compositionTextMessages(1),
    ...fillerMessages(2),
    ...compositionTextMessages(1),
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: COMPOSITION_PATH_B, [OFFSET_INPUT_KEY]: 90, [LIMIT_INPUT_KEY]: 90 }, outputOfBytes(COMPOSITION_TOOL_RETAINED_BYTES)), reasoningPart(COMPOSITION_WINDOWED_REASONING_TEXT)],
    ...fillerMessages(3),
  ])
}

// Post-pass arithmetic asserted by the composition test: toolPoolBytes =
// 3500 + 3500 + 77 (the dedup tombstone naming message 4), textChars =
// 4 x 240 + 9 x 10 + 141 (the range-collapse tombstone as a text part),
// reasoningInWindowBytes = 24.
test("metrics line carries the post-transform composition fields on a known bundle", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWith({ metricsLog: true, metricsPath, manualMode: true })
    await setContextLimit(hooks, SESSION_ID, LARGE_DEFAULT_CONTEXT_TOKENS)

    const bundle = compositionKnownBundle()
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    // toolPool: the two retained reads plus the dedup tombstone (naming
    // the retained copy at message 4) that replaced msg0's 4000 bytes.
    const dedupTombstoneBytes = dedupTombstoneFor(READ_TOOL, COMPOSITION_RETAINED_MSG_INDEX).length
    assert.equal(lines[0].toolPoolBytes, COMPOSITION_TOOL_RETAINED_BYTES * COMPOSITION_TOOL_RETAINED_COUNT + dedupTombstoneBytes)
    assert.equal(lines[0].textChars, COMPOSITION_TEXT_CHARS * COMPOSITION_TEXT_MESSAGE_COUNT + fillerMessagesChars(9) + COMPOSITION_COLLAPSE_TOMBSTONE_CHARS)
    assert.equal(lines[0].reasoningInWindowBytes, COMPOSITION_WINDOWED_REASONING_TEXT.length)
    assert.equal(lines[0].dedupedThisRun, DEDUP_TOMBSTONE_SINGLE_COUNT)
    assert.equal(lines[0].reasoningExpiredThisRun, EXPIRED_REASONING_SINGLE_COUNT)

    const stats = await readStats(hooks, SESSION_ID)
    const composition = stats.composition as Record<string, unknown>
    assert.ok(composition !== undefined)
    assert.equal(composition.toolPoolBytes, lines[0].toolPoolBytes)
    assert.equal(composition.textChars, lines[0].textChars)
    assert.equal(composition.reasoningInWindowBytes, COMPOSITION_WINDOWED_REASONING_TEXT.length)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics totals accumulate the post-transform processed context chars across runs and derive their token estimate", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, { manualMode: true })
    await setContextLimit(hooks, SESSION_ID, LARGE_DEFAULT_CONTEXT_TOKENS)

    // The composition-known bundle from the composition test above: its
    // post-transform toolPoolBytes and textChars are asserted field for
    // field there, so the processed-context total must equal their sum.
    const bundle = compositionKnownBundle()
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    const firstRunChars = (lines[0].toolPoolBytes as number) + (lines[0].textChars as number)
    assert.ok(firstRunChars > 0)
    assert.deepEqual(lines[0].totals, {
      ...STATS_ZEROED_COUNTERS,
      deduped: DEDUP_TOMBSTONE_SINGLE_COUNT,
      dedupedBytes: COMPOSITION_TOOL_COLD_BYTES,
      dedupedUnique: DEDUP_TOMBSTONE_SINGLE_COUNT,
      dedupTokensSaved: tokensForChars(COMPOSITION_TOOL_COLD_BYTES),
      collapsedWindows: DEDUP_TOMBSTONE_SINGLE_COUNT,
      collapsedWindowBytes: COMPOSITION_TOOL_CONTAINED_BYTES,
      collapsedWindowTokensSaved: tokensForChars(COMPOSITION_TOOL_CONTAINED_BYTES),
      reasoningExpiredUnique: EXPIRED_REASONING_SINGLE_COUNT,
      reasoningBytesExpiredUnique: REASONING_COLD_TEXT.length,
      reasoningTokensSaved: tokensForChars(REASONING_COLD_TEXT.length),
      processedContextBytes: firstRunChars,
      processedContextTokens: tokensForChars(firstRunChars),
    })
    const snapshotTotals = snapshotBodyOf(stateDir, SESSION_ID).snapshot.totals as Record<string, number>
    assert.equal(snapshotTotals.processedContextBytes, firstRunChars)
    assert.equal(snapshotTotals.processedContextTokens, tokensForChars(firstRunChars))

    // A second run accumulates on top of the first: the manual stand-down
    // keeps the whole standard bundle in the composition, and the quiet
    // run writes no line while the counter and the snapshot still move.
    await runTransform(hooks, buildStandardBundle(SESSION_ID, "/data/processed-second.txt"))
    const cumulativeChars = firstRunChars + STANDARD_BUNDLE_CHARS
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)
    const counters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(counters.processedContextBytes, cumulativeChars)
    assert.equal(counters.processedContextTokens, tokensForChars(cumulativeChars))
    const cumulativeSnapshot = snapshotBodyOf(stateDir, SESSION_ID).snapshot.totals as Record<string, number>
    assert.equal(cumulativeSnapshot.processedContextBytes, cumulativeChars)
    assert.equal(cumulativeSnapshot.processedContextTokens, tokensForChars(cumulativeChars))
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("metrics composition counts escape bytes and live attachment bytes on a known bundle", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWith({ metricsLog: true, metricsPath, manualMode: true })

    // Two reads of the same path with identical inputs: the older output
    // carries a CSI span and an OSC span, and the newer output's length
    // clears the dedup floor, so dedup supersedes the older output and
    // its escape spans leave the post-transform view. escapeBytes counts
    // only the newer output's CSI span, and attachmentBytes counts the
    // live attachment url payloads (tool-state attachment plus file-part
    // url). The dedup tombstone makes the run eventful, so the line
    // lands.
    const olderOutput = `${COMPOSITION_CSI_SPAN}${outputOfBytes(COMPOSITION_ESCAPE_TAIL_BYTES)}${COMPOSITION_OSC_SPAN}`
    const newerOutput = `${COMPOSITION_CSI_SPAN}${outputOfBytes(COMPOSITION_ESCAPE_NEWER_PLAIN_BYTES)}`
    const textMessages = (count: number): MessagePart[][] => Array.from({ length: count }, () => [textPart(textOfChars(COMPOSITION_TEXT_CHARS))])
    const bundle = buildBundle([
      [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: COMPOSITION_ESCAPE_PATH }, olderOutput)],
      ...textMessages(1),
      ...fillerMessages(2),
      ...textMessages(1),
      ...fillerMessages(2),
      ...textMessages(1),
      ...fillerMessages(2),
      [
        completedToolPartWithAttachments(READ_TOOL, { [PATH_INPUT_KEY]: COMPOSITION_ESCAPE_PATH }, newerOutput, [
          attachmentItemOf(ATTACHMENT_MIME_PNG, COMPOSITION_ATTACHMENT_PAYLOAD_CHARS, "comp"),
        ]),
        fileAttachmentPart(ATTACHMENT_MIME_PNG, attachmentUrlOf(ATTACHMENT_MIME_PNG, COMPOSITION_FILE_URL_PAYLOAD_CHARS), COMPOSITION_FILE_FILENAME),
        reasoningPart(COMPOSITION_WINDOWED_REASONING_TEXT),
      ],
      ...fillerMessages(3),
    ])
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].dedupedThisRun, DEDUP_TOMBSTONE_SINGLE_COUNT)
    // The older output (CSI + OSC spans) left with its tombstone; only
    // the newer output's CSI span remains in the post-transform view.
    assert.equal(lines[0].escapeBytes, COMPOSITION_CSI_SPAN.length)
    const expectedAttachmentBytes =
      attachmentUrlOf(ATTACHMENT_MIME_PNG, COMPOSITION_ATTACHMENT_PAYLOAD_CHARS).length +
      attachmentUrlOf(ATTACHMENT_MIME_PNG, COMPOSITION_FILE_URL_PAYLOAD_CHARS).length
    assert.equal(lines[0].attachmentBytes, expectedAttachmentBytes)

    const stats = await readStats(hooks, SESSION_ID)
    const composition = stats.composition as Record<string, unknown>
    assert.equal(composition.escapeBytes, COMPOSITION_CSI_SPAN.length)
    assert.equal(composition.attachmentBytes, expectedAttachmentBytes)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("composition counts zero escape and attachment bytes once an attachment bearing output is evicted", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWith({ metricsLog: true, metricsPath })
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildBundle([
      [
        completedToolPartWithAttachments(READ_TOOL, { [PATH_INPUT_KEY]: COMPOSITION_ESCAPE_PATH }, outputOfBytes(MIN_EVICTABLE_BYTES), [
          attachmentItemOf(ATTACHMENT_MIME_PNG, COMPOSITION_ATTACHMENT_PAYLOAD_CHARS, "comp"),
        ]),
      ],
      ...fillerMessages(),
    ])
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].totals.evictions, COMPOSITION_EVICTED_RUN_COUNT)
    // Eviction replaced the output with a tombstone and stripped the state
    // attachments: with no escape sequences anywhere in the bundle, both
    // counts read zero on the post-transform view (an escape-carrying
    // output would keep its span bytes inside the tombstone's digest
    // preview, which the composition pass counts faithfully).
    assert.equal(lines[0].escapeBytes, 0)
    assert.equal(lines[0].attachmentBytes, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("composition fields stay off quiet runs and off context_stats before any run", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const stats = await readStats(await loadPluginHooksWith({ manualMode: true }), SESSION_ID)
    assert.equal(Object.hasOwn(stats, "composition"), false)

    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWith({ manualMode: true, metricsLog: true, metricsPath, liveStatePath: stateDir })
    await runTransform(hooks, buildBundle([[textPart(textOfChars(REHYDRA_PROBE_TEXT_CHARS))], ...fillerMessages(2)]))

    // The text-only run is quiet (nothing eventful), so no line lands and
    // the eventfulness gate stays the sole writer, composition included.
    assert.equal(existsSync(metricsPath), false)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
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
const ATTACHMENT_MESSAGE_ID = "msg_ctx_attachment"
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
  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    processedContextBytes: 504,
    processedContextTokens: tokensForChars(504),
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

test("context_stats counts a superseded duplicate's attachment payload chars in the dedup token-savings estimate", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([
    [attachedReadPart(ATTACHMENT_CALL_ID_OLDER, ATTACHMENT_PAYLOAD_CHARS_PRIMARY)],
    ...fillerMessages(2),
    [attachedReadPart(ATTACHMENT_CALL_ID_NEWER, ATTACHMENT_PAYLOAD_CHARS_SECONDARY)],
    ...fillerMessages(2),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    deduped: 1,
    dedupedBytes: MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS,
    dedupedUnique: 1,
    dedupTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS),
    processedContextBytes: 2165,
    processedContextTokens: tokensForChars(2165),
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

test("context_stats counts attachment payload characters in bytesReclaimed for an attachment bearing eviction", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([[attachedReadPart(ATTACHMENT_CALL_ID_COUNTED, ATTACHMENT_PAYLOAD_CHARS_PRIMARY)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS),
    processedContextBytes: 499,
    processedContextTokens: tokensForChars(499),
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
      processedContextBytes: 499,
      processedContextTokens: tokensForChars(499),
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
const FENCE_EVICTED_MARKER = "[ctx-evicted-fence]"
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
  assert.equal(
    await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID),
    stashMissFor(
      fenceFirstLineOf(FENCE_LINE_TAG),
      stashOccupancyLineFor([{ tool: FENCE_STASH_TOOL_LABEL, subject: fenceFirstLineOf(FENCE_LINE_TAG_B), msgIndex: 0 }]),
    ),
  )
})

test("transform leaves every user fenced block byte-identical while userFenceEviction stays disabled by default", async () => {
  const hooks = await loadPluginHooks()
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG), STASH_EMPTY_OCCUPANCY))
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
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG), STASH_EMPTY_OCCUPANCY))
})

test("transform keeps an all blank fenced block untouched no matter how many blank lines it holds", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, Array.from({ length: FENCE_OVER_LINES }, () => ""))
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await readEvicted(hooks, UNKNOWN_TARGET_LABEL, SESSION_ID), stashMissFor(UNKNOWN_TARGET_LABEL, STASH_EMPTY_OCCUPANCY))
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

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).fenceEvicted, fenceCount)
  assert.equal(countersOf(stats).stashDropped, 1)
  assert.deepEqual(stats.stash, { entries: STASH_LIMIT, capacity: STASH_LIMIT })
  assert.equal(
    await readEvicted(hooks, fenceFirstLineOf("block0"), SESSION_ID),
    stashMissFor(
      fenceFirstLineOf("block0"),
      stashOccupancyLineFor(
        Array.from({ length: STASH_LIMIT }, (_, index) => ({
          tool: FENCE_STASH_TOOL_LABEL,
          subject: fenceFirstLineOf(`block${index + 1}`),
          msgIndex: 0,
        })),
      ),
    ),
  )
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

  const stats = await readStats(hooks, SESSION_ID)
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

test("context_stats counts fence evictions in a distinct fenceEvicted counter without counting tool evictions", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`))

  const stats = await readStats(hooks, SESSION_ID)
  assert.deepEqual(countersOf(stats), {
    ...STATS_ZEROED_COUNTERS,
    fenceEvicted: 1,
    bytesReclaimed: block.length + FENCE_TRAILING_NEWLINE_CHARS,
    evictionTokensSaved: tokensForChars(block.length + FENCE_TRAILING_NEWLINE_CHARS),
    processedContextBytes: 275,
    processedContextTokens: tokensForChars(275),
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
      processedContextBytes: 275,
      processedContextTokens: tokensForChars(275),
    })
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

const loadPluginHooksWithCoalesce = async (metricsPath: string, intervalMs: number = METRICS_COALESCE_TEST_INTERVAL_MS, clock?: { now: () => number }): Promise<HookMap> =>
  loadPluginHooksWith({ metricsLog: true, metricsPath, metricsMinLineIntervalMs: intervalMs, ...(clock === undefined ? {} : { now: clock.now }) })

const reasoningOnlyBundle = (): StrictBundle =>
  buildBundle([[reasoningPart(REASONING_COLD_TEXT), pathToolPart(METRICS_COALESCE_QUIET_SUBJECT, APPEARANCE_ONLY_OUTPUT_BYTES)], ...fillerMessages()])

test("metrics log measures the coalesce interval from the previous flushed line not the last suppressed run", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const clock = fakeClock()
    const hooks = await loadPluginHooksWithCoalesce(metricsPath, METRICS_COALESCE_WRITE_ANCHOR_INTERVAL_MS, clock)

    // Runs at exactly 0, 150, 300, 500 ms of injected time against the
    // 400 ms window. Under write anchoring the fourth run sits past the
    // interval measured from the first flush and writes; under attempt
    // anchoring it would sit within 200 ms of the third run's suppressed
    // attempt and stay silent.
    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    clock.advanceMs(METRICS_COALESCE_WRITE_ANCHOR_FIRST_DELAY_MS)
    await runTransform(hooks, reasoningOnlyBundle())
    clock.advanceMs(METRICS_COALESCE_WRITE_ANCHOR_SECOND_DELAY_MS)
    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    clock.advanceMs(METRICS_COALESCE_WRITE_ANCHOR_FINAL_DELAY_MS)
    await runTransform(hooks, reasoningOnlyBundle())

    assert.equal(metricsLinesIn(metricsPath).length, METRICS_COALESCE_LINES_AFTER_ELAPSED)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log flushes when elapsed time equals the interval exactly", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const clock = fakeClock()
    const hooks = await loadPluginHooksWithCoalesce(metricsPath, METRICS_COALESCE_TEST_INTERVAL_MS, clock)

    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    // The suppression check is strictly less-than: elapsed exactly equal
    // to the interval is outside the window and flushes. Real sleeps could
    // never pin this boundary; the injected clock lands on it exactly.
    clock.advanceMs(METRICS_COALESCE_TEST_INTERVAL_MS)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_ELAPSED)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_ELAPSED - 1].reasoningExpiredThisRun, EXPIRED_REASONING_SINGLE_COUNT)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log coalesces a reasoning only run inside the interval and flushes one line after it", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const clock = fakeClock()
    const hooks = await loadPluginHooksWithCoalesce(metricsPath, METRICS_COALESCE_TEST_INTERVAL_MS, clock)

    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    clock.advanceMs(METRICS_COALESCE_TEST_INTERVAL_MS)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_ELAPSED)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_ELAPSED - 1].reasoningExpiredThisRun, EXPIRED_REASONING_SINGLE_COUNT)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_ELAPSED - 1].reasoningBytesExpiredThisRun, REASONING_COLD_TEXT.length)
    // The coalesced runs recount the standing part per request while the
    // lifetime totals hold at the first crossing's figures.
    const counters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(counters.reasoningExpiredUnique, EXPIRED_REASONING_SINGLE_COUNT)
    assert.equal(counters.reasoningBytesExpiredUnique, REASONING_COLD_TEXT.length)
    assert.equal(counters.reasoningTokensSaved, tokensForChars(REASONING_COLD_TEXT.length))
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log flushes immediately on an eviction inside the coalesce interval", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithCoalesce(metricsPath)
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    const bundle = buildStandardBundle(SESSION_ID, METRICS_COALESCE_EVICTION_SUBJECT)
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.deepEqual(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].evictedThisRun, [
      { tool: READ_TOOL, subject: METRICS_COALESCE_EVICTION_SUBJECT, bytes: MIN_EVICTABLE_BYTES, attachmentBytes: 0, messagesAgo: 5 },
    ])
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log flushes immediately on a dedup inside the coalesce interval", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithCoalesce(metricsPath)
    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    await runTransform(
      hooks,
      buildBundle([
        [pathToolPart(METRICS_COALESCE_DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
        ...fillerMessages(2),
        [pathToolPart(METRICS_COALESCE_DEDUP_PATH, THREE_ENTRY_OUTPUT_BYTES)],
        ...fillerMessages(2),
      ]),
    )

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].dedupedThisRun, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log with metricsMinLineIntervalMs zero keeps writing one line per eventful run", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithCoalesce(metricsPath, METRICS_COALESCING_DISABLED_MS)

    await runTransform(hooks, reasoningOnlyBundle())
    await runTransform(hooks, reasoningOnlyBundle())
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_COALESCE_RUN_COUNT)
    assert.equal(lines[METRICS_COALESCE_RUN_COUNT - 1].reasoningExpiredThisRun, EXPIRED_REASONING_SINGLE_COUNT)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log keeps stash read accounting correct across a suppressed then flushed sequence", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithCoalesce(metricsPath)
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    await runTransform(hooks, buildStandardBundle(SESSION_ID, METRICS_COALESCE_RELOAD_SUBJECT))
    assert.equal(await readEvicted(hooks, METRICS_COALESCE_RELOAD_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
    await runTransform(hooks, reasoningOnlyBundle())
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].stashReadsSinceLastLine, 1)

    assert.equal(await readEvicted(hooks, METRICS_COALESCE_RELOAD_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
    await runTransform(hooks, buildBundle([[textPart(textOfChars(FILLER_TEXT_CHARS))], ...fillerMessages(2)]))

    const flushedLines = metricsLinesIn(metricsPath)
    assert.equal(flushedLines.length, METRICS_COALESCE_LINES_AFTER_SPAN)
    assert.equal(flushedLines[METRICS_COALESCE_LINES_AFTER_SPAN - 1].stashReadsSinceLastLine, 1)
    assert.deepEqual(flushedLines[METRICS_COALESCE_LINES_AFTER_SPAN - 1].evictedThisRun, [])
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).stashHits, METRICS_COALESCE_STASH_HIT_COUNT)
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).stashMisses, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log flushes a coalesced session when the budget source changes mid sitting", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithCoalesce(metricsPath)
    await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, LARGE_DEFAULT_CONTEXT_TOKENS)

    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)
    assert.equal(metricsLinesIn(metricsPath)[0].modelContextTokens, LARGE_DEFAULT_CONTEXT_TOKENS)
    assert.equal(metricsLinesIn(metricsPath)[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)

    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    // A chat.params event from another model without a limit invalidates
    // the stored capture, so the budget source changes model to unknown.
    await setChatParamsForModel(hooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID, undefined)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].modelContextTokens, null)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].reasoningExpiredThisRun, EXPIRED_REASONING_SINGLE_COUNT)
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
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG), STASH_EMPTY_OCCUPANCY))
})

test("transform never closes a fence span on a four space indented fence line", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const contentLines = fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG)
  contentLines.push(`${FENCE_INDENT_FOUR_SPACES}${FENCE_TICKS}`)
  const text = `${FENCE_PROSE_BEFORE}\n${FENCE_TICKS}${FENCE_LANGUAGE_TS}\n${contentLines.join("\n")}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG), STASH_EMPTY_OCCUPANCY))
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
  assert.equal(await readEvicted(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG), STASH_EMPTY_OCCUPANCY))
})

const MANUAL_MODE_INVALID_VALUE = "yes"
const MANUAL_FALSE_PIN_SUBJECT = "/data/manual-false-pin.txt"
const MANUAL_PRESSURE_SUBJECT = "/data/manual-pressure.txt"
const MANUAL_DEFAULT_BUDGET_SUBJECT = "/data/manual-default-budget.txt"
const DRY_RUN_SECOND_PATH = "/data/dry-run-second.txt"
const COMPOSITION_TEXT_CHARS = 240
const COMPOSITION_WINDOWED_REASONING_TEXT = "windowed reasoning block"
const COMPOSITION_TEXT_MESSAGE_COUNT = 4
const COMPOSITION_TOOL_RETAINED_COUNT = 2
const COMPOSITION_TOOL_COLD_BYTES = 4000
const COMPOSITION_TOOL_RETAINED_BYTES = 3500
const COMPOSITION_TOOL_CONTAINED_BYTES = 3000
const COMPOSITION_PATH_A = "/data/composition-a.txt"
const COMPOSITION_PATH_B = "/data/composition-b.txt"
const COMPOSITION_ESCAPE_PATH = "/data/composition-escape.txt"
const COMPOSITION_ATTACHMENT_PAYLOAD_CHARS = 1200
const COMPOSITION_FILE_URL_PAYLOAD_CHARS = 900
const COMPOSITION_FILE_FILENAME = "composition-image.png"
const COMPOSITION_CSI_SPAN = "\x1b[38;5;196m"
const COMPOSITION_OSC_SPAN = "\x1b]0;composition\x07"
const COMPOSITION_ESCAPE_TAIL_BYTES = 2100
const COMPOSITION_ESCAPE_NEWER_PLAIN_BYTES = 2200
const COMPOSITION_EVICTED_RUN_COUNT = 1
const COMPOSITION_RETAINED_MSG_INDEX = 4
const DEDUP_TOMBSTONE_SINGLE_COUNT = 1
const COMPOSITION_COLLAPSE_TOMBSTONE_CHARS = 141

const fillerMessagesChars = (count: number): number => count * FILLER_TEXT_CHARS
const MANUAL_OVERRIDE_BUDGET_SUBJECT = "/data/manual-override-budget.txt"
const MANUAL_CAPTURED_LIMIT_SUBJECT = "/data/manual-captured-limit.txt"
const MANUAL_HINT_SUBJECT = "/data/manual-hint.txt"
const MANUAL_STATS_SUBJECT = "/data/manual-stats.txt"
const MANUAL_INVALID_SUBJECT = "/data/manual-invalid.txt"
const MANUAL_UNWATERMARKED_SUBJECT = "/data/manual-unwatermarked.txt"
const MANUAL_ARMED_WATERMARK_TOKENS = WATERMARK_PROBE_CONTEXT_LIMIT * WATERMARK_RATIO
const MANUAL_ARMED_DEFICIT_TOKENS = tokensForChars(STANDARD_BUNDLE_CHARS) - MANUAL_ARMED_WATERMARK_TOKENS
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

  const stats = await readStats(hooks, SESSION_ID)
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

test("the compacting hook appends hot subjects and the stash note for a session with recorded evictions", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.equal(output.context.length, 2)
  assert.equal(output.context[0], hintLineFor([HINT_RENDERED_SUBJECT]))
  assert.ok(output.context[1].startsWith(COMPACTION_BLOCK_MARKER))
  assert.ok(output.context[1].includes(RELOAD_TOOL_NAME))
  assert.ok(output.context[1].includes(HINT_RENDERED_SUBJECT))
})

test("the compacting hook attaches nothing for an unknown session", async () => {
  const hooks = await loadPluginHooks()
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: "ctx-never-seen-session" }, output)

  assert.equal(output.context.length, 0)
})

test("the compacting hook attaches nothing when the metrics entry carries no subjects", async () => {
  const hooks = await loadPluginHooks()

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.equal(output.context.length, 0)
})

test("a throwing compaction enrichment degrades to an unmodified prompt with lastFault set", async () => {
  const hooks = await loadPluginHooksWith({
    faultCompaction: () => { throw new Error(COMPACTION_FAULT_MESSAGE) },
  })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: ["keep me"] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.deepEqual(output.context, ["keep me"])
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal((stats.lastFault as Record<string, unknown>).message, COMPACTION_FAULT_MESSAGE)
})

test("the compaction block respects the subject bound", async () => {
  const hooks = await loadPluginHooksWith({ hintSubjects: COMPACTION_SUBJECT_BOUND })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  for (const subject of COMPACTION_BOUND_SUBJECTS) {
    await runTransform(hooks, buildStandardBundle(SESSION_ID, subject))
  }

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  const hotLine = output.context.find((entry) => entry.startsWith(HINT_MARKER))
  assert.ok(hotLine !== undefined)
  const listedSubjects = hotLine.slice(HINT_MARKER.length + HINT_LABEL.length + 2).split(HINT_SUBJECT_SEPARATOR)
  assert.equal(listedSubjects.length, COMPACTION_SUBJECT_BOUND)
})

test("the compacting hook attaches nothing when hintSubjects is 0 even with a populated stash", async () => {
  const hooks = await loadPluginHooksWith({ hintSubjects: 0 })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.equal(output.context.length, 0)
})

test("the compacting hook attaches only the stash note when the session remembers no evicted subjects but holds stashed outputs", async () => {
  const hooks = await loadPluginHooksWith({ rememberedEvictedSubjects: 0 })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.equal(output.context.length, 1)
  assert.ok(output.context[0].startsWith(COMPACTION_BLOCK_MARKER))
  assert.ok(output.context[0].includes(RELOAD_TOOL_NAME))
})

test("the stash note dedupes repeated subjects and caps at the subject bound, newest first", async () => {
  const hooks = await loadPluginHooksWith({ hintSubjects: COMPACTION_SUBJECT_BOUND })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(COMPACTION_STASH_BUNDLE_CHARS, tokensForChars(THREE_ENTRY_OUTPUT_BYTES) * 2 + 1))

  const bundle = buildBundle([
    [pathToolPart(COMPACTION_STASH_DUP_SUBJECT, THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart(COMPACTION_STASH_DUP_SUBJECT, THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart(COMPACTION_STASH_NEWEST_SUBJECT, THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart(COMPACTION_STASH_HELD_SUBJECT, THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  const note = output.context.find((entry) => entry.startsWith(COMPACTION_BLOCK_MARKER))
  assert.ok(note !== undefined)
  const listedSubjects = note.slice(note.indexOf(`${STASH_NOTE_SUBJECTS_LEAD}: `) + STASH_NOTE_SUBJECTS_LEAD.length + 2).split(HINT_SUBJECT_SEPARATOR)
  assert.deepEqual(listedSubjects, [COMPACTION_STASH_NEWEST_SUBJECT, COMPACTION_STASH_DUP_SUBJECT])
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
})

test("a frozen context array degrades through the fault boundary with the native prompt left unmodified", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: Object.freeze([] as string[]) }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.equal(output.context.length, 0)
  const stats = await readStats(hooks, SESSION_ID)
  const lastFault = stats.lastFault as Record<string, unknown>
  assert.equal(typeof lastFault.message, "string")
  assert.ok((lastFault.message as string).length > 0)
})

test("the compacting hook returns silently when the output carries no context array", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, {})
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, { context: "not an array" })

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.lastFault, undefined)
})

const HYGIENE_HOOK = "tool.execute.after"
const HYGIENE_TOOL_NAME = "bash"
const HYGIENE_CALL_ID = "ctx-hygiene-call"
const HYGIENE_TITLE = "pytest -q"
const HYGIENE_CSI_COLOR_SPAN = "\x1b[38;5;196m"
const HYGIENE_CSI_RESET_SPAN = "\x1b[0m"
const HYGIENE_OSC_TITLE_SPAN = "\x1b]0;building\x07"
const HYGIENE_OSC_LINK_OPEN_SPAN = "\x1b]8;;http://example.com\x1b\\"
const HYGIENE_OSC_LINK_CLOSE_SPAN = "\x1b]8;;\x1b\\"
const HYGIENE_LINK_TEXT = "click here"
const HYGIENE_DIRTY_OUTPUT = [
  `${HYGIENE_CSI_COLOR_SPAN}ERR${HYGIENE_CSI_RESET_SPAN} 10%\r20%\rdone  `,
  `${HYGIENE_OSC_TITLE_SPAN}next`,
  "  padded   ",
  `${HYGIENE_OSC_LINK_OPEN_SPAN}${HYGIENE_LINK_TEXT}${HYGIENE_OSC_LINK_CLOSE_SPAN}`,
  "",
].join("\n")
const HYGIENE_STRIPPED_OUTPUT = ["done", "next", "  padded", HYGIENE_LINK_TEXT, ""].join("\n")
const HYGIENE_FAULT_MESSAGE = "hygiene hook exploded"
const HYGIENE_METADATA = { attachments: [{ type: "file", url: "file:///tmp/report.png" }], exitCode: 0 }
const blockedHygienePathIn = (dir: string): string => join(dir, METRICS_BLOCKED_DIR_NAME, HYGIENE_LOG_BASENAME)
const rotatedHygienePathIn = (dir: string): string => join(dir, `${HYGIENE_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`)

const runHygieneHook = async (hooks: HookMap, outputText: string): Promise<{ title: string; output: string; metadata: Record<string, unknown> }> => {
  const output = { title: HYGIENE_TITLE, output: outputText, metadata: HYGIENE_METADATA }
  await hooks[HYGIENE_HOOK]({ tool: HYGIENE_TOOL_NAME, sessionID: SESSION_ID, callID: HYGIENE_CALL_ID }, output)
  return output
}

test("the hygiene hook strips CSI and OSC spans collapses CR progress lines and trims trailing whitespace runs", async () => {
  const hooks = await loadPluginHooksWith({ ingestionHygieneCopy: false })

  const output = await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

  assert.equal(output.output, HYGIENE_STRIPPED_OUTPUT)
})

test("the hygiene hook passes a clean output through byte-identical and writes no copy", async () => {
  const hygieneDir = makeMetricsDir()
  const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
  const hooks = await loadPluginHooksWith({ ingestionHygienePath: hygienePath })

  const output = await runHygieneHook(hooks, HYGIENE_STRIPPED_OUTPUT)

  assert.equal(output.output, HYGIENE_STRIPPED_OUTPUT)
  assert.equal(existsSync(hygienePath), false)
  cleanupMetricsDir(hygieneDir)
})

test("the hygiene hook writes the copy with the original preserved before the rewrite lands", async () => {
  const hygieneDir = makeMetricsDir()
  const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
  const hooks = await loadPluginHooksWith({ ingestionHygieneCopy: true, ingestionHygienePath: hygienePath })

  const output = await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

  assert.equal(output.output, HYGIENE_STRIPPED_OUTPUT)
  const [copyLine] = readFileSync(hygienePath, "utf8").split(METRICS_LINE_SEPARATOR)
  const copy = JSON.parse(copyLine) as Record<string, unknown>
  assert.equal(copy.tool, HYGIENE_TOOL_NAME)
  assert.equal(copy.title, HYGIENE_TITLE)
  assert.equal(copy.session, SESSION_ID)
  assert.equal(copy.originalChars, HYGIENE_DIRTY_OUTPUT.length)
  assert.equal(copy.strippedChars, HYGIENE_STRIPPED_OUTPUT.length)
  assert.equal(copy.output, HYGIENE_DIRTY_OUTPUT)
  cleanupMetricsDir(hygieneDir)
})

test("a hygiene copy write failure degrades to hygieneWriteError with the strip still applied", async () => {
  const hygieneDir = makeMetricsDir()
  const hooks = await loadPluginHooksWith({ ingestionHygieneCopy: true, ingestionHygienePath: blockedHygienePathIn(hygieneDir) })

  const output = await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

  assert.equal(output.output, HYGIENE_STRIPPED_OUTPUT)
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(typeof stats.hygieneWriteError, "string")
  assert.ok((stats.hygieneWriteError as string).length > 0)
  cleanupMetricsDir(hygieneDir)
})

test("a throwing hygiene hook degrades to the original output with lastFault set", async () => {
  const hygieneDir = makeMetricsDir()
  const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
  const hooks = await loadPluginHooksWith({
    faultHygiene: () => {
      throw new Error(HYGIENE_FAULT_MESSAGE)
    },
    ingestionHygienePath: hygienePath,
  })

  const output = await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

  assert.equal(output.output, HYGIENE_DIRTY_OUTPUT)
  assert.equal(existsSync(hygienePath), false)
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal((stats.lastFault as Record<string, unknown>).message, HYGIENE_FAULT_MESSAGE)
  cleanupMetricsDir(hygieneDir)
})

test("the hygiene hook never touches the title or metadata and records the title in the copy", async () => {
  const hygieneDir = makeMetricsDir()
  const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
  const hooks = await loadPluginHooksWith({ ingestionHygieneCopy: true, ingestionHygienePath: hygienePath })

  const output = await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

  assert.equal(output.title, HYGIENE_TITLE)
  assert.equal(output.metadata, HYGIENE_METADATA)
  const copy = JSON.parse(readFileSync(hygienePath, "utf8").split(METRICS_LINE_SEPARATOR)[0]) as Record<string, unknown>
  assert.deepEqual(copy.title, HYGIENE_TITLE)
  assert.deepEqual((copy as { metadata?: unknown }).metadata, undefined)
  cleanupMetricsDir(hygieneDir)
})

test("the ingestionHygiene opt-out leaves a dirty output unchanged and writes no copy", async () => {
  const hygieneDir = makeMetricsDir()
  const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
  const hooks = await loadPluginHooksWith({ ingestionHygiene: false, ingestionHygienePath: hygienePath })

  const output = await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

  assert.equal(output.output, HYGIENE_DIRTY_OUTPUT)
  assert.equal(existsSync(hygienePath), false)
  cleanupMetricsDir(hygieneDir)
})

test("ingestionHygieneCopy false strips the output without writing a copy", async () => {
  const hygieneDir = makeMetricsDir()
  const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
  const hooks = await loadPluginHooksWith({ ingestionHygieneCopy: false, ingestionHygienePath: hygienePath })

  const output = await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

  assert.equal(output.output, HYGIENE_STRIPPED_OUTPUT)
  assert.equal(existsSync(hygienePath), false)
  cleanupMetricsDir(hygieneDir)
})

test("ingestionHygieneCopy resolves to the enabled production default when the option is unset", async () => {
  const hygieneDir = makeMetricsDir()
  const hooks = (await contextManagerFactory({}, { metricsLog: false, liveStateLog: false, ingestionHygienePath: join(hygieneDir, HYGIENE_LOG_BASENAME) })) as HookMap

  const stats = await readStats(hooks, SESSION_ID)

  assert.equal((stats.options as Record<string, unknown>).ingestionHygieneCopy, true)
  cleanupMetricsDir(hygieneDir)
})

test("the hygiene hook passes a CRLF-terminated output through byte-identical", async () => {
  const hygieneDir = makeMetricsDir()
  const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
  const hooks = await loadPluginHooksWith({ ingestionHygienePath: hygienePath })
  const crlfOutput = "line one\r\nline two\r\n"

  const output = await runHygieneHook(hooks, crlfOutput)

  assert.equal(output.output, crlfOutput)
  assert.equal(existsSync(hygienePath), false)
  cleanupMetricsDir(hygieneDir)
})

test("the hygiene hook collapses progress segments before a CRLF terminator while keeping the terminator", async () => {
  const hooks = await loadPluginHooksWith({ ingestionHygieneCopy: false })

  const output = await runHygieneHook(hooks, `10%\r20%\rdone\r\nnext\n`)

  assert.equal(output.output, "done\r\nnext\n")
})

test("ingestionHygieneRotationMaxBytes zero disables the copy but not the strip", async () => {
  const hygieneDir = makeMetricsDir()
  const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
  const hooks = await loadPluginHooksWith({ ingestionHygieneCopy: true, ingestionHygienePath: hygienePath, ingestionHygieneRotationMaxBytes: 0 })

  const output = await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

  assert.equal(output.output, HYGIENE_STRIPPED_OUTPUT)
  assert.equal(existsSync(hygienePath), false)
  cleanupMetricsDir(hygieneDir)
})

test("the hygiene log rotates to the .1 sibling when an append would cross ingestionHygieneRotationMaxBytes", async () => {
  const hygieneDir = makeMetricsDir()
  try {
    const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
    const probeHooks = await loadPluginHooksWith({ ingestionHygieneCopy: true, ingestionHygienePath: hygienePath })
    await runHygieneHook(probeHooks, HYGIENE_DIRTY_OUTPUT)
    const capBytes = statSync(hygienePath).size
    rmSync(hygienePath)

    const hooks = await loadPluginHooksWith({ ingestionHygieneCopy: true, ingestionHygienePath: hygienePath, ingestionHygieneRotationMaxBytes: capBytes })
    await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

    assert.equal(existsSync(rotatedHygienePathIn(hygieneDir)), false)
    assert.equal(statSync(hygienePath).size, capBytes)

    await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

    const rotatedLines = readFileSync(rotatedHygienePathIn(hygieneDir), "utf8").split(METRICS_LINE_SEPARATOR)
    assert.equal(rotatedLines.length, 2)
    assert.equal((JSON.parse(rotatedLines[0]) as Record<string, unknown>).output, HYGIENE_DIRTY_OUTPUT)
    const freshLines = readFileSync(hygienePath, "utf8").split(METRICS_LINE_SEPARATOR)
    assert.equal(freshLines.length, 2)
    assert.equal((JSON.parse(freshLines[0]) as Record<string, unknown>).output, HYGIENE_DIRTY_OUTPUT)
  } finally {
    cleanupMetricsDir(hygieneDir)
  }
})

test("a frozen hygiene output object degrades through the fault boundary with the output intact", async () => {
  const hygieneDir = makeMetricsDir()
  const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
  const hooks = await loadPluginHooksWith({ ingestionHygienePath: hygienePath })

  const output = Object.freeze({ title: HYGIENE_TITLE, output: HYGIENE_DIRTY_OUTPUT, metadata: HYGIENE_METADATA })
  await hooks[HYGIENE_HOOK]({ tool: HYGIENE_TOOL_NAME, sessionID: SESSION_ID, callID: HYGIENE_CALL_ID }, output)

  assert.equal(output.output, HYGIENE_DIRTY_OUTPUT)
  const stats = await readStats(hooks, SESSION_ID)
  const lastFault = stats.lastFault as Record<string, unknown>
  assert.equal(typeof lastFault.message, "string")
  assert.ok((lastFault.message as string).length > 0)
  cleanupMetricsDir(hygieneDir)
})

const agedBundle = (): StrictBundle => buildBundle([[pathToolPart(AGED_READ_PATH, MIN_EVICTABLE_BYTES)], ...fillerMessages(AGED_FILLER_COUNT)])

test("an aged read older than the threshold evicts with no budget captured and credits the counters", async () => {
  const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: AGED_EVICTION_MESSAGES })

  const bundle = agedBundle()
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(await readEvicted(hooks, AGED_READ_PATH, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).evictions, 1)
  assert.equal(countersOf(stats).bytesReclaimed, MIN_EVICTABLE_BYTES)
  assert.equal(countersOf(stats).evictionTokensSaved, tokensForChars(MIN_EVICTABLE_BYTES))
  const lastRun = stats.lastRun as Record<string, unknown>
  assert.equal(lastRun.watermarkTokens, null)
  assert.equal(lastRun.deficitTokens, null)
})

test("a re-touched aged read survives aged eviction while its message index is ancient", async () => {
  const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: AGED_EVICTION_MESSAGES })

  const bundle = buildBundle([
    [rangeReadPart(AGED_RETOUCHED_PATH, 0, 10, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(AGED_FILLER_COUNT - 1),
    [rangeReadPart(AGED_RETOUCHED_PATH, AGED_RETOUCH_OFFSET, 10, MIN_EVICTABLE_BYTES)],
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(bundle.messages[6], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await readEvicted(hooks, AGED_RETOUCHED_PATH, SESSION_ID), stashMissFor(AGED_RETOUCHED_PATH, STASH_EMPTY_OCCUPANCY))
})

test("a read inside the recent window survives aged eviction despite passing the age threshold", async () => {
  const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: AGED_EVICTION_MESSAGES })

  const bundle = buildBundle([
    ...textMessages(2, FILLER_TEXT_CHARS),
    [pathToolPart(AGED_READ_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(3),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[2], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, 0)
})

test("an aged read below minEvictableBytes survives aged eviction", async () => {
  const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: AGED_EVICTION_MESSAGES })

  const bundle = buildBundle([[pathToolPart(AGED_READ_PATH, MIN_EVICTABLE_BYTES - 1)], ...fillerMessages(AGED_FILLER_COUNT)])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES - 1))
  assert.equal(await readEvicted(hooks, AGED_READ_PATH, SESSION_ID), stashMissFor(AGED_READ_PATH, STASH_EMPTY_OCCUPANCY))
})

test("an aged read matching a protected pattern survives aged eviction", async () => {
  const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: AGED_EVICTION_MESSAGES, protectedPatterns: [AGED_PROTECTED_GLOB] })

  const bundle = buildBundle([[pathToolPart(AGED_PROTECTED_PATH, MIN_EVICTABLE_BYTES)], ...fillerMessages(AGED_FILLER_COUNT)])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, 0)
})

test("manual mode with the aged option reports the aged tier in the dry run without mutating", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true, agedReadEvictionMessages: AGED_EVICTION_MESSAGES })
  await setContextLimit(hooks, SESSION_ID, contextForWatermarkTokens(tokensForChars(AGED_BUNDLE_CHARS) + HEADROOM_TOKENS))

  const bundle = agedBundle()
  await runTransform(hooks, bundle)

  const dryRun = (await readStats(hooks, SESSION_ID)).dryRun as Record<string, unknown>
  assert.equal(dryRun.wouldEvictCount, 1)
  assert.equal(dryRun.wouldEvictBytes, MIN_EVICTABLE_BYTES)
  assert.deepEqual(dryRun.wouldEvictSubjects, [AGED_READ_PATH])
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("the default configuration leaves a bundle that would age out intact", async () => {
  const hooks = await loadPluginHooks()

  const bundle = agedBundle()
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, 0)
})

test("the aged tier and the watermark tier evict each output exactly once in a single walk", async () => {
  const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: AGED_EVICTION_MESSAGES })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(AGED_TWO_READ_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([
    [pathToolPart(AGED_READ_PATH, MIN_EVICTABLE_BYTES)],
    [pathToolPart(AGED_RETOUCHED_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(AGED_FILLER_COUNT),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.ok(toolPartAt(bundle.messages[1], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).evictions, 2)
  assert.equal(countersOf(stats).bytesReclaimed, MIN_EVICTABLE_BYTES * 2)
  assert.equal(countersOf(stats).evictionTokensSaved, tokensForChars(MIN_EVICTABLE_BYTES) * 2)
})

test("an aged output and a not-yet-aged candidate each take one disposition when the threshold exceeds the recent window", async () => {
  const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: AGED_THRESHOLD_ABOVE_WINDOW })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(AGED_TWO_READ_BUNDLE_CHARS, tokensForChars(MIN_EVICTABLE_BYTES) + OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([
    [pathToolPart(AGED_READ_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(AGED_MID_AGE_FILLER_COUNT),
    [pathToolPart(AGED_RETOUCHED_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(4),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.ok(toolPartAt(bundle.messages[7], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).evictions, 2)
  assert.equal(countersOf(stats).bytesReclaimed, MIN_EVICTABLE_BYTES * 2)
  assert.equal(countersOf(stats).evictionTokensSaved, tokensForChars(MIN_EVICTABLE_BYTES) * 2)
})

test("invalid agedReadEvictionMessages values drop to unset and echo null", async () => {
  for (const invalidValue of [AGED_THRESHOLD_INVALID_FLOAT, AGED_THRESHOLD_INVALID_ZERO, AGED_THRESHOLD_INVALID_NEGATIVE]) {
    const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: invalidValue })

    const bundle = agedBundle()
    await runTransform(hooks, bundle)

    assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
    const stats = await readStats(hooks, SESSION_ID)
    assert.equal((stats.options as Record<string, unknown>).agedReadEvictionMessages, null)
    assert.equal(countersOf(stats).evictions, 0)
  }
})

test("old-generation tombstone markers are treated as already-processed outputs", async () => {
  const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: AGED_EVICTION_MESSAGES })
  const legacyEvictedOutput = `${LEGACY_EVICTED_MARKER} read ${LEGACY_TOMBSTONE_PATH} (2048 bytes, ~9 messages ago) was evicted to reclaim context; re-run the tool to reload its output.`
  const legacyDedupedOutput = `${LEGACY_DEDUPED_MARKER} read identical call superseded by the newer output at message 9`

  const bundle = buildBundle([
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: LEGACY_TOMBSTONE_PATH }, legacyEvictedOutput)],
    [completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: LEGACY_TOMBSTONE_PATH }, legacyDedupedOutput)],
    ...fillerMessages(AGED_FILLER_COUNT),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, legacyEvictedOutput)
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, legacyDedupedOutput)
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).evictions, 0)
  assert.equal(countersOf(stats).deduped, 0)
})

test("the hint replacement finds and replaces an old-generation hint line in the system prompt", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildBundle([[pathToolPart(AGED_READ_PATH, MIN_EVICTABLE_BYTES)], ...fillerMessages(2)])
  await runTransform(hooks, bundle)

  const blocks = await runSystemTransform(hooks, SESSION_ID, [`${LEGACY_HINT_LINE_PREFIX} /data/old-subject.txt`, "keep me"])

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0], hintLineFor([AGED_READ_PATH]))
  assert.equal(blocks[1], "keep me")
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

const FAULT_MESSAGE = "injected transform fault"
const SECOND_SESSION_FAULT = "second session fault"

test("a faulting transform run degrades to identity behavior and surfaces lastFault", async () => {
  const hooks = await loadPluginHooksWith({ faultTransform: () => FAULT_MESSAGE })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, FAULT_SUBJECT)
  await runTransform(hooks, bundle)

  // Identity behavior: the output the host delivered comes back unchanged,
  // with no tombstone, dedup marker, or other plugin edit.
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  const stats = await readStats(hooks, SESSION_ID)
  const lastFault = stats.lastFault as Record<string, unknown>
  assert.ok(lastFault !== undefined)
  assert.equal(lastFault.message, FAULT_MESSAGE)
  assert.equal(typeof lastFault.at, "string")
})

test("a fault on one session does not leak into another session's run", async () => {
  const hooks = await loadPluginHooksWith({
    faultTransform: ((): (() => string | undefined) => {
      let calls = 0
      return () => {
        calls += 1
        return calls === 1 ? FAULT_MESSAGE : undefined
      }
    })(),
  })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await setContextLimit(hooks, SESSION_ID_B, contextForDeficit(THREE_ENTRY_BUNDLE_CHARS, TWO_ENTRY_DEFICIT_TOKENS))

  const faulted = buildStandardBundle(SESSION_ID, FAULT_SUBJECT)
  await runTransform(hooks, faulted)
  // Mirror the isolation test's B bundle: three candidates are needed for
  // the deficit-driven walk to reclaim anything on SESSION_ID_B.
  const healthy = buildBundle(
    [
      [pathToolPart("/data/fault-free-a.txt", THREE_ENTRY_OUTPUT_BYTES), pathToolPart("/data/fault-free-b.txt", THREE_ENTRY_OUTPUT_BYTES), pathToolPart("/data/fault-free-c.txt", THREE_ENTRY_OUTPUT_BYTES)],
      ...fillerMessages(),
    ],
    SESSION_ID_B,
  )
  await runTransform(hooks, healthy)

  assert.ok(toolPartAt(healthy.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const faultedStats = await readStats(hooks, SESSION_ID)
  assert.equal((faultedStats.lastFault as Record<string, unknown>).message, FAULT_MESSAGE)
  const healthyStats = await readStats(hooks, SESSION_ID_B)
  assert.equal(Object.hasOwn(healthyStats, "lastFault"), false)
})

test("a second fault replaces the session's lastFault message", async () => {
  const hooks = await loadPluginHooksWith({ faultTransform: ((): (() => string | undefined) => {
    let calls = 0
    return () => {
      calls += 1
      return calls === 1 ? FAULT_MESSAGE : SECOND_SESSION_FAULT
    }
  })() })

  const first = buildStandardBundle(SESSION_ID, FAULT_SUBJECT)
  await runTransform(hooks, first)
  const second = buildStandardBundle(SESSION_ID, FAULT_SUBJECT)
  await runTransform(hooks, second)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal((stats.lastFault as Record<string, unknown>).message, SECOND_SESSION_FAULT)
})

test("a throwing tool returns the structured error shape instead of throwing", async () => {
  const hooks = await loadPluginHooks()

  // The internals guard ordinary hostile shapes and return their own miss
  // strings, so the boundary is exercised with an args object whose
  // property getter throws mid-read: the boundary must convert the throw
  // into the structured error string.
  const hostileArgs = Object.create(null, { subject: { get: () => { throw new Error(TOOL_FAULT_MESSAGE) } } })
  const result = await (hooks as Record<string, Record<string, { execute: (args: unknown, context: unknown) => Promise<string> }>>)[RELOAD_TOOL_MAP_KEY][RELOAD_TOOL_NAME].execute(
    hostileArgs,
    { sessionID: SESSION_ID },
  )

  assert.equal(typeof result, "string")
  assert.ok(result.startsWith(TOOL_ERROR_PREFIX))
  assert.ok(result.includes(TOOL_FAULT_MESSAGE))
})

const HOSTILE_CHAT_PARAMS_PAYLOADS: unknown[] = [
  undefined,
  null,
  42,
  "session",
  [],
  {},
  { model: "not-a-record" },
  { model: { providerID: 7, modelID: true } },
  { model: { limit: "none" } },
  { model: { providerID: "p", modelID: "m", limit: { context: "most of it" } } },
]

test("the chat.params handler survives hostile payloads without throwing", async () => {
  const hooks = await loadPluginHooks()

  for (const payload of HOSTILE_CHAT_PARAMS_PAYLOADS) {
    await hooks[CHAT_PARAMS_HOOK](payload as { sessionID: string }, {})
  }

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, null)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
})

const DRY_RUN_CANDIDATE_BYTES = 3000
const DRY_RUN_CANDIDATES = 2
const DRY_RUN_WATERMARK_TOKENS = 1000
const DRY_RUN_FILLER_MESSAGES = 2 + RECENT_WINDOW_FILLER_MESSAGES
const DRY_RUN_BUNDLE_ESTIMATED_TOKENS = tokensForChars(DRY_RUN_CANDIDATES * DRY_RUN_CANDIDATE_BYTES + DRY_RUN_FILLER_MESSAGES * FILLER_TEXT_CHARS)
const DRY_RUN_ARMED_DEFICIT_TOKENS = DRY_RUN_BUNDLE_ESTIMATED_TOKENS - DRY_RUN_WATERMARK_TOKENS
// The evictor's walk stops once reclaimed tokens cover the deficit: the
// bundle estimates ~1515 tokens, deficit ~515, and the first 3000-byte
// candidate reclaims 750 tokens, so the walk stops after one candidate.
const DRY_RUN_EXPECTED_COUNT = 1
const DRY_RUN_EXPECTED_BYTES = DRY_RUN_CANDIDATE_BYTES

// A bundle whose two cold candidates sit outside the recent window:
// estimate = candidates + fillers, well above the 1000-token dry-run
// watermark. Different paths and no offset/limit, so dedup and range
// collapse stay out of the way and the tests isolate the dry run. The
// aged reasoning part makes the run eventful per the existing gate (a
// dry run alone is not eventfulness), so metrics-log expectations hold.
const buildDryRunBundle = (): StrictBundle =>
  buildBundle([
    [reasoningPart(REASONING_COLD_TEXT), pathToolPart(DRY_RUN_SECOND_PATH, DRY_RUN_CANDIDATE_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(RANGE_COLLAPSE_PATH, DRY_RUN_CANDIDATE_BYTES)],
    ...fillerMessages(),
  ])

test("watermarkTokens resolves as an absolute override over the fractional watermark", async () => {
  const defaultOptions = ((await readStats(await loadPluginHooks(), SESSION_ID)).options as Record<string, unknown>)
  assert.equal(defaultOptions.watermarkTokens, null)

  const customHooks = await loadPluginHooksWith({ watermarkTokens: DRY_RUN_WATERMARK_TOKENS })
  const customOptions = (await readStats(customHooks, SESSION_ID)).options as Record<string, unknown>
  assert.equal(customOptions.watermarkTokens, DRY_RUN_WATERMARK_TOKENS)

  for (const invalidWatermarkTokens of [-5, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalidHooks = await loadPluginHooksWith({ watermarkTokens: invalidWatermarkTokens })
    const invalidOptions = (await readStats(invalidHooks, SESSION_ID)).options as Record<string, unknown>
    assert.equal(invalidOptions.watermarkTokens, null)
  }

  // The absolute watermark wins even when the fractional watermark of a
  // captured budget would be far higher: the fallback bundle's estimate
  // (~100k tokens of text plus a candidate) sits under 0.5 x the legacy
  // budget but far above the 1000-token absolute watermark, so eviction
  // engages against watermarkTokens alone.
  const overrideHooks = await loadPluginHooksWith({ watermarkTokens: DRY_RUN_WATERMARK_TOKENS })
  const bundle = buildFallbackBudgetBundle(FALLBACK_BUNDLE_LARGE_TEXT_CHARS)
  await runTransform(overrideHooks, bundle)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("manual mode with watermarkTokens reports a dry run without tombstoning anything", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true, watermarkTokens: DRY_RUN_WATERMARK_TOKENS })
  await setContextLimit(hooks, SESSION_ID, LARGE_DEFAULT_CONTEXT_TOKENS)

  const bundle = buildDryRunBundle()
  await runTransform(hooks, bundle)
  // Reasoning expiry legitimately mutates its own part (removing it from
  // messages[0]); the dry run's promise is that no tool output is
  // tombstoned or stashed.
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(DRY_RUN_CANDIDATE_BYTES))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(DRY_RUN_CANDIDATE_BYTES))

  const stats = await readStats(hooks, SESSION_ID)
  const dryRun = stats.dryRun as Record<string, unknown>
  assert.ok(dryRun !== undefined)
  assert.ok((dryRun.deficitTokens as number) > 0)
  assert.equal(dryRun.wouldEvictCount, DRY_RUN_EXPECTED_COUNT)
  assert.equal(dryRun.wouldEvictBytes, DRY_RUN_EXPECTED_BYTES)
  const subjects = dryRun.wouldEvictSubjects as string[]
  assert.equal(subjects.length, DRY_RUN_EXPECTED_COUNT)
})

test("manual mode with watermarkTokens and no captured budget still reports the dry run", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true, watermarkTokens: DRY_RUN_WATERMARK_TOKENS })

  const bundle = buildDryRunBundle()
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, null)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  const dryRun = stats.dryRun as Record<string, unknown>
  assert.ok(dryRun !== undefined)
  assert.ok((dryRun.deficitTokens as number) > 0)
  assert.equal(dryRun.wouldEvictCount, DRY_RUN_EXPECTED_COUNT)
  assert.equal(dryRun.wouldEvictBytes, DRY_RUN_EXPECTED_BYTES)
})

test("manual mode previews the fault adjusted candidate order in the dry run when the colder candidate was reloaded", async () => {
  const hooks = await loadPluginHooksWith({
    manualMode: true,
    watermarkTokens: DRY_RUN_WATERMARK_TOKENS,
    userFenceEviction: { enabled: true, minBlockLines: FENCE_TEST_THRESHOLD },
  })
  const faultFenceBlock = fenceBlockText(FENCE_NO_LANGUAGE, [
    FAULT_DRY_RUN_RELOADED_PATH,
    ...fenceContentLines(FENCE_TEST_THRESHOLD, "faultfence"),
  ])
  await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${faultFenceBlock}\n${FENCE_PROSE_AFTER}`))
  assert.equal(await readEvicted(hooks, FAULT_DRY_RUN_RELOADED_PATH, SESSION_ID), `${faultFenceBlock}\n`)

  const bundle = buildBundle([
    [pathToolPart(FAULT_DRY_RUN_RELOADED_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(FAULT_DRY_RUN_WARM_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const dryRun = (await readStats(hooks, SESSION_ID)).dryRun as Record<string, unknown>
  assert.ok(dryRun !== undefined)
  assert.equal(dryRun.wouldEvictCount, 1)
  assert.deepEqual(dryRun.wouldEvictSubjects, [FAULT_DRY_RUN_WARM_PATH])
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("the same dry-run session evicts for real once manual mode is off", async () => {
  const hooks = await loadPluginHooksWith({ watermarkTokens: DRY_RUN_WATERMARK_TOKENS })
  await setContextLimit(hooks, SESSION_ID, LARGE_DEFAULT_CONTEXT_TOKENS)

  const bundle = buildDryRunBundle()
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const evictions = countersOf(await readStats(hooks, SESSION_ID)).evictions
  assert.ok(evictions >= DRY_RUN_EXPECTED_COUNT)
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(Object.hasOwn(stats, "dryRun"), false)
})

test("metrics log carries wouldEvict fields whenever the manual-mode dry run is armed, zeroed under the watermark", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const overHooks = await loadPluginHooksWith({
      manualMode: true,
      watermarkTokens: DRY_RUN_WATERMARK_TOKENS,
      metricsLog: true,
      metricsPath,
    })
    await setContextLimit(overHooks, SESSION_ID, LARGE_DEFAULT_CONTEXT_TOKENS)
    await runTransform(overHooks, buildDryRunBundle())

    const overLines = metricsLinesIn(metricsPath)
    assert.equal(overLines.length, STATS_LOG_FILE_LINES)
    assert.equal(overLines[0].wouldEvictThisRun, DRY_RUN_EXPECTED_COUNT)
    assert.equal(overLines[0].wouldEvictBytesThisRun, DRY_RUN_EXPECTED_BYTES)

    const underPath = join(metricsDir, "under.jsonl")
    const underHooks = await loadPluginHooksWith({
      manualMode: true,
      watermarkTokens: LARGE_DEFAULT_CONTEXT_TOKENS,
      metricsLog: true,
      metricsPath: underPath,
    })
    await setContextLimit(underHooks, SESSION_ID, LARGE_DEFAULT_CONTEXT_TOKENS)
    await runTransform(underHooks, buildDryRunBundle())

    // The under-watermark run is still eventful (the aged reasoning part
    // expires), so a line lands; the dry run is active in manual mode, so
    // the fields exist but report zeros (nothing above the watermark).
    const underLines = metricsLinesIn(underPath)
    assert.equal(underLines.length, STATS_LOG_FILE_LINES)
    assert.equal(underLines[0].wouldEvictThisRun, 0)
    assert.equal(underLines[0].wouldEvictBytesThisRun, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics line records the armed watermark and the dry run's deficit on an eventful manual run", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWith({
      manualMode: true,
      watermarkTokens: DRY_RUN_WATERMARK_TOKENS,
      metricsLog: true,
      metricsPath,
    })
    await setContextLimit(hooks, SESSION_ID, LARGE_DEFAULT_CONTEXT_TOKENS)
    const bundle = buildDryRunBundle()
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].watermarkTokens, DRY_RUN_WATERMARK_TOKENS)
    assert.equal(lines[0].deficitTokens, DRY_RUN_ARMED_DEFICIT_TOKENS)

    // The recorded figures agree with the dry run's own deficit: one
    // stand-down arithmetic serves both, so they cannot drift.
    const stats = await readStats(hooks, SESSION_ID)
    const dryRun = stats.dryRun as Record<string, unknown>
    assert.equal(dryRun.deficitTokens, lines[0].deficitTokens)
    const lastRun = stats.lastRun as Record<string, unknown>
    assert.equal(lastRun.watermarkTokens, DRY_RUN_WATERMARK_TOKENS)
    assert.equal(lastRun.deficitTokens, DRY_RUN_ARMED_DEFICIT_TOKENS)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("rehydration ignores run-scoped dry-run fields and seeds only the totals", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, {
      manualMode: true,
      watermarkTokens: DRY_RUN_WATERMARK_TOKENS,
    })
    await setContextLimit(firstSittingHooks, SESSION_ID, LARGE_DEFAULT_CONTEXT_TOKENS)
    await runTransform(firstSittingHooks, buildDryRunBundle())
    assert.ok(metricsLinesForSession(metricsPath, SESSION_ID)[0].wouldEvictThisRun !== undefined)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setContextLimit(secondSittingHooks, SESSION_ID, LARGE_DEFAULT_CONTEXT_TOKENS)
    await runTransform(secondSittingHooks, reasoningOnlyBundle())

    const stats = await readStats(secondSittingHooks, SESSION_ID)
    assert.equal(Object.hasOwn(stats, "dryRun"), false)
    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].wouldEvictThisRun, undefined)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
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

test("context_stats reports the manual state the captured budget and the armed watermark last run", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_STATS_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.options.manualMode, true)
  assert.equal(stats.modelContextTokens, WATERMARK_PROBE_CONTEXT_LIMIT)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: MANUAL_ARMED_WATERMARK_TOKENS,
    deficitTokens: MANUAL_ARMED_DEFICIT_TOKENS,
  })
})

test("context_stats keeps a null watermark and deficit for a manual session with no budget and no watermarkTokens", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true })

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_UNWATERMARKED_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.modelContextTokens, null)
  assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
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
const BOUND_TEST_SESSION_C = "ctx-bound-session-c"
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

test("context_stats reports the default stash capacity of fifty entries when stashLimit is unset", async () => {
  const stats = await readStats(await loadPluginHooks(), SESSION_ID)

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

  assert.deepEqual((await readStats(hooks, SESSION_ID)).stash, {
    entries: STASH_LIMIT_OVERRIDE,
    capacity: STASH_LIMIT_OVERRIDE,
  })
  assert.equal(
    await readEvicted(hooks, subjects[0], SESSION_ID),
    stashMissFor(
      subjects[0],
      stashOccupancyLineFor(subjects.slice(1).map((subject, index) => ({ tool: READ_TOOL, subject, msgIndex: index + 1 }))),
    ),
  )
  assert.equal(await readEvicted(hooks, subjects[1], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await readEvicted(hooks, subjects[2], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("context_stats keeps the default stash capacity when stashLimit is invalid", async () => {
  for (const invalidLimit of STASH_LIMIT_INVALID_VALUES) {
    const hooks = await loadPluginHooksWith({ stashLimit: invalidLimit })
    const stats = await readStats(hooks, SESSION_ID)

    assert.deepEqual(stats.stash, { entries: 0, capacity: STASH_LIMIT })
  }
})

test("read_evicted drops the least recently active session stash when the stashSessions bound is exceeded", async () => {
  const hooks = await loadPluginHooksWith({ stashSessions: SESSION_BOUND_OVERRIDE })
  for (let index = 0; index < SESSION_BOUND_OVERRIDE; index += 1) await evictStashSession(hooks, index)

  await evictStashSession(hooks, SESSION_BOUND_OVERRIDE)

  assert.equal(
    await readEvicted(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0), STASH_EMPTY_OCCUPANCY),
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
    stashMissFor(stashSessionSubject(0), STASH_EMPTY_OCCUPANCY),
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

test("context_stats drops the least recently active session metrics when the metricsSessions bound is exceeded", async () => {
  const hooks = await loadPluginHooksWith({ metricsSessions: SESSION_BOUND_OVERRIDE })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setContextLimit(hooks, SESSION_ID_B, WATERMARK_PROBE_CONTEXT_LIMIT)

  await runTransform(hooks, buildStandardBundle(SESSION_ID, "/data/metrics-bound-a.txt"))
  await runTransform(hooks, buildStandardBundle(SESSION_ID_B, "/data/metrics-bound-b.txt"))
  await runTransform(hooks, buildStandardBundle(BOUND_TEST_SESSION_C, "/data/metrics-bound-c.txt"))

  assert.equal(countersOf(await readStats(hooks, SESSION_ID_B)).evictions, 1)
  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), STATS_ZEROED_COUNTERS)
})

test("context_stats keeps session metrics when an invalid metricsSessions falls back to the default bound", async () => {
  const hooks = await loadPluginHooksWith({ metricsSessions: SESSION_BOUND_INVALID_ZERO })
  for (let index = 0; index < METRICS_SESSION_OVERFLOW_COUNT; index += 1) await storeMetricsSession(hooks, index)

  assert.equal(countersOf(await readStats(hooks, metricsSessionId(0))).evictions, 0)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(1))).evictions, 1)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_OVERFLOW_COUNT - 1))).evictions, 1)
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

  return countersOf(await readStats(hooks, SESSION_ID)).postEvictionTouches
}

test("context_stats forgets the oldest evicted subject at the rememberedEvictedSubjects bound so its touch goes uncounted", async () => {
  assert.equal(await rememberedSubjectsTouchCountFor(REMEMBERED_SUBJECTS_OVERRIDE), 1)
})

test("context_stats keeps both evicted subjects remembered when rememberedEvictedSubjects is invalid", async () => {
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

const REHYDRA_FRESH_SESSION = "ctx-rehydrate-fresh-session"
const REHYDRA_SECOND_SESSION = "ctx-rehydrate-second-session"
const REHYDRA_EVICTION_SUBJECT_A = "/data/rehydrate-eviction-a.txt"
const REHYDRA_EVICTION_SUBJECT_B = "/data/rehydrate-eviction-b.txt"
const REHYDRA_MISS_SUBJECT = "/data/rehydrate-miss.txt"
const REHYDRA_DEDUP_PATH = "/data/rehydrate-dedup.txt"
const REHYDRA_FENCE_TAG = "rehydrate"
const REHYDRA_FENCE_BLOCK = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, REHYDRA_FENCE_TAG))
const REHYDRA_FENCE_BYTES = REHYDRA_FENCE_BLOCK.length + FENCE_TRAILING_NEWLINE_CHARS
const REHYDRA_REASONING_TEXT = "rehydrated cold reasoning block"
const REHYDRA_PROBE_TEXT_CHARS = 60
// The quiet probe bundle's whole post-transform composition: the probe text
// plus the two filler messages' text.
const REHYDRA_QUIET_PROBE_CHARS = REHYDRA_PROBE_TEXT_CHARS + 2 * FILLER_TEXT_CHARS
const REHYDRA_DEDUP_POST_CHARS =
  dedupTombstoneFor(READ_TOOL, 1).length + THREE_ENTRY_OUTPUT_BYTES + 2 * FILLER_TEXT_CHARS
const REHYDRA_LINES_FROM_SECOND_SITTING = 4
const REHYDRA_STALE_RECORD_EVICTIONS = 10
const REHYDRA_NEWER_RECORD_EVICTIONS = 20
const BUDGET_PERSISTENCE_CONTEXT_LIMIT = 300000
const REHYDRA_EARLIER_TS = "2026-09-17T00:00:00.000Z"
const REHYDRA_LATER_TS = "2026-09-17T00:05:00.000Z"

const loadPluginHooksWithPersistence = async (metricsPath: string, stateDir: string, extra: Record<string, unknown> = {}): Promise<HookMap> =>
  loadPluginHooksWithLiveState(stateDir, { metricsLog: true, metricsPath, ...extra })

// Runs the over-watermark standard bundle and returns the message's tool
// part: eviction engaged when its output starts with the tombstone marker,
// and the budget resolved to unknown when the output survived verbatim.
const runStandDownProbe = async (hooks: HookMap): Promise<CompletedToolPart> => {
  const bundle = buildStandardBundle(SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)
  await runTransform(hooks, bundle)
  return toolPartAt(bundle.messages[0], 0)
}

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
  modelContextTokensModelKey: null,
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
    modelContextTokensModelKey: null,
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
  expected.reasoningTokensSaved = tokensForChars(expected.reasoningBytesExpiredUnique)
  expected.processedContextTokens = tokensForChars(expected.processedContextBytes)
  return expected
}

// The unique counters rehydrate from persisted totals, but the seen-key
// lists are process memory: a fresh process re-counts each standing pair
// and part once on its first run, so the second sitting adds one to each.
// The second sitting reruns the first sitting's five transforms with
// same-shaped bundles, so its processed-context accumulation repeats the
// first sitting's figure; withCounterDeltas derives the token total.
const REHYDRA_SITTING_PROCESSED_CHARS = 4036

const SECOND_SITTING_COUNTER_DELTAS = {
  evictions: 1,
  bytesReclaimed: MIN_EVICTABLE_BYTES + REHYDRA_FENCE_BYTES,
  stashHits: 1,
  stashMisses: 1,
  deduped: 1,
  dedupedUnique: 1,
  dedupedBytes: THREE_ENTRY_OUTPUT_BYTES,
  reasoningExpiredUnique: 1,
  reasoningBytesExpiredUnique: REHYDRA_REASONING_TEXT.length,
  fenceEvicted: 1,
  processedContextBytes: REHYDRA_SITTING_PROCESSED_CHARS,
}

const runFirstSitting = async (hooks: HookMap): Promise<void> => {
  await runEvictionTransform(hooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)
  assert.equal(await readEvicted(hooks, REHYDRA_EVICTION_SUBJECT_A, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(
    await readEvicted(hooks, REHYDRA_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      REHYDRA_MISS_SUBJECT,
      stashOccupancyLineFor([{ tool: READ_TOOL, subject: REHYDRA_EVICTION_SUBJECT_A, msgIndex: 0 }]),
    ),
  )
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
  assert.equal(
    await readEvicted(hooks, REHYDRA_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      REHYDRA_MISS_SUBJECT,
      stashOccupancyLineFor([
        { tool: READ_TOOL, subject: REHYDRA_EVICTION_SUBJECT_B, msgIndex: 0 },
        { tool: FENCE_STASH_TOOL_LABEL, subject: fenceFirstLineOf(REHYDRA_FENCE_TAG), msgIndex: 0 },
      ]),
    ),
  )
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

test("a restart drops fault feedback so a previously reloaded subject loses its eviction deferral", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const first = await loadPluginHooksWith({ metricsLog: true, metricsPath })
    await setContextLimit(first, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
    await evictAndReload(first, FAULT_RESTART_RELOADED_PATH)
    // The next transform flushes the reload into the persisted totals, so
    // the restarted instance's stashHits figure proves rehydration happened
    // and the deferral loss is fault-specific, not a missing record.
    await runTransform(first, buildBundle(fillerMessages()))

    const restarted = await loadPluginHooksWith({ metricsLog: true, metricsPath })
    const contest = await runFaultContest(
      restarted,
      [FAULT_RESTART_RELOADED_PATH, FAULT_RESTART_PEER_PATH],
      OVER_BY_ONE_TOKENS,
    )
    assertEntryTombstoned(contest, 0)
    assertEntryKept(contest, 1)
    assert.equal(countersOf(await readStats(restarted, SESSION_ID)).stashHits, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
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
    assert.deepEqual(countersOf(await readStats(secondSittingHooks, REHYDRA_FRESH_SESSION)), STATS_ZEROED_COUNTERS)
    await runQuietProbeTransform(secondSittingHooks, REHYDRA_FRESH_SESSION)
    assert.deepEqual(countersOf(await readStats(secondSittingHooks, REHYDRA_FRESH_SESSION)), {
      ...STATS_ZEROED_COUNTERS,
      processedContextBytes: REHYDRA_QUIET_PROBE_CHARS,
      processedContextTokens: tokensForChars(REHYDRA_QUIET_PROBE_CHARS),
    })
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

    const expected = withCounterDeltas(baseline, { evictions: 1, bytesReclaimed: MIN_EVICTABLE_BYTES, processedContextBytes: 502 })
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
      processedContextBytes: 502,
      processedContextTokens: tokensForChars(502),
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
    assert.equal(
      await readEvicted(firstSittingHooks, REHYDRA_MISS_SUBJECT, SESSION_ID),
      stashMissFor(
        REHYDRA_MISS_SUBJECT,
        stashOccupancyLineFor([{ tool: READ_TOOL, subject: REHYDRA_EVICTION_SUBJECT_A, msgIndex: 0 }]),
      ),
    )
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

    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, REHYDRA_NEWER_RECORD_EVICTIONS)
    assert.equal(countersOf(await readStats(hooks, REHYDRA_SECOND_SESSION)).evictions, REHYDRA_NEWER_RECORD_EVICTIONS)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

const SEEDING_RECORD_A_EVICTIONS = 5
const SEEDING_RECORD_A_REASONING_UNIQUE = 3
const SEEDING_RECORD_A_REASONING_BYTES_UNIQUE = 90
const SEEDING_RECORD_B_EVICTIONS = 2
const SEEDING_RECORD_B_REASONING_UNIQUE = 1
const SEEDING_RECORD_B_REASONING_BYTES_UNIQUE = REASONING_COLD_TEXT.length

test("resumed sessions seed reasoning counters only from their own persisted records", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const ownRecord = (session: string, ts: string, evictions: number, reasoningUnique: number, reasoningBytesUnique: number): Record<string, unknown> => ({
      ...rehydrateSeedLine(session, ts, evictions),
      totals: {
        ...STATS_ZEROED_COUNTERS,
        evictions,
        reasoningExpiredUnique: reasoningUnique,
        reasoningBytesExpiredUnique: reasoningBytesUnique,
      },
    })
    writeFileSync(
      metricsPath,
      `${JSON.stringify(ownRecord(SESSION_ID, REHYDRA_LATER_TS, SEEDING_RECORD_A_EVICTIONS, SEEDING_RECORD_A_REASONING_UNIQUE, SEEDING_RECORD_A_REASONING_BYTES_UNIQUE))}\n` +
        `${JSON.stringify(ownRecord(SESSION_ID_B, REHYDRA_EARLIER_TS, SEEDING_RECORD_B_EVICTIONS, SEEDING_RECORD_B_REASONING_UNIQUE, SEEDING_RECORD_B_REASONING_BYTES_UNIQUE))}\n`,
    )

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runQuietProbeTransform(hooks, SESSION_ID)
    await runQuietProbeTransform(hooks, SESSION_ID_B)

    const sessionCounters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(sessionCounters.evictions, SEEDING_RECORD_A_EVICTIONS)
    assert.equal(sessionCounters.reasoningExpiredUnique, SEEDING_RECORD_A_REASONING_UNIQUE)
    assert.equal(sessionCounters.reasoningBytesExpiredUnique, SEEDING_RECORD_A_REASONING_BYTES_UNIQUE)
    assert.equal(sessionCounters.reasoningTokensSaved, tokensForChars(SEEDING_RECORD_A_REASONING_BYTES_UNIQUE))
    const siblingCounters = countersOf(await readStats(hooks, SESSION_ID_B))
    assert.equal(siblingCounters.evictions, SEEDING_RECORD_B_EVICTIONS)
    assert.equal(siblingCounters.reasoningExpiredUnique, SEEDING_RECORD_B_REASONING_UNIQUE)
    assert.equal(siblingCounters.reasoningBytesExpiredUnique, SEEDING_RECORD_B_REASONING_BYTES_UNIQUE)
    assert.equal(siblingCounters.reasoningTokensSaved, tokensForChars(SEEDING_RECORD_B_REASONING_BYTES_UNIQUE))
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("resumed session resolves the budget persisted in its snapshot and logs it instead of null unknown", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setContextLimit(firstSittingHooks, SESSION_ID, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)
    assert.equal(existsSync(metricsPath), false)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(secondSittingHooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].modelContextTokens, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    assert.equal(lines[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
    assert.equal(lines[0].watermarkTokens, BUDGET_PERSISTENCE_CONTEXT_LIMIT * WATERMARK_RATIO)
    assert.ok((lines[0].deficitTokens as number) < 0)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a live chat.params capture overrides the budget rehydrated from the snapshot", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setContextLimit(firstSittingHooks, SESSION_ID, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setContextLimit(secondSittingHooks, SESSION_ID, SMALL_CONTEXT_LIMIT)
    await runTransform(secondSittingHooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].modelContextTokens, SMALL_CONTEXT_LIMIT)
    assert.equal(lines[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a mid sitting model change without a limit invalidates the rehydrated budget and stands eviction down", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setChatParamsForModel(firstSittingHooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    // Rehydration lands first: the reasoning-only run resolves the
    // persisted budget before the invalidating chat.params event arrives.
    await runTransform(secondSittingHooks, reasoningOnlyBundle())
    assert.equal(metricsLinesForSession(metricsPath, SESSION_ID)[0].modelContextTokens, BUDGET_PERSISTENCE_CONTEXT_LIMIT)

    await setChatParamsForModel(secondSittingHooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID, undefined)
    assert.equal((await runStandDownProbe(secondSittingHooks)).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
    const stats = await readStats(secondSittingHooks, SESSION_ID)
    assert.equal(stats.modelContextTokens, null)
    assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)

    await runTransform(secondSittingHooks, reasoningOnlyBundle())
    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].modelContextTokens, null)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a model change across a restart suppresses the persisted budget instead of refilling it", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setChatParamsForModel(firstSittingHooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setChatParamsForModel(secondSittingHooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID, undefined)
    await runTransform(secondSittingHooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].modelContextTokens, null)
    assert.equal(lines[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)

    assert.equal((await runStandDownProbe(secondSittingHooks)).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
    assert.equal(countersOf(await readStats(secondSittingHooks, SESSION_ID)).evictions, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a same model no limit chat params event keeps the rehydrated budget resolved", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setChatParamsForModel(firstSittingHooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setChatParamsForModel(secondSittingHooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, undefined)
    await runTransform(secondSittingHooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].modelContextTokens, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    assert.equal(lines[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a model change across a restart suppresses a budget seeded from the metrics log tail", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWith({ metricsLog: true, metricsPath, liveStateLog: false })
    await setChatParamsForModel(firstSittingHooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    await runTransform(firstSittingHooks, reasoningOnlyBundle())
    const seedLine = metricsLinesForSession(metricsPath, SESSION_ID)[0]
    assert.equal(seedLine.modelContextTokens, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    assert.equal(seedLine.modelContextTokensModelKey, OVERRIDE_MODEL_KEY)

    const secondSittingHooks = await loadPluginHooksWith({ metricsLog: true, metricsPath, liveStateLog: false })
    await setChatParamsForModel(secondSittingHooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID, undefined)
    await runTransform(secondSittingHooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].modelContextTokens, null)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)

    assert.equal((await runStandDownProbe(secondSittingHooks)).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
    assert.equal(countersOf(await readStats(secondSittingHooks, SESSION_ID)).evictions, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("a removed model override suppresses the persisted override budget across a restart", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const overrideOptions = { modelContextTokens: { [OVERRIDE_MODEL_KEY]: BUDGET_PERSISTENCE_CONTEXT_LIMIT } }
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, overrideOptions)
    await setChatParamsForModel(firstSittingHooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, LARGE_DEFAULT_CONTEXT_TOKENS)
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, overrideOptions)
    await runTransform(secondSittingHooks, reasoningOnlyBundle())
    const rehydratedLines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(rehydratedLines[0].modelContextTokens, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    assert.equal(rehydratedLines[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
    assert.equal(rehydratedLines.length, STATS_LOG_FILE_LINES)

    // The override leaves the config only now: the third sitting rehydrates
    // a budget whose source is an override the options no longer carry.
    const thirdSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(thirdSittingHooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].modelContextTokens, null)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)

    assert.equal((await runStandDownProbe(thirdSittingHooks)).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
    assert.equal(countersOf(await readStats(thirdSittingHooks, SESSION_ID)).evictions, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a removed defaultContextTokens option suppresses the persisted default budget across a restart", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, { defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, { defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })
    await runTransform(secondSittingHooks, reasoningOnlyBundle())
    const rehydratedLines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(rehydratedLines[0].modelContextTokens, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
    assert.equal(rehydratedLines[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
    assert.equal(rehydratedLines.length, STATS_LOG_FILE_LINES)

    // The option leaves the config only now: the third sitting rehydrates
    // a budget whose source is a default the options no longer carry.
    const thirdSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(thirdSittingHooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].modelContextTokens, null)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)

    assert.equal((await runStandDownProbe(thirdSittingHooks)).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
    assert.equal(countersOf(await readStats(thirdSittingHooks, SESSION_ID)).evictions, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a hostile model key in the persisted record rejects the whole seed", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hostileSnapshot = JSON.parse(rehydrateSeedSnapshot(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS)) as Record<string, unknown>
    hostileSnapshot.modelContextTokens = BUDGET_PERSISTENCE_CONTEXT_LIMIT
    hostileSnapshot.modelContextTokensSource = CONTEXT_TOKENS_SOURCE_MODEL
    hostileSnapshot.modelContextTokensModelKey = 47
    writeFileSync(liveStatePathIn(stateDir, SESSION_ID), `${JSON.stringify(hostileSnapshot)}\n`)

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal((lines[0].totals as Record<string, number>).evictions, 0)
    assert.equal(lines[0].modelContextTokens, null)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("context_stats resolves the rehydrated budget once the session entry is hydrated", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setContextLimit(firstSittingHooks, SESSION_ID, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)
    assert.equal(existsSync(metricsPath), false)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(secondSittingHooks, reasoningOnlyBundle())
    const stats = await readStats(secondSittingHooks, SESSION_ID)
    assert.equal(stats.modelContextTokens, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    assert.equal(stats.modelContextTokensSource, CONTEXT_TOKENS_SOURCE_MODEL)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("eviction engages on a resumed session whose budget rehydrated where a fresh process stood down", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  const freshMetricsDir = makeMetricsDir()
  const freshStateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setContextLimit(firstSittingHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)
    assert.equal(existsSync(metricsPath), false)

    const resumedHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    assert.ok((await runStandDownProbe(resumedHooks)).state.output.startsWith(TOMBSTONE_MARKER))
    assert.equal(countersOf(await readStats(resumedHooks, SESSION_ID)).evictions, 1)

    const freshHooks = await loadPluginHooksWithPersistence(metricsLogPathIn(freshMetricsDir), freshStateDir)
    assert.equal((await runStandDownProbe(freshHooks)).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
    cleanupMetricsDir(freshMetricsDir)
    cleanupMetricsDir(freshStateDir)
  }
})

test("a snapshot predating budget persistence seeds counters and leaves the budget unknown", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const legacySnapshot = JSON.parse(rehydrateSeedSnapshot(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS)) as Record<string, unknown>
    delete legacySnapshot.modelContextTokens
    delete legacySnapshot.modelContextTokensSource
    writeFileSync(liveStatePathIn(stateDir, SESSION_ID), `${JSON.stringify(legacySnapshot)}\n`)

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal((lines[0].totals as Record<string, number>).evictions, REHYDRA_NEWER_RECORD_EVICTIONS)
    assert.equal(lines[0].modelContextTokens, null)
    assert.equal(lines[0].modelContextTokensSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a snapshot whose budget fields are invalid rejects the whole record and the session starts zeroed", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hostileSnapshot = JSON.parse(rehydrateSeedSnapshot(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS)) as Record<string, unknown>
    hostileSnapshot.modelContextTokens = "most of it"
    writeFileSync(liveStatePathIn(stateDir, SESSION_ID), `${JSON.stringify(hostileSnapshot)}\n`)

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal((lines[0].totals as Record<string, number>).evictions, 0)
    assert.equal(lines[0].modelContextTokens, null)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a snapshot predating the unique reasoning bytes key rejects the whole record and the session starts zeroed", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const preUpgradeSnapshot = JSON.parse(rehydrateSeedSnapshot(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS)) as Record<string, unknown>
    delete (preUpgradeSnapshot.totals as Record<string, unknown>).reasoningBytesExpiredUnique
    writeFileSync(liveStatePathIn(stateDir, SESSION_ID), `${JSON.stringify(preUpgradeSnapshot)}\n`)

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal((lines[0].totals as Record<string, number>).evictions, 0)
    assert.equal((lines[0].totals as Record<string, number>).reasoningExpiredUnique, EXPIRED_REASONING_SINGLE_COUNT)
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

    const counters = countersOf(await readStats(secondSittingHooks, SESSION_ID))
    assert.equal(counters.evictions, 3)
    assert.equal(counters.bytesReclaimed, 3 * MIN_EVICTABLE_BYTES)
    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal((lines[lines.length - 1].totals as Record<string, number>).evictions, 3)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("context_stats re-counts the standing reasoning set when the metrics store evicts and re-seeds the session entry within one process", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    const agedReasoningParts = (): MessagePart[][] => [
      [reasoningPart(REASONING_COLD_TEXT), reasoningPart(REASONING_SECOND_COLD_TEXT)],
      ...fillerMessages(),
    ]
    await runTransform(hooks, buildBundle(agedReasoningParts()))
    for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)
    await runTransform(hooks, buildBundle(agedReasoningParts()))

    const counters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(counters.reasoningExpiredUnique, EXPIRED_REASONING_PAIR_COUNT * REPEATED_STANDING_RUNS)
    assert.equal(counters.reasoningBytesExpiredUnique, EXPIRED_REASONING_PAIR_BYTES * REPEATED_STANDING_RUNS)
    assert.equal(counters.reasoningTokensSaved, tokensForChars(EXPIRED_REASONING_PAIR_BYTES * REPEATED_STANDING_RUNS))
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

const SEED_PLUS_RECOUNT_SETS = 2

test("metrics-store bound eviction of one sibling leaves the other's reasoning counters intact and reseeds the evicted sibling from its own records", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(hooks, agedReasoningBundleFor(SESSION_ID))
    await runTransform(hooks, buildBundle([[reasoningPart(REASONING_COLD_TEXT)], ...fillerMessages()], SESSION_ID_B))
    // Default bound 8 with two occupied entries: the seventh fresher session
    // evicts SESSION_ID's entry while SESSION_ID_B's stays resident.
    for (let index = 0; index < METRICS_SESSION_BOUND - 1; index += 1) await storeMetricsSession(hooks, index)

    const siblingCountersAfterEviction = countersOf(await readStats(hooks, SESSION_ID_B))
    assert.equal(siblingCountersAfterEviction.reasoningExpiredUnique, EXPIRED_REASONING_SINGLE_COUNT)
    assert.equal(siblingCountersAfterEviction.reasoningBytesExpiredUnique, REASONING_COLD_TEXT.length)
    assert.equal(siblingCountersAfterEviction.reasoningTokensSaved, tokensForChars(REASONING_COLD_TEXT.length))

    // The re-created entry seeds its lifetime totals from the session's own
    // newest persisted record, then re-counts the standing set with an
    // empty ring: one seeded crossing set plus one re-counted set.
    await runTransform(hooks, agedReasoningBundleFor(SESSION_ID))
    const reseededCounters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(reseededCounters.reasoningExpiredUnique, EXPIRED_REASONING_PAIR_COUNT * SEED_PLUS_RECOUNT_SETS)
    assert.equal(reseededCounters.reasoningBytesExpiredUnique, EXPIRED_REASONING_PAIR_BYTES * SEED_PLUS_RECOUNT_SETS)
    assert.equal(reseededCounters.reasoningTokensSaved, tokensForChars(EXPIRED_REASONING_PAIR_BYTES * SEED_PLUS_RECOUNT_SETS))

    const siblingCountersFinal = countersOf(await readStats(hooks, SESSION_ID_B))
    assert.deepEqual(siblingCountersFinal, siblingCountersAfterEviction)
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
    assert.equal(
      await readEvicted(firstSittingHooks, REHYDRA_MISS_SUBJECT, SESSION_ID),
      stashMissFor(
        REHYDRA_MISS_SUBJECT,
        stashOccupancyLineFor([{ tool: READ_TOOL, subject: REHYDRA_EVICTION_SUBJECT_A, msgIndex: 0 }]),
      ),
    )
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setContextLimit(secondSittingHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
    const resumeTransform = runTransform(secondSittingHooks, buildStandardBundle(SESSION_ID, REHYDRA_EVICTION_SUBJECT_B))
    assert.equal(
      await readEvicted(secondSittingHooks, REHYDRA_MISS_SUBJECT, SESSION_ID),
      stashMissFor(REHYDRA_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY),
    )
    await resumeTransform

    assert.equal(countersOf(await readStats(secondSittingHooks, SESSION_ID)).stashMisses, 2)
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

    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, REHYDRA_STALE_RECORD_EVICTIONS)
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

    const counters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(counters.evictions, REHYDRA_NEWER_RECORD_EVICTIONS)
    assert.equal(counters.dedupedBytes, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

const REHYDRATION_SEED_PROCESSED_BYTES = 50000

test("a newest metrics record carrying processedContextBytes seeds the resumed session with it and its derived tokens", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    writeFileSync(
      metricsPath,
      `${JSON.stringify({
        ...rehydrateSeedLine(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS),
        totals: {
          ...STATS_ZEROED_COUNTERS,
          evictions: REHYDRA_NEWER_RECORD_EVICTIONS,
          processedContextBytes: REHYDRATION_SEED_PROCESSED_BYTES,
          processedContextTokens: tokensForChars(REHYDRATION_SEED_PROCESSED_BYTES),
        },
      })}\n`,
    )

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runQuietProbeTransform(hooks, SESSION_ID)

    const counters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(counters.processedContextBytes, REHYDRATION_SEED_PROCESSED_BYTES + REHYDRA_QUIET_PROBE_CHARS)
    assert.equal(counters.processedContextTokens, tokensForChars(REHYDRATION_SEED_PROCESSED_BYTES + REHYDRA_QUIET_PROBE_CHARS))
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a metrics line predating processedContextBytes still seeds the resumed session with zero for it", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const legacyTotals: Record<string, unknown> = { ...STATS_ZEROED_COUNTERS, evictions: REHYDRA_NEWER_RECORD_EVICTIONS }
    delete legacyTotals.processedContextBytes
    delete legacyTotals.processedContextTokens
    writeFileSync(
      metricsPath,
      `${JSON.stringify({ ...rehydrateSeedLine(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS), totals: legacyTotals })}\n`,
    )

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runQuietProbeTransform(hooks, SESSION_ID)

    const counters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(counters.processedContextBytes, REHYDRA_QUIET_PROBE_CHARS)
    assert.equal(counters.processedContextTokens, tokensForChars(REHYDRA_QUIET_PROBE_CHARS))
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

const LEGACY_METRICS_LOG_BASENAME = "lru-metrics.jsonl"
const LEGACY_LIVE_STATE_DIR_NAME = "lru-state"
const LEGACY_HYGIENE_LOG_BASENAME = "lru-hygiene.jsonl"
const MIGRATION_CUSTOM_DIR_NAME = "custom"
const MIGRATION_BLOCKED_DIR_MODE = 0o555
const MIGRATION_RESTORED_DIR_MODE = 0o755
const MIGRATION_LEGACY_STATE_FILE_NAME = "sess-1.json"
const MIGRATION_STATE_FILE_CONTENT = "{}\n"

// The default-path migration only runs where the defaults actually point,
// so each test relocates HOME to a fresh temp directory for the duration of
// one plugin load and restores it afterwards: homedir() re-reads the
// environment on every call, and the resolved defaults follow it.
const withScopedHome = async (run: (home: string) => Promise<void>): Promise<void> => {
  const home = mkdtempSync(join(tmpdir(), METRICS_TEMP_DIR_PREFIX))
  const previousHome = process.env.HOME
  process.env.HOME = home
  try {
    await run(home)
  } finally {
    process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
}

const scopedDataRootIn = (home: string): string => join(home, ...METRICS_DIR_SEGMENTS)

test("the first default path load renames the legacy metrics log and its rotated sibling to the current names", async () => {
  await withScopedHome(async (home) => {
    const root = scopedDataRootIn(home)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, LEGACY_METRICS_LOG_BASENAME), "legacy newest line\n")
    writeFileSync(join(root, `${LEGACY_METRICS_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`), "legacy rotated line\n")

    await loadPluginHooksWith({ metricsLog: true })

    assert.equal(readFileSync(join(root, METRICS_LOG_BASENAME), "utf8"), "legacy newest line\n")
    assert.equal(readFileSync(join(root, `${METRICS_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`), "utf8"), "legacy rotated line\n")
    assert.equal(existsSync(join(root, LEGACY_METRICS_LOG_BASENAME)), false)
    assert.equal(existsSync(join(root, `${LEGACY_METRICS_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`)), false)
  })
})

test("an existing current-name metrics log wins and the legacy file stays readable beside it", async () => {
  await withScopedHome(async (home) => {
    const root = scopedDataRootIn(home)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, LEGACY_METRICS_LOG_BASENAME), "legacy line\n")
    writeFileSync(join(root, METRICS_LOG_BASENAME), "current line\n")

    await loadPluginHooksWith({ metricsLog: true })

    assert.equal(readFileSync(join(root, METRICS_LOG_BASENAME), "utf8"), "current line\n")
    assert.equal(readFileSync(join(root, LEGACY_METRICS_LOG_BASENAME), "utf8"), "legacy line\n")
  })
})

test("a later default path load moves a rotated sibling stranded beside an already renamed metrics log", async () => {
  await withScopedHome(async (home) => {
    const root = scopedDataRootIn(home)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, METRICS_LOG_BASENAME), "current line\n")
    writeFileSync(join(root, `${LEGACY_METRICS_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`), "legacy rotated line\n")

    await loadPluginHooksWith({ metricsLog: true })

    assert.equal(readFileSync(join(root, `${METRICS_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`), "utf8"), "legacy rotated line\n")
    assert.equal(existsSync(join(root, `${LEGACY_METRICS_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`)), false)
  })
})

test("an existing current-name rotated sibling wins and the legacy sibling stays readable beside it", async () => {
  await withScopedHome(async (home) => {
    const root = scopedDataRootIn(home)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, LEGACY_METRICS_LOG_BASENAME), "legacy line\n")
    writeFileSync(join(root, `${LEGACY_METRICS_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`), "legacy rotated line\n")
    writeFileSync(join(root, METRICS_LOG_BASENAME), "current line\n")
    writeFileSync(join(root, `${METRICS_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`), "current rotated line\n")

    await loadPluginHooksWith({ metricsLog: true })

    assert.equal(readFileSync(join(root, `${METRICS_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`), "utf8"), "current rotated line\n")
    assert.equal(readFileSync(join(root, `${LEGACY_METRICS_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`), "utf8"), "legacy rotated line\n")
    assert.equal(readFileSync(join(root, LEGACY_METRICS_LOG_BASENAME), "utf8"), "legacy line\n")
  })
})

test("the first default path load renames the legacy live state directory to the current name", async () => {
  await withScopedHome(async (home) => {
    const root = scopedDataRootIn(home)
    const legacyStateDir = join(root, LEGACY_LIVE_STATE_DIR_NAME)
    mkdirSync(legacyStateDir, { recursive: true })
    writeFileSync(join(legacyStateDir, MIGRATION_LEGACY_STATE_FILE_NAME), MIGRATION_STATE_FILE_CONTENT)

    await loadPluginHooksWith({ liveStateLog: true })

    assert.equal(readFileSync(join(root, LIVE_STATE_DIR_NAME, MIGRATION_LEGACY_STATE_FILE_NAME), "utf8"), MIGRATION_STATE_FILE_CONTENT)
    assert.equal(existsSync(legacyStateDir), false)
  })
})

test("the first default path load renames the legacy hygiene log and its rotated sibling to the current names", async () => {
  await withScopedHome(async (home) => {
    const root = scopedDataRootIn(home)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, LEGACY_HYGIENE_LOG_BASENAME), "legacy hygiene line\n")
    writeFileSync(join(root, `${LEGACY_HYGIENE_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`), "legacy hygiene rotated line\n")

    await loadPluginHooksWith({ ingestionHygieneCopy: true })

    assert.equal(readFileSync(join(root, HYGIENE_LOG_BASENAME), "utf8"), "legacy hygiene line\n")
    assert.equal(readFileSync(join(root, `${HYGIENE_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`), "utf8"), "legacy hygiene rotated line\n")
    assert.equal(existsSync(join(root, LEGACY_HYGIENE_LOG_BASENAME)), false)
    assert.equal(existsSync(join(root, `${LEGACY_HYGIENE_LOG_BASENAME}${METRICS_ROTATION_SUFFIX}`)), false)
  })
})

test("custom path options leave the legacy default locations untouched", async () => {
  await withScopedHome(async (home) => {
    const root = scopedDataRootIn(home)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, LEGACY_METRICS_LOG_BASENAME), "legacy metrics\n")
    const legacyStateDir = join(root, LEGACY_LIVE_STATE_DIR_NAME)
    mkdirSync(legacyStateDir, { recursive: true })
    writeFileSync(join(root, LEGACY_HYGIENE_LOG_BASENAME), "legacy hygiene\n")
    const customDir = join(home, MIGRATION_CUSTOM_DIR_NAME)
    mkdirSync(customDir, { recursive: true })

    await loadPluginHooksWith({
      metricsLog: true,
      liveStateLog: true,
      ingestionHygieneCopy: true,
      metricsPath: join(customDir, "metrics.jsonl"),
      liveStatePath: join(customDir, "state"),
      ingestionHygienePath: join(customDir, "hygiene.jsonl"),
    })

    assert.equal(readFileSync(join(root, LEGACY_METRICS_LOG_BASENAME), "utf8"), "legacy metrics\n")
    assert.equal(existsSync(legacyStateDir), true)
    assert.equal(readFileSync(join(root, LEGACY_HYGIENE_LOG_BASENAME), "utf8"), "legacy hygiene\n")
    assert.equal(existsSync(join(root, METRICS_LOG_BASENAME)), false)
    assert.equal(existsSync(join(root, LIVE_STATE_DIR_NAME)), false)
    assert.equal(existsSync(join(root, HYGIENE_LOG_BASENAME)), false)
  })
})

test("an unwritable legacy location leaves the old metrics log in place and still loads the plugin", async () => {
  await withScopedHome(async (home) => {
    const root = scopedDataRootIn(home)
    mkdirSync(root, { recursive: true })
    const legacyMetricsPath = join(root, LEGACY_METRICS_LOG_BASENAME)
    writeFileSync(legacyMetricsPath, "legacy metrics\n")
    chmodSync(root, MIGRATION_BLOCKED_DIR_MODE)
    try {
      const hooks = await loadPluginHooksWith({ metricsLog: true })
      const stats = await readStats(hooks, SESSION_ID)
      assert.equal(typeof stats.options, "object")
    } finally {
      chmodSync(root, MIGRATION_RESTORED_DIR_MODE)
    }

    assert.equal(readFileSync(legacyMetricsPath, "utf8"), "legacy metrics\n")
  })
})

test("context_stats is callable and the legacy lru_stats name is no longer registered", async () => {
  const hooks = await loadPluginHooks()

  assert.equal((hooks as Record<string, Record<string, unknown>>)[RELOAD_TOOL_MAP_KEY]["lru_stats"], undefined)
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(typeof stats.options, "object")
})

test("the panel command registers under the context slash name and command id", () => {
  assert.equal(PANEL_COMMAND_SLASH_NAME, "context")
  assert.equal(PANEL_COMMAND_NAME, "context.panel")
  assert.equal(PANEL_COMMAND_NAMESPACE, "palette")
  assert.equal(PANEL_COMMAND_CATEGORY, "Context")
})

test("the plugin entry exports the v1 module object with the shared id and the server factory", () => {
  assert.equal(typeof contextManagerEntry, "object")
  assert.ok(contextManagerEntry !== null)
  assert.equal(typeof PLUGIN_ID, "string")
  assert.ok(PLUGIN_ID.length > 0)
  assert.equal(contextManagerEntry.id, PLUGIN_ID)
  assert.equal(typeof contextManagerEntry.server, "function")
})

const PAGE_STORE_LOG_FILE_NAME = "pages.jsonl"
const PAGE_STORE_SEED_TS = "2026-10-01T00:00:00.000Z"
const PAGE_STORE_EVICTED_SUBJECT = "/data/page-store-evicted.txt"
const PAGE_STORE_DISABLED_PROBE_SUBJECT = "/data/page-store-disabled.txt"
const PAGE_STORE_ROTATION_A_SUBJECT = "/data/page-store-rotation-a.txt"
const PAGE_STORE_ROTATION_B_SUBJECT = "/data/page-store-rotation-b.txt"
const PAGE_STORE_REPLACEMENT_SUBJECT = "/data/page-store-replacement.txt"
const PAGE_STORE_ROUNDTRIP_SUBJECT = "/data/page-store-roundtrip.txt"
const PAGE_STORE_OLDER_SUBJECT = "/data/page-store-older.txt"
const PAGE_STORE_OLDER_OUTPUTS = ["older page one", "older page two", "newest page of three"]
const PAGE_STORE_ATTACHED_SUBJECT = "/data/page-store-attached.txt"
const PAGE_STORE_CORRUPT_SUBJECT = "/data/page-store-corrupt.txt"
const PAGE_STORE_CORRUPT_GOOD_OUTPUT = "the one well-formed page"
const PAGE_STORE_FAULT_RELOADED = "/data/page-store-fault-reloaded.txt"
const PAGE_STORE_FAULT_SIBLING = "/data/page-store-fault-sibling.txt"
const PAGE_STORE_ABSENT_MISS_SUBJECT = "/data/page-store-absent.txt"
const PAGE_STORE_DIRECTORY_NAME = "store-dir"
const PAGE_STORE_WRITE_BLOCKED_DIR = "missing-subdir"
const PAGE_STORE_STALE_ROTATED_CONTENT = "stale rotated pages\n"
const PAGE_STORE_CUSTOM_PATH_TAIL = "custom-pages.jsonl"
const PAGE_STORE_CUSTOM_ROTATION_CAP = 4096
const PAGE_STORE_INVALID_ROTATION_CAPS = [-1, Number.NaN, Number.POSITIVE_INFINITY]

const pageStorePathIn = (dir: string): string => join(dir, PAGE_STORE_LOG_FILE_NAME)

const rotatedPageStorePathIn = (dir: string): string => `${pageStorePathIn(dir)}${METRICS_ROTATION_SUFFIX}`

const blockedPageStorePathIn = (dir: string): string => join(dir, PAGE_STORE_WRITE_BLOCKED_DIR, PAGE_STORE_LOG_FILE_NAME)

const loadPluginHooksWithPageStore = async (storePath: string, extra: Record<string, unknown> = {}): Promise<HookMap> =>
  loadPluginHooksWith({ pageStore: true, pageStorePath: storePath, ...extra })

const pageLinesIn = (storePath: string): Record<string, unknown>[] =>
  readFileSync(storePath, "utf8")
    .split(METRICS_LINE_SEPARATOR)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

const seedPageStore = (storePath: string, lines: Record<string, unknown>[]): void =>
  writeFileSync(storePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`)

const pageLineOf = (subject: string, output: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ts: PAGE_STORE_SEED_TS,
  session: SESSION_ID,
  tool: READ_TOOL,
  subject,
  msgIndex: 0,
  partIndex: 0,
  output,
  ...extra,
})

const runPageStoreEviction = async (hooks: HookMap, sessionID: string, path: string): Promise<StrictBundle> => {
  await setContextLimit(hooks, sessionID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  const bundle = buildStandardBundle(sessionID, path)
  await runTransform(hooks, bundle)
  return bundle
}

test("an eviction appends one well-formed page line to the store in the same transform run", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)

    const bundle = await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)

    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
    const lines = pageLinesIn(storePath)
    assert.equal(lines.length, 1)
    assertValidTimestamp(lines[0].ts)
    assert.equal(lines[0].session, SESSION_ID)
    assert.equal(lines[0].tool, READ_TOOL)
    assert.equal(lines[0].subject, PAGE_STORE_EVICTED_SUBJECT)
    assert.equal(lines[0].msgIndex, 0)
    assert.equal(lines[0].partIndex, 0)
    assert.equal(lines[0].output, outputOfBytes(MIN_EVICTABLE_BYTES))
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a fence eviction appends its page line with the fence label and the span slot", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath, { userFenceEviction: { enabled: true } })
    const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
    await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`))

    const lines = pageLinesIn(storePath)
    assert.equal(lines.length, 1)
    assert.equal(lines[0].tool, FENCE_STASH_TOOL_LABEL)
    assert.equal(lines[0].subject, fenceFirstLineOf(FENCE_LINE_TAG))
    assert.equal(lines[0].stashSlot, 1)
    assert.equal(lines[0].output, `${block}\n`)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("pageStore false writes nothing to the store path", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWith({})

    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_DISABLED_PROBE_SUBJECT)

    assert.equal(existsSync(storePath), false)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("pageStoreRotationMaxBytes zero writes nothing to the store path", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath, { pageStoreRotationMaxBytes: METRICS_ROTATION_DISABLED_MAX_BYTES })

    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_DISABLED_PROBE_SUBJECT)

    assert.equal(existsSync(storePath), false)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("the page store rotates to the .1 sibling when an append would cross the cap", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const probeHooks = await loadPluginHooksWithPageStore(storePath)
    await runPageStoreEviction(probeHooks, SESSION_ID, PAGE_STORE_ROTATION_A_SUBJECT)
    const capBytes = statSync(storePath).size
    rmSync(storePath)

    const hooks = await loadPluginHooksWithPageStore(storePath, { pageStoreRotationMaxBytes: capBytes })
    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_ROTATION_A_SUBJECT)
    assert.equal(existsSync(rotatedPageStorePathIn(pagesDir)), false)
    assert.equal(statSync(storePath).size, capBytes)

    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_ROTATION_B_SUBJECT)

    const rotatedLines = pageLinesIn(rotatedPageStorePathIn(pagesDir))
    assert.equal(rotatedLines.length, 1)
    assert.equal(rotatedLines[0].subject, PAGE_STORE_ROTATION_A_SUBJECT)
    const freshLines = pageLinesIn(storePath)
    assert.equal(freshLines.length, 1)
    assert.equal(freshLines[0].subject, PAGE_STORE_ROTATION_B_SUBJECT)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("page store rotation replaces a prior .1 sibling with the rotated file", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const seedLine = pageLineOf(PAGE_STORE_ROTATION_A_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES))
    const seedContent = `${JSON.stringify(seedLine)}\n`
    writeFileSync(storePath, seedContent)
    writeFileSync(rotatedPageStorePathIn(pagesDir), PAGE_STORE_STALE_ROTATED_CONTENT)

    const hooks = await loadPluginHooksWithPageStore(storePath, { pageStoreRotationMaxBytes: METRICS_ROTATION_TINY_CAP })
    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_REPLACEMENT_SUBJECT)

    assert.equal(readFileSync(rotatedPageStorePathIn(pagesDir), "utf8"), seedContent)
    const freshLines = pageLinesIn(storePath)
    assert.equal(freshLines.length, 1)
    assert.equal(freshLines[0].subject, PAGE_STORE_REPLACEMENT_SUBJECT)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a page store write failure surfaces pageStoreWriteError and never blocks the eviction", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithPageStore(blockedPageStorePathIn(pagesDir))

    const bundle = await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)

    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
    const stats = await readStats(hooks, SESSION_ID)
    assert.equal(typeof stats.pageStoreWriteError, "string")
    assert.ok((stats.pageStoreWriteError as string).length > 0)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a fresh plugin instance reloads a prior session's evicted original through the page store", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const firstSittingHooks = await loadPluginHooksWithPageStore(storePath)
    await runPageStoreEviction(firstSittingHooks, SESSION_ID, PAGE_STORE_ROUNDTRIP_SUBJECT)

    const secondSittingHooks = await loadPluginHooksWithPageStore(storePath)
    assert.equal(
      await readEvicted(secondSittingHooks, PAGE_STORE_ROUNDTRIP_SUBJECT, SESSION_ID_B),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
    assert.equal(countersOf(await readStats(secondSittingHooks, SESSION_ID_B)).stashHits, 1)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a page store hit returns the newest page in full and counts the older pages", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)
    seedPageStore(storePath, PAGE_STORE_OLDER_OUTPUTS.map((output) => pageLineOf(PAGE_STORE_OLDER_SUBJECT, output)))

    assert.equal(
      await readEvicted(hooks, PAGE_STORE_OLDER_SUBJECT, SESSION_ID),
      `${PAGE_STORE_OLDER_OUTPUTS[2]}\n${PAGE_STORE_RESTORED_LINE}\n${pageStoreOlderLineFor(PAGE_STORE_OLDER_SUBJECT, 2)}`,
    )
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a page store hit appends the attachments manifest when the page carries attachments", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_ATTACHED_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES), {
        attachments: [attachmentItemOf(ATTACHMENT_MIME_PNG, ATTACHMENT_PAYLOAD_CHARS_PRIMARY, "call_pagestore")],
      }),
    ])

    assert.equal(
      await readEvicted(hooks, PAGE_STORE_ATTACHED_SUBJECT, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}\n${attachmentManifestLineFor([
        attachmentSummaryFor(ATTACHMENT_MIME_PNG, ATTACHED_URL_PRIMARY_CHARS),
      ])}`,
    )
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a page store hit fault-protects the reading session like an in-session reload", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const firstSittingHooks = await loadPluginHooksWithPageStore(storePath)
    await runPageStoreEviction(firstSittingHooks, SESSION_ID, PAGE_STORE_FAULT_RELOADED)

    const secondSittingHooks = await loadPluginHooksWithPageStore(storePath)
    assert.ok((await readEvicted(secondSittingHooks, PAGE_STORE_FAULT_RELOADED, SESSION_ID)).startsWith(outputOfBytes(MIN_EVICTABLE_BYTES)))

    const bundle = await runFaultContest(secondSittingHooks, [PAGE_STORE_FAULT_RELOADED, PAGE_STORE_FAULT_SIBLING], OVER_BY_ONE_TOKENS)
    assertEntryTombstoned(bundle, 1)
    assertEntryKept(bundle, 0)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("an in-session stash hit keeps precedence over the page store and stays byte-identical", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)

    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)

    assert.equal(await readEvicted(hooks, PAGE_STORE_EVICTED_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a page store holding corrupt lines skips them and still serves the well-formed page", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)
    const rejectedLine = pageLineOf(PAGE_STORE_CORRUPT_SUBJECT, "rejected: the output field is missing")
    delete rejectedLine.output
    writeFileSync(
      storePath,
      `{"broken": true\n${JSON.stringify(rejectedLine)}\n${JSON.stringify(pageLineOf(PAGE_STORE_CORRUPT_SUBJECT, PAGE_STORE_CORRUPT_GOOD_OUTPUT))}\n`,
    )

    assert.equal(
      await readEvicted(hooks, PAGE_STORE_CORRUPT_SUBJECT, SESSION_ID),
      `${PAGE_STORE_CORRUPT_GOOD_OUTPUT}\n${PAGE_STORE_RESTORED_LINE}`,
    )
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("an absent or empty page store degrades to the composed miss naming the no page clause", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(
      await readEvicted(hooks, PAGE_STORE_ABSENT_MISS_SUBJECT, SESSION_ID),
      stashMissFor(PAGE_STORE_ABSENT_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY),
    )

    writeFileSync(storePath, "")
    assert.equal(
      await readEvicted(hooks, PAGE_STORE_ABSENT_MISS_SUBJECT, SESSION_ID),
      stashMissFor(PAGE_STORE_ABSENT_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY),
    )
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("an unreadable page store degrades to the composed miss instead of a tool error", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithPageStore(blockedPageStorePathIn(pagesDir))

    const result = await readEvicted(hooks, PAGE_STORE_ABSENT_MISS_SUBJECT, SESSION_ID)

    assert.equal(result, stashMissFor(PAGE_STORE_ABSENT_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY))
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a page store path pointing at a directory degrades to the composed miss instead of a tool error", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storeDir = join(pagesDir, PAGE_STORE_DIRECTORY_NAME)
    mkdirSync(storeDir)
    const hooks = await loadPluginHooksWithPageStore(storeDir)

    assert.equal(
      await readEvicted(hooks, PAGE_STORE_ABSENT_MISS_SUBJECT, SESSION_ID),
      stashMissFor(PAGE_STORE_ABSENT_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY),
    )
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("pageStore options resolve beside the metrics log defaults round trip and fall back on invalid values", async () => {
  const defaultHooks = (await contextManagerFactory(
    {},
    { metricsLog: false, liveStateLog: false, ingestionHygieneCopy: false },
  )) as HookMap
  const defaultOptions = (await readStats(defaultHooks, SESSION_ID)).options as Record<string, unknown>
  assert.equal(defaultOptions.pageStore, true)
  assert.equal(defaultOptions.pageStorePath, DEFAULT_PAGE_STORE_PATH)
  assert.equal(defaultOptions.pageStoreRotationMaxBytes, DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES)
  assert.equal(DEFAULT_PAGE_STORE_PATH, join(homedir(), ".local", "share", "opencode", "context-pages.jsonl"))

  const customHooks = await loadPluginHooksWith({
    pageStore: false,
    pageStorePath: join(PAGE_STORE_CUSTOM_PATH_TAIL, PAGE_STORE_LOG_FILE_NAME),
    pageStoreRotationMaxBytes: PAGE_STORE_CUSTOM_ROTATION_CAP,
  })
  const customOptions = (await readStats(customHooks, SESSION_ID)).options as Record<string, unknown>
  assert.equal(customOptions.pageStore, false)
  assert.equal(customOptions.pageStorePath, join(PAGE_STORE_CUSTOM_PATH_TAIL, PAGE_STORE_LOG_FILE_NAME))
  assert.equal(customOptions.pageStoreRotationMaxBytes, PAGE_STORE_CUSTOM_ROTATION_CAP)

  for (const invalidCap of PAGE_STORE_INVALID_ROTATION_CAPS) {
    const invalidHooks = await loadPluginHooksWith({ pageStoreRotationMaxBytes: invalidCap })
    const invalidOptions = (await readStats(invalidHooks, SESSION_ID)).options as Record<string, unknown>
    assert.equal(invalidOptions.pageStoreRotationMaxBytes, DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES)
  }
  const invalidSwitchHooks = await loadPluginHooksWith({ pageStore: "yes", pageStorePath: 42 })
  const invalidSwitchOptions = (await readStats(invalidSwitchHooks, SESSION_ID)).options as Record<string, unknown>
  assert.equal(invalidSwitchOptions.pageStore, true)
  assert.equal(invalidSwitchOptions.pageStorePath, DEFAULT_PAGE_STORE_PATH)
})
