import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import contextManagerEntry, {
  ADVISORY_BAND_RATIO_DEFAULT,
  DEFAULT_INGESTION_HYGIENE_ROTATION_MAX_BYTES,
  DEFAULT_METRICS_ROTATION_MAX_BYTES,
  DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES,
  METRIC_NUMBER_KEYS,
  METRICS_CURSOR_KEYS,
  PAGE_STORE_SCHEMA_VERSION,
  RAW_COUNTER_KEYS,
} from "../plugin/context-manager.ts"
import { resolveOptions } from "../plugin/options.ts"
import type { ResolvedOptions } from "../plugin/options.ts"
import {
  pageKeyOf,
  PAGE_STORE_SUMMARY_LINE_KIND,
  pageStoreMatchesFor,
  recordPageStoreSummaryLines,
} from "../plugin/page-store.ts"
import type {
  PageStoreBySession,
  PageStoreGuard,
  PageSummaryLookup,
  PageSummaryRecord,
  SessionPageStore,
  StoredPageMatch,
} from "../plugin/page-store.ts"
import { executeReadEvicted, RECALL_TOOL_ARGS, RECALL_VERBATIM_ARG_SCHEMA } from "../plugin/tools.ts"
import { loadPanelData, PANEL_COMMAND_CATEGORY, PANEL_COMMAND_NAME, PANEL_COMMAND_NAMESPACE, PANEL_COMMAND_SLASH_NAME } from "../plugin/panel-data.ts"
import {
  DEFAULT_SUMMARY_TOKEN_BUDGET as SCHEMA_DEFAULT_SUMMARY_TOKEN_BUDGET,
  OPTION_SUMMARIZE_EVICTED_OUTPUTS,
  OPTION_SUMMARY_TOKEN_BUDGET,
  PLUGIN_ID,
  PLUGIN_VERSION,
  OPTION_CACHE_AWARE_HINTS,
  OPTION_MUTATION_BATCH_CADENCE,
  TOTALS_KEYS,
} from "../plugin/schema.ts"
import { DEFAULT_SUMMARY_TOKEN_BUDGET as SUMMARIES_DEFAULT_SUMMARY_TOKEN_BUDGET } from "../plugin/summaries.ts"
import type { MetricsStore } from "../plugin/state.ts"

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
const PROTECTED_MULTIPLIER_BUNDLE_CHARS = 2 * THREE_ENTRY_OUTPUT_BYTES + RECENT_WINDOW_FILLER_MESSAGES * FILLER_TEXT_CHARS
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
const STABLE_HINT_ALPHA_PATH = "/data/alpha.txt"
const STABLE_HINT_ZEBRA_PATH = "/data/zebra.txt"
const STABLE_HINT_ENTRY_PATH = "/data/stable-entry.txt"
const STABLE_HINT_ISOLATION_PATH_B = "/data/from-b.txt"
const STABLE_HINT_RUNS_TO_ENTER = 3
const STABLE_HINT_RUNS_TO_EXIT = 2
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
const RECALL_TOOL_NAME = "recall"
const TOOL_MAP_KEY = "tool"
const RECALL_POINTER_LEAD = " Evicted output stored in the page store; recall it with"
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
const STASH_EMPTY_OCCUPANCY = `${STASH_MARKER} ${STASH_OCCUPANCY_LEAD} ${STASH_OCCUPANCY_EMPTY_TAIL}.`
const RECALL_ARG_NAME = "subject"
const RECALL_PROBE_ARG_NAME = "countsOnly"
const RECALL_PROBE_LEAD = "counts-only probe for"
const RECALL_PROBE_IN_SESSION_LABEL = "in-session matches"
const RECALL_PROBE_PAGE_STORE_LABEL = "page-store matches"
const RECALL_PROBE_NEWEST_LABEL = "newest match"
const RECALL_PROBE_BYTES_UNIT = "bytes"
const RECALL_PROBE_OLDER_LABEL = "older matches"
const RECALL_PROBE_ATTACHMENTS_LABEL = "attachments present"
const RECALL_PROBE_SUMMARY_LABEL = "summary"
const RECALL_VERBATIM_ARG_NAME = "verbatim"
const SUMMARY_MARKER = "[ctx-summary]"
const SUMMARY_SERVE_INSTRUCTION = "condensed summary of the evicted output; pass verbatim: true to reload the full original"
const STASH_SUMMARY_SUBJECT = "/data/stash-summarized.txt"
const PROBE_HIT_SUBJECT = "/data/probe-hit.txt"
const PROBE_SIBLING_SUBJECT = "/data/probe-sibling.txt"
const PROBE_MISS_SUBJECT = "/data/probe-miss.txt"
const PROBE_REGRESSION_SUBJECT = "/data/probe-regression.txt"
const PROBE_REGRESSION_MISS_SUBJECT = "/data/probe-regression-miss.txt"
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

type RecallToolDefinition = { execute: (args: unknown, context: unknown) => Promise<unknown> }

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
  `${RECALL_POINTER_LEAD} ${RECALL_TOOL_NAME} (subject "${subject}").`

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

const pageStoreOccupancyLineFor = (entries: OccupancyEntryShape[]): string => {
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
  `${STASH_MARKER} ${RECALL_TOOL_NAME} ${STASH_INVALID_SUBJECT_LEAD} (${RECEIVED_LABEL} ${received}).`

const olderMatchesLineFor = (subject: string, pointers: string[]): string =>
  `${STASH_MARKER} ${STASH_OLDER_LEAD} "${subject}": ${pointers.join(STASH_MATCH_SEPARATOR)}`

const pointerFor = (tool: string, msgIndex: number): string => `${tool} ${STASH_MESSAGE_LABEL} ${msgIndex}`

const dedupTombstoneFor = (tool: string, msgIndex: number): string =>
  `${DEDUP_MARKER} ${tool} ${DEDUP_SUPERSEDED_LEAD} ${msgIndex}`

const fileDedupTombstoneFor = (label: string, msgIndex: number): string =>
  `${DEDUP_MARKER} ${label} ${DEDUP_FILE_SUPERSEDED_LEAD} ${msgIndex}`

const recallToolArgs = async (hooks: HookMap, args: Record<string, unknown>, sessionID: string): Promise<unknown> =>
  (hooks as Record<string, Record<string, RecallToolDefinition>>)[TOOL_MAP_KEY][RECALL_TOOL_NAME].execute(args, { sessionID })

const recallTool = async (hooks: HookMap, subject: unknown, sessionID: string): Promise<unknown> =>
  recallToolArgs(hooks, { subject }, sessionID)

const probeCountsLineFor = (
  subject: string,
  inSessionMatches: number,
  pageStoreMatches: number,
  newestMatchBytes: number,
  olderMatches: number,
  attachmentsPresent: boolean,
  summaryBytes?: number,
): string => {
  const summaryClause = summaryBytes === undefined ? "" : `, ${RECALL_PROBE_SUMMARY_LABEL} ${summaryBytes} ${RECALL_PROBE_BYTES_UNIT}`
  return `${STASH_MARKER} ${RECALL_PROBE_LEAD} "${subject}": ${RECALL_PROBE_IN_SESSION_LABEL} ${inSessionMatches}, ${RECALL_PROBE_PAGE_STORE_LABEL} ${pageStoreMatches}, ${RECALL_PROBE_NEWEST_LABEL} ${newestMatchBytes} ${RECALL_PROBE_BYTES_UNIT}${summaryClause}, ${RECALL_PROBE_OLDER_LABEL} ${olderMatches}, ${RECALL_PROBE_ATTACHMENTS_LABEL}: ${attachmentsPresent ? "true" : "false"}.`
}

const summaryServeTextFor = (summary: string): string =>
  `${SUMMARY_MARKER} ${SUMMARY_SERVE_INSTRUCTION}.\n${summary}`

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
  assert.equal(await recallTool(hooks, path, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
}

const evictAndReloadEach = async (hooks: HookMap, paths: string[]): Promise<void> => {
  await runTransform(
    hooks,
    buildBundle([...paths.map((path) => [pathToolPart(path, MIN_EVICTABLE_BYTES)]), ...fillerMessages()]),
  )
  for (const path of paths) {
    assert.equal(await recallTool(hooks, path, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
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

const buildThreeEntryDeficitBundle = (): StrictBundle =>
  buildBundle([
    [pathToolPart("/data/a.txt", THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart("/data/b.txt", THREE_ENTRY_OUTPUT_BYTES)],
    [pathToolPart("/data/c.txt", THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])

const EVICTION_BATCH_MULTIPLIER_INVALID_VALUES = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2"]

test("the eviction batch multiplier default clears exactly one deficit and reports the true deficit", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(THREE_ENTRY_BUNDLE_CHARS, PARTIAL_DEFICIT_TOKENS))

  const bundle = buildThreeEntryDeficitBundle()
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(toolPartAt(bundle.messages[2], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, 1)
  const lastRun = (await readStats(hooks, SESSION_ID)).lastRun as Record<string, unknown>
  assert.equal(lastRun.deficitTokens, PARTIAL_DEFICIT_TOKENS)
})

test("the eviction batch multiplier at two clears twice the deficit per walk without moving the reported deficit", async () => {
  const hooks = await loadPluginHooksWith({ evictionBatchMultiplier: 2 })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(THREE_ENTRY_BUNDLE_CHARS, PARTIAL_DEFICIT_TOKENS))

  const bundle = buildThreeEntryDeficitBundle()
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.ok(toolPartAt(bundle.messages[1], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(bundle.messages[2], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, 2)
  const lastRun = (await readStats(hooks, SESSION_ID)).lastRun as Record<string, unknown>
  assert.equal(lastRun.deficitTokens, PARTIAL_DEFICIT_TOKENS)
})

test("invalid evictionBatchMultiplier values fall back to the identity multiplier", async () => {
  for (const invalid of EVICTION_BATCH_MULTIPLIER_INVALID_VALUES) {
    const hooks = await loadPluginHooksWith({ evictionBatchMultiplier: invalid })
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(THREE_ENTRY_BUNDLE_CHARS, PARTIAL_DEFICIT_TOKENS))

    const bundle = buildThreeEntryDeficitBundle()
    await runTransform(hooks, bundle)

    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER), `output a must evict for ${String(invalid)}`)
    assert.equal(toolPartAt(bundle.messages[1], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES), `output b must survive for ${String(invalid)}`)
    assert.equal(toolPartAt(bundle.messages[2], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES), `output c must survive for ${String(invalid)}`)
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, 1, `exactly one eviction must land for ${String(invalid)}`)
  }
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
    return tombstone.slice(digestStart, tombstone.indexOf(RECALL_POINTER_LEAD, digestStart))
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

test("transform skips context-limit-driven eviction when chat params carry no context limit", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsWithoutContext(hooks, SESSION_ID)

  const bundle = buildFallbackBudgetBundle(LEGACY_FALLBACK_BUNDLE_OVER_WATERMARK_CHARS)
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("transform purges errored tool inputs on an unknown-limit run that skips eviction", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsWithoutContext(hooks, SESSION_ID)

  const bundle = buildBundle([
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])
  await runTransform(hooks, bundle)

  assert.equal(inputAt(bundle.messages[0]), PURGE_MARKER)
})

test("transform delivers a hint on an unknown-limit run that skips eviction", async () => {
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
  assert.equal(stats.contextLimit, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
})

test("transform lets the per model override beat the model reported limit and labels the context-limit source override", async () => {
  const hooks = await loadPluginHooksWith({ modelContextTokens: { [OVERRIDE_MODEL_KEY]: SMALL_CONTEXT_LIMIT } })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, LARGE_DEFAULT_CONTEXT_TOKENS)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-beats-reported.txt")
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.contextLimit, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
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
  assert.equal(stats.contextLimit, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
})

test("transform applies the per model override when chat params carry no reported context limit", async () => {
  const hooks = await loadPluginHooksWith({ modelContextTokens: { [OVERRIDE_MODEL_KEY]: SMALL_CONTEXT_LIMIT } })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, undefined)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-without-reported.txt")
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.contextLimit, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
})

test("transform ignores per model map entries for unknown model ids and keeps the reported limit in charge", async () => {
  const hooks = await loadPluginHooksWith({ modelContextTokens: { [OTHER_MODEL_KEY]: SMALL_CONTEXT_LIMIT } })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, "/data/override-unknown-model.txt")
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(stats.contextLimit, WATERMARK_PROBE_CONTEXT_LIMIT)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
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
  assert.equal(stats.contextLimit, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
})

test("transform ignores infinite override entries and an infinite defaultContextTokens option and falls through to the unknown context limit", async () => {
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
  assert.equal(stats.contextLimit, null)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
})

test("transform ignores an infinite model reported limit and falls through to the explicit defaultContextTokens option", async () => {
  const hooks = await loadPluginHooksWith({ defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, INFINITE_REPORTED_CONTEXT)

  const bundle = buildStandardBundle(SESSION_ID, "/data/infinite-reported.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.contextLimit, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
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

test("transform keeps session context limits isolated across repeated transforms with no cross talk", async () => {
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

test("transform resets a stored context limit captured for one model when a later chat params event names a different model without a limit", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setChatParamsForModel(hooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID)

  const bundle = buildStandardBundle(SESSION_ID, "/data/model-switch-reset.txt")
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.contextLimit, null)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: null,
    deficitTokens: null,
  })
})

test("transform retains a stored context limit when a later chat params event re-fires the same model without a limit", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID)

  const bundle = buildStandardBundle(SESSION_ID, "/data/model-same-retain.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.contextLimit, WATERMARK_PROBE_CONTEXT_LIMIT)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
})

test("transform retains a stored identity-less context limit when a later chat params event names a different model without a limit", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setChatParamsForModel(hooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID)

  const bundle = buildStandardBundle(SESSION_ID, "/data/model-identity-less-retain.txt")
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.contextLimit, WATERMARK_PROBE_CONTEXT_LIMIT)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
})

test("transform replaces the stored context limit when a later chat params event names a different model with its own reported limit", async () => {
  const hooks = await loadPluginHooks()
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, ISOLATION_CONTEXT_LIMIT_A)
  await setChatParamsForModel(hooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID, ISOLATION_CONTEXT_LIMIT_B)

  const bundle = buildStandardBundle(SESSION_ID, "/data/model-switch-limit.txt")
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.contextLimit, ISOLATION_CONTEXT_LIMIT_B)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
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

const loadCacheAwareHintHooks = async (): Promise<HookMap> => loadPluginHooksWith({ [OPTION_CACHE_AWARE_HINTS]: true })

const runStableHintTurn = async (hooks: HookMap, partsPerMessage: MessagePart[][], sessionID: string = SESSION_ID): Promise<string[]> => {
  await runTransform(hooks, buildBundle([...partsPerMessage, ...fillerMessages(2)], sessionID))
  return runSystemTransform(hooks, sessionID, [BASE_SYSTEM_BLOCK])
}

const runStableHintTurns = async (
  hooks: HookMap,
  turns: number,
  partsPerMessage: MessagePart[][],
  sessionID: string = SESSION_ID,
): Promise<string[]> => {
  let blocks: string[] = []
  for (let runIndex = 0; runIndex < turns; runIndex += 1) {
    blocks = await runStableHintTurn(hooks, partsPerMessage, sessionID)
  }
  return blocks
}

test("chat system transform with cacheAwareHints off keeps the touch-recency rendering with range numerals", async () => {
  const hooks = await loadPluginHooksWith({ [OPTION_CACHE_AWARE_HINTS]: false })

  const blocks = await runStableHintTurn(hooks, [
    [
      completedToolPart(
        READ_TOOL,
        { [PATH_INPUT_KEY]: RANGE_PATH, [OFFSET_INPUT_KEY]: READ_OFFSET_LINES, [LIMIT_INPUT_KEY]: READ_LIMIT_LINES },
        outputOfBytes(MIN_EVICTABLE_BYTES),
      ),
    ],
    [pathToolPart("/data/newer.txt", MIN_EVICTABLE_BYTES)],
    [pathToolPart("/data/older.txt", MIN_EVICTABLE_BYTES)],
  ])

  assert.deepEqual(hintBlocksIn(blocks), [
    hintLineFor(["/data/older.txt", "/data/newer.txt", `${RANGE_PATH}:${READ_OFFSET_LINES}-${READ_OFFSET_LINES + READ_LIMIT_LINES}`]),
  ])
})

test("chat system transform with cacheAwareHints enters a subject only after the entry touches accumulate across runs", async () => {
  const hooks = await loadCacheAwareHintHooks()
  const entryTurn = [[pathToolPart(STABLE_HINT_ENTRY_PATH, MIN_EVICTABLE_BYTES)]]

  for (let runIndex = 1; runIndex < STABLE_HINT_RUNS_TO_ENTER; runIndex += 1) {
    assert.deepEqual(hintBlocksIn(await runStableHintTurn(hooks, entryTurn)), [])
  }
  const blocks = await runStableHintTurn(hooks, entryTurn)

  assert.deepEqual(hintBlocksIn(blocks), [hintLineFor([STABLE_HINT_ENTRY_PATH])])
})

test("chat system transform with cacheAwareHints keeps the hint bytes identical across touch reordering", async () => {
  const hooks = await loadCacheAwareHintHooks()
  const firstTouchTurn = [
    [pathToolPart(STABLE_HINT_ALPHA_PATH, MIN_EVICTABLE_BYTES)],
    [pathToolPart(STABLE_HINT_ZEBRA_PATH, MIN_EVICTABLE_BYTES)],
  ]
  const flippedTouchTurn = [
    [pathToolPart(STABLE_HINT_ZEBRA_PATH, MIN_EVICTABLE_BYTES)],
    [pathToolPart(STABLE_HINT_ALPHA_PATH, MIN_EVICTABLE_BYTES)],
  ]

  const enteredLine = hintBlocksIn(await runStableHintTurns(hooks, STABLE_HINT_RUNS_TO_ENTER, firstTouchTurn))
  assert.deepEqual(enteredLine, [hintLineFor([STABLE_HINT_ALPHA_PATH, STABLE_HINT_ZEBRA_PATH])])

  const reorderedLine = hintBlocksIn(await runStableHintTurn(hooks, flippedTouchTurn))

  assert.deepEqual(reorderedLine, enteredLine)
})

test("chat system transform with cacheAwareHints keeps a member through one missed run and exits it after the exit misses", async () => {
  const hooks = await loadCacheAwareHintHooks()
  const bothMemberTurn = [
    [pathToolPart(STABLE_HINT_ALPHA_PATH, MIN_EVICTABLE_BYTES)],
    [pathToolPart(STABLE_HINT_ZEBRA_PATH, MIN_EVICTABLE_BYTES)],
  ]
  const survivorTurn = [[pathToolPart(STABLE_HINT_ALPHA_PATH, MIN_EVICTABLE_BYTES)]]

  const bothMemberLine = hintBlocksIn(await runStableHintTurns(hooks, STABLE_HINT_RUNS_TO_ENTER, bothMemberTurn))
  assert.deepEqual(bothMemberLine, [hintLineFor([STABLE_HINT_ALPHA_PATH, STABLE_HINT_ZEBRA_PATH])])

  for (let runIndex = 1; runIndex < STABLE_HINT_RUNS_TO_EXIT; runIndex += 1) {
    assert.deepEqual(hintBlocksIn(await runStableHintTurn(hooks, survivorTurn)), bothMemberLine)
  }
  const exitedLine = hintBlocksIn(await runStableHintTurn(hooks, survivorTurn))

  assert.deepEqual(exitedLine, [hintLineFor([STABLE_HINT_ALPHA_PATH])])
})

test("chat system transform with cacheAwareHints renders a ranged subject once as its bare path without numerals", async () => {
  const hooks = await loadCacheAwareHintHooks()
  const rangedReadAt = (offset: number): CompletedToolPart =>
    completedToolPart(READ_TOOL, { [PATH_INPUT_KEY]: RANGE_PATH, [OFFSET_INPUT_KEY]: offset, [LIMIT_INPUT_KEY]: READ_LIMIT_LINES }, outputOfBytes(MIN_EVICTABLE_BYTES))
  const rangedTurn = [[rangedReadAt(READ_OFFSET_LINES)], [rangedReadAt(READ_OFFSET_LINES + RANGED_ENTRY_OFFSET)]]

  const blocks = await runStableHintTurns(hooks, STABLE_HINT_RUNS_TO_ENTER, rangedTurn)

  assert.deepEqual(hintBlocksIn(blocks), [hintLineFor([RANGE_PATH])])
})

test("chat system transform with cacheAwareHints updates the stored hint seat in place on a genuine membership change", async () => {
  const hooks = await loadCacheAwareHintHooks()
  const singleMemberTurn = [[pathToolPart(STABLE_HINT_ALPHA_PATH, MIN_EVICTABLE_BYTES)]]
  const twoMemberTurn = [
    [pathToolPart(STABLE_HINT_ALPHA_PATH, MIN_EVICTABLE_BYTES)],
    [pathToolPart(STABLE_HINT_ZEBRA_PATH, MIN_EVICTABLE_BYTES)],
  ]

  const enteredBlocks = await runStableHintTurns(hooks, STABLE_HINT_RUNS_TO_ENTER, singleMemberTurn)
  const enteredLine = hintBlocksIn(enteredBlocks)
  const enteredSeat = enteredBlocks.indexOf(enteredLine[0])
  assert.deepEqual(enteredLine, [hintLineFor([STABLE_HINT_ALPHA_PATH])])

  const grownBlocks = await runStableHintTurns(hooks, STABLE_HINT_RUNS_TO_ENTER, twoMemberTurn)
  const grownLine = hintBlocksIn(grownBlocks)

  assert.deepEqual(grownLine, [hintLineFor([STABLE_HINT_ALPHA_PATH, STABLE_HINT_ZEBRA_PATH])])
  assert.equal(grownBlocks.length, SYSTEM_BLOCK_COUNT_WITH_HINT)
  assert.equal(grownBlocks.indexOf(grownLine[0]), enteredSeat)
})

test("chat system transform with cacheAwareHints keeps stable hint membership isolated between sessions", async () => {
  const hooks = await loadCacheAwareHintHooks()
  const sessionATurn = [[pathToolPart(STABLE_HINT_ALPHA_PATH, MIN_EVICTABLE_BYTES)]]
  const sessionBTurn = [[pathToolPart(STABLE_HINT_ISOLATION_PATH_B, MIN_EVICTABLE_BYTES)]]

  const blocksA = await runStableHintTurns(hooks, STABLE_HINT_RUNS_TO_ENTER, sessionATurn, SESSION_ID)
  assert.deepEqual(hintBlocksIn(blocksA), [hintLineFor([STABLE_HINT_ALPHA_PATH])])

  const blocksB = await runStableHintTurn(hooks, sessionBTurn, SESSION_ID_B)

  assert.deepEqual(hintBlocksIn(blocksB), [])
})

test("the tool registry carries exactly the recall and describe definitions with no legacy names", async () => {
  const hooks = await loadPluginHooks()
  const tools = Object.keys((hooks as Record<string, Record<string, unknown>>)[TOOL_MAP_KEY]).sort()
  assert.deepEqual(tools, ["describe", "recall"])
})

test("recall executes a hit and a miss end to end and describe reports the resulting reads", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  await runTransform(hooks, buildStandardBundle(SESSION_ID, STATS_HIT_SUBJECT))

  assert.equal(await recallTool(hooks, STATS_HIT_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(
    await recallTool(hooks, STATS_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      STATS_MISS_SUBJECT,
      pageStoreOccupancyLineFor([{ tool: READ_TOOL, subject: STATS_HIT_SUBJECT, msgIndex: 0 }]),
    ),
  )
  const after = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(after).recallHits, 1)
  assert.equal(countersOf(after).recallMisses, 1)
})

test("recall returns the full original output named by the tombstone after eviction", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const original = outputOfBytes(THREE_ENTRY_OUTPUT_BYTES)
  const bundle = buildBundle([[pathToolPart("/data/stashed.txt", THREE_ENTRY_OUTPUT_BYTES)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  assert.equal(
    toolPartAt(bundle.messages[0], 0).state.output,
    `${TOMBSTONE_MARKER} read /data/stashed.txt (3000 bytes, ~5 messages ago)${TOMBSTONE_SUFFIX}${digestSentenceFor(READ_TOOL, "/data/stashed.txt", outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))}${reloadPointerFor("/data/stashed.txt")}`,
  )
  assert.equal(await recallTool(hooks, "/data/stashed.txt", SESSION_ID), original)
})

test("recall returns the newest match in full and one-line pointers to older matches", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([[pathToolPart("/data/dup.txt", THREE_ENTRY_OUTPUT_BYTES)], ...fillerMessages()])
  await runTransform(hooks, bundle)
  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart("/data/dup.txt", COLD_OUTPUT_BYTES)]))
  fillerMessages().forEach((parts) => bundle.messages.push(syntheticMessageFor(SESSION_ID, parts)))
  await runTransform(hooks, bundle)

  assert.equal(
    await recallTool(hooks, "/data/dup.txt", SESSION_ID),
    `${outputOfBytes(COLD_OUTPUT_BYTES)}\n${olderMatchesLineFor("/data/dup.txt", [pointerFor(READ_TOOL, 0)])}`,
  )
})

test("recall lists every older match oldest first when three evictions share one subject", async () => {
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
    await recallTool(hooks, "/data/order.txt", SESSION_ID),
    `${outputOfBytes(COLD_OUTPUT_BYTES)}\n${olderMatchesLineFor("/data/order.txt", [pointerFor(READ_TOOL, 0), pointerFor(READ_TOOL, 5)])}`,
  )
})

test("recall returns an error-style miss naming the subject when nothing was stored for it", async () => {
  const hooks = await loadPluginHooks()

  assert.equal(await recallTool(hooks, "/data/never-evicted.txt", SESSION_ID), stashMissFor("/data/never-evicted.txt", STASH_EMPTY_OCCUPANCY))
})

test("recall appends a populated occupancy line with alphabetical categories and the message range on a miss against a multi-tool session page store", async () => {
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
    await recallTool(hooks, OCCUPANCY_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      OCCUPANCY_MISS_SUBJECT,
      "[ctx-stash] session page store holds 6 entries across 6 subjects: bash 2, glob 1, grep 1, read 2; oldest at message 0, newest at message 5.",
    ),
  )
})

test("recall reports the single message bound on a miss whose stored entries all sit at one message index", async () => {
  const hooks = await loadPluginHooksWith({ stashLimit: OCCUPANCY_SLIM_STASH_LIMIT })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(OCCUPANCY_SLIM_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    await recallTool(hooks, OCCUPANCY_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      OCCUPANCY_MISS_SUBJECT,
      "[ctx-stash] session page store holds 1 entry across 1 subject: read 1; at message 0.",
    ),
  )
})

test("recall states the store holds nothing when the session page store exists but is empty", async () => {
  const hooks = await loadPluginHooksWith({ stashLimit: OCCUPANCY_ZERO_STASH_LIMIT })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(OCCUPANCY_DROPPED_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)
  assert.deepEqual((await readStats(hooks, SESSION_ID)).pageStore, {
    entries: OCCUPANCY_ZERO_STASH_LIMIT,
    capacity: OCCUPANCY_ZERO_STASH_LIMIT,
  })

  assert.equal(
    await recallTool(hooks, OCCUPANCY_MISS_SUBJECT, SESSION_ID),
    stashMissFor(OCCUPANCY_MISS_SUBJECT, "[ctx-stash] session page store holds nothing from this session."),
  )
})

test("recall caps the occupancy category list at five categories with an overflow clause", async () => {
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
    await recallTool(hooks, OCCUPANCY_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      OCCUPANCY_MISS_SUBJECT,
      "[ctx-stash] session page store holds 17 entries across 17 subjects: bash 3, fence 2, glob 3, grep 3, read 3, +1 more; oldest at message 0, newest at message 14.",
    ),
  )
})

test("recall categorizes fence-stored entries under the fence label alongside tool entries", async () => {
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
    await recallTool(hooks, OCCUPANCY_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      OCCUPANCY_MISS_SUBJECT,
      "[ctx-stash] session page store holds 3 entries across 3 subjects: fence 1, read 2; oldest at message 0, newest at message 1.",
    ),
  )
})

test("recall evicts the oldest stored entry when a session page store exceeds the fifty entry bound", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const stashSubjects = Array.from({ length: STASH_OVERFLOW_COUNT }, (_, index) => `/data/stash${index}.txt`)
  const bundle = buildBundle([
    ...stashSubjects.map((subject) => [pathToolPart(subject, MIN_EVICTABLE_BYTES)]),
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(
    await recallTool(hooks, stashSubjects[0], SESSION_ID),
    stashMissFor(
      stashSubjects[0],
      pageStoreOccupancyLineFor(stashSubjects.slice(1).map((subject, index) => ({ tool: READ_TOOL, subject, msgIndex: index + 1 }))),
    ),
  )
  assert.equal(await recallTool(hooks, stashSubjects[1], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await recallTool(hooks, stashSubjects[STASH_LIMIT], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("recall keeps session page stores isolated between sessions", async () => {
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

  assert.equal(await recallTool(hooks, STASH_ISOLATION_SUBJECT, SESSION_ID), outputOfBytes(COLD_OUTPUT_BYTES))
  assert.equal(await recallTool(hooks, STASH_ISOLATION_SUBJECT, SESSION_ID_B), outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(
    await recallTool(hooks, STASH_ISOLATION_SUBJECT, STASH_ISOLATION_SESSION_C),
    stashMissFor(STASH_ISOLATION_SUBJECT, STASH_EMPTY_OCCUPANCY),
  )
})

test("transform stores no page when the estimate sits under the watermark", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForWatermarkTokens(tokensForChars(STANDARD_BUNDLE_CHARS) + HEADROOM_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, "/data/kept.txt")
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await recallTool(hooks, "/data/kept.txt", SESSION_ID), stashMissFor("/data/kept.txt", STASH_EMPTY_OCCUPANCY))
})

test("recall returns an error-style miss when the subject is not a non-empty string", async () => {
  const hooks = await loadPluginHooks()

  assert.equal(await recallTool(hooks, INVALID_SUBJECT_VALUE, SESSION_ID), invalidSubjectMissFor("number"))
  assert.equal(await recallTool(hooks, "", SESSION_ID), invalidSubjectMissFor("string"))
})

test("recall with countsOnly true prices a stored subject with counts alone and leaves counters and eviction ordering untouched", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await runTransform(hooks, buildStandardBundle(SESSION_ID, PROBE_HIT_SUBJECT))

  assert.equal(
    await recallToolArgs(hooks, { [RECALL_ARG_NAME]: PROBE_HIT_SUBJECT, [RECALL_PROBE_ARG_NAME]: true }, SESSION_ID),
    probeCountsLineFor(PROBE_HIT_SUBJECT, 1, 0, MIN_EVICTABLE_BYTES, 0, false),
  )

  const counters = countersOf(await readStats(hooks, SESSION_ID))
  assert.equal(counters.recallHits, 0)
  assert.equal(counters.recallMisses, 0)
  assert.equal(counters.faults, 0)

  const bundle = await runFaultContest(hooks, [PROBE_HIT_SUBJECT, PROBE_SIBLING_SUBJECT], OVER_BY_ONE_TOKENS)
  assertEntryTombstoned(bundle, 0)
  assertEntryKept(bundle, 1)
})

test("recall with countsOnly true returns the standard miss and invalid-subject texts verbatim and counts neither", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(
    hooks,
    SESSION_ID,
    contextForWatermarkTokens(tokensForChars(STANDARD_BUNDLE_CHARS) + HEADROOM_TOKENS),
  )
  await runTransform(hooks, buildStandardBundle(SESSION_ID, PROBE_MISS_SUBJECT))

  assert.equal(
    await recallToolArgs(hooks, { [RECALL_ARG_NAME]: PROBE_MISS_SUBJECT, [RECALL_PROBE_ARG_NAME]: true }, SESSION_ID),
    stashMissFor(PROBE_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY),
  )
  assert.equal(
    await recallToolArgs(hooks, { [RECALL_ARG_NAME]: INVALID_SUBJECT_VALUE, [RECALL_PROBE_ARG_NAME]: true }, SESSION_ID),
    invalidSubjectMissFor("number"),
  )
  assert.equal(
    await recallToolArgs(hooks, { [RECALL_ARG_NAME]: "", [RECALL_PROBE_ARG_NAME]: true }, SESSION_ID),
    invalidSubjectMissFor("string"),
  )

  const counters = countersOf(await readStats(hooks, SESSION_ID))
  assert.equal(counters.recallMisses, 0)
  assert.equal(counters.recallHits, 0)
})

test("recall without countsOnly or with false returns today's byte-identical responses and the registration carries all three argument schemas", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, PROBE_REGRESSION_SUBJECT)
  await runTransform(hooks, bundle)

  assert.equal(await recallTool(hooks, PROBE_REGRESSION_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(
    await recallToolArgs(hooks, { [RECALL_ARG_NAME]: PROBE_REGRESSION_SUBJECT, [RECALL_PROBE_ARG_NAME]: false }, SESSION_ID),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await recallTool(hooks, PROBE_REGRESSION_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      PROBE_REGRESSION_MISS_SUBJECT,
      pageStoreOccupancyLineFor([{ tool: READ_TOOL, subject: PROBE_REGRESSION_SUBJECT, msgIndex: 0 }]),
    ),
  )
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).recallHits, 2)

  const recallDefinition = (
    hooks as Record<string, Record<string, { args: Record<string, { type: string }> }>>
  )[TOOL_MAP_KEY][RECALL_TOOL_NAME]
  assert.deepEqual(Object.keys(recallDefinition.args), [RECALL_ARG_NAME, RECALL_PROBE_ARG_NAME, RECALL_VERBATIM_ARG_NAME])
  assert.equal(recallDefinition.args[RECALL_ARG_NAME].type, "string")
  assert.equal(recallDefinition.args[RECALL_PROBE_ARG_NAME].type, "boolean")
  assert.equal(recallDefinition.args[RECALL_VERBATIM_ARG_NAME].type, "boolean")
})

const directRecallOptions = (): ResolvedOptions =>
  resolveOptions({ metricsLog: false, liveStateLog: false, ingestionHygieneCopy: false, pageStore: false })

const stashWithPageFor = (subject: string, msgIndex = 0): PageStoreBySession => {
  const store: SessionPageStore = new Map([
    [
      pageKeyOf(READ_TOOL, subject, msgIndex, 0),
      { output: outputOfBytes(MIN_EVICTABLE_BYTES), tool: READ_TOOL, subject, msgIndex, partIndex: 0 },
    ],
  ])
  return new Map([[SESSION_ID, store]])
}

const summaryLookupOf = (records: PageSummaryRecord[]): PageSummaryLookup => {
  const byPageKey = new Map(
    records.map((record): [string, PageSummaryRecord] => [
      pageKeyOf(record.tool, record.subject, record.msgIndex, record.partIndex, record.stashSlot),
      record,
    ]),
  )
  return (session, tool, subject, msgIndex, partIndex, stashSlot) =>
    session === undefined ? undefined : byPageKey.get(pageKeyOf(tool, subject, msgIndex, partIndex, stashSlot))
}

type DirectRecallDeps = {
  pageStores?: PageStoreBySession
  metrics?: MetricsStore
  summaryLookup?: PageSummaryLookup
}

const executeRecallDirect = async (deps: DirectRecallDeps, args: Record<string, unknown>): Promise<string> =>
  executeReadEvicted(
    deps.pageStores ?? new Map(),
    deps.metrics ?? new Map(),
    new Map(),
    async () => undefined,
    METRICS_SESSION_BOUND,
    directRecallOptions(),
    args,
    { sessionID: SESSION_ID },
    { newerSchemaObserved: false },
    deps.summaryLookup,
  )

test("an in-session stash hit consults the injected summary map and serves the summary without counting a reload", async () => {
  const metrics: MetricsStore = new Map()
  const pageStores = stashWithPageFor(STASH_SUMMARY_SUBJECT)

  const result = await executeRecallDirect(
    { pageStores, metrics, summaryLookup: summaryLookupOf([summaryRecordOf(STASH_SUMMARY_SUBJECT)]) },
    { [RECALL_ARG_NAME]: STASH_SUMMARY_SUBJECT },
  )

  assert.equal(result, summaryServeTextFor(PAGE_STORE_SUMMARY_TEXT))
  assert.equal(metrics.size, 0)
})

test("verbatim true bypasses the injected summary map and reloads the full in-session page with the hit counted", async () => {
  const metrics: MetricsStore = new Map()
  const pageStores = stashWithPageFor(STASH_SUMMARY_SUBJECT)

  const result = await executeRecallDirect(
    { pageStores, metrics, summaryLookup: summaryLookupOf([summaryRecordOf(STASH_SUMMARY_SUBJECT)]) },
    { [RECALL_ARG_NAME]: STASH_SUMMARY_SUBJECT, [RECALL_VERBATIM_ARG_NAME]: true },
  )

  assert.equal(result, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(metrics.get(SESSION_ID)?.recallHits, 1)
  assert.ok(metrics.get(SESSION_ID)?.faultCounts.has(STASH_SUMMARY_SUBJECT))
})

test("a summary map miss on the stash path serves the full original byte-identically and counts the hit", async () => {
  const metrics: MetricsStore = new Map()
  const pageStores = stashWithPageFor(STASH_SUMMARY_SUBJECT)

  const result = await executeRecallDirect(
    { pageStores, metrics, summaryLookup: summaryLookupOf([]) },
    { [RECALL_ARG_NAME]: STASH_SUMMARY_SUBJECT },
  )

  assert.equal(result, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(metrics.get(SESSION_ID)?.recallHits, 1)
})

test("a mapped summary with mismatched key fields never serves over the stash page", async () => {
  const metrics: MetricsStore = new Map()
  const pageStores = stashWithPageFor(STASH_SUMMARY_SUBJECT)

  const result = await executeRecallDirect(
    { pageStores, metrics, summaryLookup: summaryLookupOf([summaryRecordOf(STASH_SUMMARY_SUBJECT, { msgIndex: 7 })]) },
    { [RECALL_ARG_NAME]: STASH_SUMMARY_SUBJECT },
  )

  assert.equal(result, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(metrics.get(SESSION_ID)?.recallHits, 1)
})

test("an in-session probe reports the mapped summary bytes beside the original figures without counting", async () => {
  const metrics: MetricsStore = new Map()
  const pageStores = stashWithPageFor(STASH_SUMMARY_SUBJECT)

  const result = await executeRecallDirect(
    { pageStores, metrics, summaryLookup: summaryLookupOf([summaryRecordOf(STASH_SUMMARY_SUBJECT)]) },
    { [RECALL_ARG_NAME]: STASH_SUMMARY_SUBJECT, [RECALL_PROBE_ARG_NAME]: true },
  )

  assert.equal(
    result,
    probeCountsLineFor(STASH_SUMMARY_SUBJECT, 1, 0, MIN_EVICTABLE_BYTES, 0, false, PAGE_STORE_SUMMARY_TEXT.length),
  )
  assert.equal(metrics.size, 0)
})

test("recall serves a stored summary alone with the recovery lead and counts no reload while verbatim true recovers the full original", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES)),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(await recallTool(hooks, PAGE_STORE_SUMMARY_SUBJECT, SESSION_ID), summaryServeTextFor(PAGE_STORE_SUMMARY_TEXT))
    const counters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(counters.recallHits, 0)
    assert.equal(counters.faults, 0)

    assert.equal(
      await recallToolArgs(hooks, { [RECALL_ARG_NAME]: PAGE_STORE_SUMMARY_SUBJECT, [RECALL_VERBATIM_ARG_NAME]: true }, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).recallHits, 1)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a page without a summary serves the full original byte-identically beside a summarized sibling", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SUMMARY_SIBLING_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES)),
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES)),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(
      await recallTool(hooks, PAGE_STORE_SUMMARY_SIBLING_SUBJECT, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
    assert.equal(await recallTool(hooks, PAGE_STORE_SUMMARY_SUBJECT, SESSION_ID), summaryServeTextFor(PAGE_STORE_SUMMARY_TEXT))
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).recallHits, 1)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("recall with countsOnly true reports the summary and original figures for a summarized page and leaves counters untouched", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES)),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(
      await recallToolArgs(hooks, { [RECALL_ARG_NAME]: PAGE_STORE_SUMMARY_SUBJECT, [RECALL_PROBE_ARG_NAME]: true }, SESSION_ID),
      probeCountsLineFor(PAGE_STORE_SUMMARY_SUBJECT, 0, 1, MIN_EVICTABLE_BYTES, 0, false, PAGE_STORE_SUMMARY_TEXT.length),
    )

    const counters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(counters.recallHits, 0)
    assert.equal(counters.recallMisses, 0)
    assert.equal(counters.faults, 0)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a summary keyed to the newest page serves alone despite attachments and older pages while verbatim recovers the full shape", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, "older page for the summarized subject"),
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES), {
        msgIndex: 4,
        attachments: [attachmentItemOf(ATTACHMENT_MIME_PNG, ATTACHMENT_PAYLOAD_CHARS_PRIMARY, "call_pagestore")],
      }),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT, { msgIndex: 4 }),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(await recallTool(hooks, PAGE_STORE_SUMMARY_SUBJECT, SESSION_ID), summaryServeTextFor(PAGE_STORE_SUMMARY_TEXT))
    assert.equal(
      await recallToolArgs(hooks, { [RECALL_ARG_NAME]: PAGE_STORE_SUMMARY_SUBJECT, [RECALL_VERBATIM_ARG_NAME]: true }, SESSION_ID),
      [
        outputOfBytes(MIN_EVICTABLE_BYTES),
        PAGE_STORE_RESTORED_LINE,
        pageStoreOlderLineFor(PAGE_STORE_SUMMARY_SUBJECT, 1),
        attachmentManifestLineFor([attachmentSummaryFor(ATTACHMENT_MIME_PNG, ATTACHED_URL_PRIMARY_CHARS)]),
      ].join("\n"),
    )
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a summary keyed to an older page never serves over the newest page", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, "older page for the summarized subject"),
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES), { msgIndex: 4 }),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(
      await recallTool(hooks, PAGE_STORE_SUMMARY_SUBJECT, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}\n${pageStoreOlderLineFor(PAGE_STORE_SUMMARY_SUBJECT, 1)}`,
    )
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a summary scoped to another session's page at the same key never serves over the newer page", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, PAGE_STORE_COLLIDED_OLD_OUTPUT),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT, { summary: PAGE_STORE_SUMMARY_STALE_TEXT }),
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, PAGE_STORE_COLLIDED_NEW_OUTPUT, { session: SESSION_ID_B }),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(
      await recallTool(hooks, PAGE_STORE_SUMMARY_SUBJECT, SESSION_ID_B),
      `${PAGE_STORE_COLLIDED_NEW_OUTPUT}\n${PAGE_STORE_RESTORED_LINE}\n${pageStoreOlderLineFor(PAGE_STORE_SUMMARY_SUBJECT, 1)}`,
    )
    assert.equal(countersOf(await readStats(hooks, SESSION_ID_B)).recallHits, 1)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a page and its own summary serve their summary even when recalled from another session", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES)),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(
      await recallTool(hooks, PAGE_STORE_SUMMARY_SUBJECT, SESSION_ID_B),
      summaryServeTextFor(PAGE_STORE_SUMMARY_TEXT),
    )
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("the recall argument schema exports carry the verbatim boolean beside the probe and compose the registration record", () => {
  assert.equal(RECALL_VERBATIM_ARG_SCHEMA.type, "boolean")
  assert.ok(RECALL_VERBATIM_ARG_SCHEMA.description.length > 0)
  assert.deepEqual(Object.keys(RECALL_TOOL_ARGS), [RECALL_ARG_NAME, RECALL_PROBE_ARG_NAME, RECALL_VERBATIM_ARG_NAME])
  assert.equal(RECALL_TOOL_ARGS[RECALL_VERBATIM_ARG_NAME], RECALL_VERBATIM_ARG_SCHEMA)
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

test("transform never stores a dedup tombstoned output so recall misses it", async () => {
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
  assert.equal(await recallTool(hooks, DEDUP_PATH, SESSION_ID), stashMissFor(DEDUP_PATH, STASH_EMPTY_OCCUPANCY))
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

test("describe counts file attachment dedup tombstones in the deduped counter", async () => {
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

const BATCH_CADENCE_DISABLED = 0
const BATCH_CADENCE_EVERY_RUN = 1
const BATCH_CADENCE_TWO_RUNS = 2
const BATCH_CADENCE_THREE_RUNS = 3
const BATCH_CADENCE_NEVER_REACHED = 50
const BATCH_INVALID_CADENCE_VALUES = [-1, 1.5, "2"]
const BATCH_TRIGGER_FILLER_MESSAGES = 2
const BATCH_CLEAN_RUN_FILLER_MESSAGES = 6
const RANGE_COLLAPSE_RETAINED_EXTRA_BYTES = 512
const BATCH_FIRE_RESET_ERROR_PATH = "/data/errored-batch-reset.txt"

// One bundle carrying all three hygiene triggers at once: a cold reasoning
// part past the retention boundary (message 0), an errored tool input
// outside the recent window (message 4), and a range read fully contained
// in a newer read of the same path (message 1 contained, message 5
// retained). The passes resolve none of them until a fire resolves them.
const buildBatchTriggerBundle = (sessionID: string = SESSION_ID): StrictBundle =>
  buildBundle(
    [
      [reasoningPart(REASONING_COLD_TEXT)],
      [rangeReadPart(RANGE_COLLAPSE_PATH, 100, 50, MIN_EVICTABLE_BYTES)],
      ...fillerMessages(BATCH_TRIGGER_FILLER_MESSAGES),
      [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
      [rangeReadPart(RANGE_COLLAPSE_PATH, 80, 120, MIN_EVICTABLE_BYTES + RANGE_COLLAPSE_RETAINED_EXTRA_BYTES)],
      ...fillerMessages(BATCH_TRIGGER_FILLER_MESSAGES),
      [reasoningPart(REASONING_HOT_TEXT)],
    ],
    sessionID,
  )

const assertBatchTriggerBundleDeferred = (bundle: StrictBundle): void => {
  assert.equal(bundle.messages[0].parts.length, 1, "the cold reasoning part must still be present while the batch is deferred")
  assert.deepEqual(inputAt(bundle.messages[4]), { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, "the errored input must stay unpurged while the batch is deferred")
  assert.equal(
    toolPartAt(bundle.messages[1], 0).state.output,
    outputOfBytes(MIN_EVICTABLE_BYTES),
    "the contained range read must stay intact while the batch is deferred",
  )
}

const assertBatchTriggerBundleFired = (bundle: StrictBundle): void => {
  assert.equal(bundle.messages[0].parts.length, 0, "the fire must expire the cold reasoning part")
  assert.equal(inputAt(bundle.messages[4]), PURGE_MARKER, "the fire must purge the errored input")
  assert.equal(
    (bundle.messages[4].parts[0] as ErrorToolPart).state.output,
    outputOfBytes(UNCOMPLETED_OUTPUT_BYTES),
    "the fire must keep the errored part's output",
  )
  assert.deepEqual(bundle.messages[1].parts[0], {
    type: "text",
    text: rangeTombstoneFor(RANGE_COLLAPSE_PATH, 100, 150, 5, 80, 200),
  }, "the fire must collapse the contained range read naming the retained message")
  assert.equal(
    toolPartAt(bundle.messages[5], 0).state.output,
    outputOfBytes(MIN_EVICTABLE_BYTES + RANGE_COLLAPSE_RETAINED_EXTRA_BYTES),
    "the fire must keep the retained range read intact",
  )
  assert.deepEqual(bundle.messages[8].parts, [reasoningPart(REASONING_HOT_TEXT)], "the fire must keep the hot reasoning part")
}

test("transform with mutationBatchCadence 0 keeps the hygiene passes firing immediately on every request", async () => {
  const hooks = await loadPluginHooksWith({ [OPTION_MUTATION_BATCH_CADENCE]: BATCH_CADENCE_DISABLED })

  const bundle = buildBatchTriggerBundle()
  await runTransform(hooks, bundle)

  assertBatchTriggerBundleFired(bundle)
})

test("transform with mutationBatchCadence keeps the hygiene mutations deferred while the trigger runs sit below the cadence", async () => {
  const hooks = await loadPluginHooksWith({ [OPTION_MUTATION_BATCH_CADENCE]: BATCH_CADENCE_THREE_RUNS })

  const bundle = buildBatchTriggerBundle()
  await runTransform(hooks, bundle)
  assertBatchTriggerBundleDeferred(bundle)

  await runTransform(hooks, bundle)
  assertBatchTriggerBundleDeferred(bundle)
})

test("transform with mutationBatchCadence fires the three hygiene passes as one batched mutation when the cadence is met", async () => {
  const hooks = await loadPluginHooksWith({ [OPTION_MUTATION_BATCH_CADENCE]: BATCH_CADENCE_THREE_RUNS })

  const bundle = buildBatchTriggerBundle()
  await runTransform(hooks, bundle)
  await runTransform(hooks, bundle)
  assertBatchTriggerBundleDeferred(bundle)

  await runTransform(hooks, bundle)
  assertBatchTriggerBundleFired(bundle)
  const counters = countersOf(await readStats(hooks, SESSION_ID))
  assert.equal(counters.collapsedWindows, RANGE_COLLAPSE_WINDOW_COUNT)
  assert.equal(counters.reasoningExpiredUnique, 1)
  assert.equal(counters.evictions, 0)
})

test("transform with mutationBatchCadence does not advance the cadence on a run without hygiene triggers", async () => {
  const hooks = await loadPluginHooksWith({ [OPTION_MUTATION_BATCH_CADENCE]: BATCH_CADENCE_THREE_RUNS })

  const triggerBundle = buildBatchTriggerBundle()
  await runTransform(hooks, triggerBundle)
  assertBatchTriggerBundleDeferred(triggerBundle)

  const cleanBundle = buildBundle([...fillerMessages(BATCH_CLEAN_RUN_FILLER_MESSAGES)])
  await runTransform(hooks, cleanBundle)

  await runTransform(hooks, triggerBundle)
  assertBatchTriggerBundleDeferred(triggerBundle)
})

test("transform with mutationBatchCadence starts a fresh cadence after a batched fire", async () => {
  const hooks = await loadPluginHooksWith({ [OPTION_MUTATION_BATCH_CADENCE]: BATCH_CADENCE_TWO_RUNS })

  const firstCycle = buildBatchTriggerBundle()
  await runTransform(hooks, firstCycle)
  assertBatchTriggerBundleDeferred(firstCycle)
  await runTransform(hooks, firstCycle)
  assertBatchTriggerBundleFired(firstCycle)

  const secondCycle = buildBundle([
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: BATCH_FIRE_RESET_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])
  await runTransform(hooks, secondCycle)
  assert.deepEqual(inputAt(secondCycle.messages[0]), { [PATH_INPUT_KEY]: BATCH_FIRE_RESET_ERROR_PATH })

  await runTransform(hooks, secondCycle)
  assert.equal(inputAt(secondCycle.messages[0]), PURGE_MARKER)
})

test("transform keeps the watermark eviction walk immediate while the hygiene mutations sit below the cadence", async () => {
  const hooks = await loadPluginHooksWith({ [OPTION_MUTATION_BATCH_CADENCE]: BATCH_CADENCE_NEVER_REACHED })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([
    [pathToolPart("/data/valve-coldest.txt", MIN_EVICTABLE_BYTES)],
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER), "the watermark walk must evict on the very run the cadence defers")
  assert.deepEqual(inputAt(bundle.messages[1]), { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, "the errored input must stay unpurged below the cadence")
})

test("transform keeps the aged read tier firing immediately while the hygiene mutations sit below the cadence", async () => {
  const hooks = await loadPluginHooksWith({
    [OPTION_MUTATION_BATCH_CADENCE]: BATCH_CADENCE_NEVER_REACHED,
    agedReadEvictionMessages: AGED_EVICTION_MESSAGES,
  })

  const bundle = buildBundle([
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    [pathToolPart(AGED_READ_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(AGED_FILLER_COUNT),
  ])
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[1], 0).state.output.startsWith(TOMBSTONE_MARKER), "the aged tier must hard-fire on the very run the cadence defers")
  assert.deepEqual(inputAt(bundle.messages[0]), { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, "the errored input must stay unpurged below the cadence")
})

test("transform drops invalid mutationBatchCadence values to the immediate per-request behavior", async () => {
  for (const invalidValue of BATCH_INVALID_CADENCE_VALUES) {
    const hooks = await loadPluginHooksWith({ [OPTION_MUTATION_BATCH_CADENCE]: invalidValue })

    const bundle = buildBatchTriggerBundle()
    await runTransform(hooks, bundle)

    assertBatchTriggerBundleFired(bundle)
  }
})

test("transform with mutationBatchCadence 1 fires the hygiene passes on every trigger-carrying run", async () => {
  const hooks = await loadPluginHooksWith({ [OPTION_MUTATION_BATCH_CADENCE]: BATCH_CADENCE_EVERY_RUN })

  const bundle = buildBatchTriggerBundle()
  await runTransform(hooks, bundle)

  assertBatchTriggerBundleFired(bundle)
})

test("transform with mutationBatchCadence keeps the hygiene cadence independent between sessions", async () => {
  const hooks = await loadPluginHooksWith({ [OPTION_MUTATION_BATCH_CADENCE]: BATCH_CADENCE_TWO_RUNS })

  const sessionA = buildBatchTriggerBundle(SESSION_ID)
  await runTransform(hooks, sessionA)
  assertBatchTriggerBundleDeferred(sessionA)

  const sessionB = buildBatchTriggerBundle(SESSION_ID_B)
  await runTransform(hooks, sessionB)
  assertBatchTriggerBundleDeferred(sessionB)

  await runTransform(hooks, sessionA)
  assertBatchTriggerBundleFired(sessionA)

  await runTransform(hooks, sessionB)
  assertBatchTriggerBundleFired(sessionB)
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

test("transform never stores a protected output so recall misses it after an eviction run under pressure", async () => {
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
    await recallTool(hooks, STASH_PROTECTED_PATTERN, SESSION_ID),
    stashMissFor(
      STASH_PROTECTED_PATTERN,
      pageStoreOccupancyLineFor([{ tool: READ_TOOL, subject: STASH_PROTECTED_VICTIM_PATH, msgIndex: 1 }]),
    ),
  )
  assert.equal(await recallTool(hooks, STASH_PROTECTED_VICTIM_PATH, SESSION_ID), outputOfBytes(PROTECTED_OUTPUT_BYTES))
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

test("recall drops the least recently active session page store when a ninth session stores an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  assert.equal(
    await recallTool(hooks, stashSessionSubject(0), stashSessionId(0)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(STASH_SESSION_BOUND - 1), stashSessionId(STASH_SESSION_BOUND - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )

  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await recallTool(hooks, stashSessionSubject(0), stashSessionId(0)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(1), stashSessionId(1)),
    stashMissFor(stashSessionSubject(1), STASH_EMPTY_OCCUPANCY),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(STASH_SESSION_BOUND - 1), stashSessionId(STASH_SESSION_BOUND - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("recall protects a refreshed hot session page store when a ninth session stores an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  await runTransform(hooks, stashOverflowSessionBundle(0))
  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await recallTool(hooks, stashSessionSubject(0), stashSessionId(0)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(1), stashSessionId(1)),
    stashMissFor(stashSessionSubject(1), STASH_EMPTY_OCCUPANCY),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("recall refreshes a reloading session page store so it survives when a ninth session stores an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  assert.equal(
    await recallTool(hooks, stashSessionSubject(0), stashSessionId(0)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )

  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await recallTool(hooks, stashSessionSubject(0), stashSessionId(0)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(1), stashSessionId(1)),
    stashMissFor(stashSessionSubject(1), STASH_EMPTY_OCCUPANCY),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("recall does not refresh a session page store on a miss probe so the probing session drops when a ninth session stores an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  assert.equal(
    await recallTool(hooks, STASH_MISS_PROBE_SUBJECT, stashSessionId(0)),
    stashMissFor(
      STASH_MISS_PROBE_SUBJECT,
      pageStoreOccupancyLineFor([{ tool: READ_TOOL, subject: stashSessionSubject(0), msgIndex: 0 }]),
    ),
  )

  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await recallTool(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0), STASH_EMPTY_OCCUPANCY),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(1), stashSessionId(1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
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
  assert.equal(await recallTool(hooks, truncated, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
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

test("recall keeps both same message same subject evictions reloadable instead of overwriting the first stored page", async () => {
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
    await recallTool(hooks, COLLISION_SUBJECT_PATH, SESSION_ID),
    `${outputOfBytes(COLD_OUTPUT_BYTES)}\n${olderMatchesLineFor(COLLISION_SUBJECT_PATH, [pointerFor(READ_TOOL, 0)])}`,
  )
})

const DESCRIBE_TOOL_NAME = "describe"
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
const METRICS_SHARED_INSTANCE_LINE_COUNT = 2
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
  recallHits: 0,
  recallMisses: 0,
  pagesDropped: 0,
  deduped: 0,
  dedupedBytesUnique: 0,
  dedupedUnique: 0,
  dedupTokensSaved: 0,
  collapsedWindows: 0,
  collapsedWindowBytes: 0,
  collapsedWindowTokensSaved: 0,
  faults: 0,
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
    (await (hooks as Record<string, Record<string, StatsToolDefinition>>)[TOOL_MAP_KEY][DESCRIBE_TOOL_NAME].execute(
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
  contextLimit: null,
  contextLimitSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
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
  faultsThisRun: 0,
  recallsSinceLastLine: 0,
  totals: {
    ...STATS_ZEROED_COUNTERS,
    evictions: METRICS_ROTATION_PANEL_SEED_EVICTIONS,
    bytesReclaimed: METRICS_ROTATION_PANEL_SEED_BYTES,
  },
})

test("describe reports zeroed counters unknown context limit and empty page store for a session without activity", async () => {
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
    summarizeEvictedOutputs: false,
    summaryTokenBudget: SCHEMA_DEFAULT_SUMMARY_TOKEN_BUDGET,
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
    advisoryBand: true,
    advisoryBandRatio: ADVISORY_BAND_RATIO_DEFAULT,
    charsPerToken: CHARS_PER_TOKEN,
    rememberedEvictedSubjects: 100,
    protectedTools: ["task", "todowrite"],
    protectedPatterns: [],
  })
  assert.equal(stats.contextLimit, null)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  assert.equal(stats.headroomTokens, null)
  assert.deepEqual(stats.pageStore, { entries: 0, capacity: STASH_LIMIT })
  assert.deepEqual(countersOf(stats), STATS_ZEROED_COUNTERS)
  assert.equal(stats.lastRun, null)
  assert.equal(Object.hasOwn(stats, "logWriteError"), false)
})

test("describe reports the explicit defaultContextTokens option as the context limit when no limit was captured", async () => {
  const hooks = await loadPluginHooksWith({ defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })

  const stats = await readStats(hooks, SESSION_ID)

  assert.equal(stats.options.defaultContextTokens, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
  assert.equal(stats.contextLimit, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
  assert.equal(stats.headroomTokens, null)
})

test("describe reports headroomTokens as the context limit minus the newest run's estimate", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  const bundle = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  const estimated = (stats.lastRun as Record<string, unknown>).estimatedTokens
  assert.equal(stats.headroomTokens, WATERMARK_PROBE_CONTEXT_LIMIT - estimated)
})

test("describe reports headroomTokens as null when the context limit is unknown", async () => {
  const hooks = await loadPluginHooks()
  const bundle = buildStandardBundle(SESSION_ID, STATS_SKIP_RUN_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.contextLimit, null)
  assert.ok(stats.lastRun !== null)
  assert.equal(stats.headroomTokens, null)
})

test("describe records an unknown context limit last run with null watermark and deficit after a skip run", async () => {
  const hooks = await loadPluginHooks()

  const bundle = buildStandardBundle(SESSION_ID, STATS_SKIP_RUN_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.contextLimit, null)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: null,
    deficitTokens: null,
  })
})

test("describe counts the eviction reclaimed bytes stored page and last run deficit after one eviction run", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.contextLimit, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
  assert.deepEqual(countersOf(stats), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    processedContextBytes: 493,
    processedContextTokens: tokensForChars(493),
  })
  assert.deepEqual(stats.pageStore, { entries: 1, capacity: STASH_LIMIT })
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: tokensForChars(STANDARD_BUNDLE_CHARS) - OVER_BY_ONE_TOKENS,
    deficitTokens: OVER_BY_ONE_TOKENS,
  })
})

test("describe derives the eviction token-savings estimate from the reclaimed bytes over the default charsPerToken", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  await runTransform(hooks, bundle)

  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    processedContextBytes: 493,
    processedContextTokens: tokensForChars(493),
  })
})

test("describe scales the eviction token-savings estimate by the resolved charsPerToken", async () => {
  const hooks = await loadPluginHooksWith({ charsPerToken: SAVINGS_CUSTOM_CHARS_PER_TOKEN })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, STATS_SINGLE_EVICTION_SUBJECT)
  await runTransform(hooks, bundle)

  const counters = countersOf(await readStats(hooks, SESSION_ID))
  assert.equal(counters.evictions, 1)
  assert.equal(counters.bytesReclaimed, MIN_EVICTABLE_BYTES)
  assert.equal(counters.evictionTokensSaved, Math.ceil(MIN_EVICTABLE_BYTES / SAVINGS_CUSTOM_CHARS_PER_TOKEN))
})

test("describe counts recall hits and misses from recall and leaves invalid subject arguments uncounted", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  assert.equal(await recallTool(hooks, STATS_MISS_SUBJECT, SESSION_ID), stashMissFor(STATS_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY))
  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), STATS_ZEROED_COUNTERS)

  const bundle = buildStandardBundle(SESSION_ID, STATS_HIT_SUBJECT)
  await runTransform(hooks, bundle)

  assert.equal(
    await recallTool(hooks, STATS_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      STATS_MISS_SUBJECT,
      pageStoreOccupancyLineFor([{ tool: READ_TOOL, subject: STATS_HIT_SUBJECT, msgIndex: 0 }]),
    ),
  )
  const afterMiss = await readStats(hooks, SESSION_ID)
  assert.deepEqual(countersOf(afterMiss), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    recallMisses: 1,
    processedContextBytes: 491,
    processedContextTokens: tokensForChars(491),
  })

  assert.equal(await recallTool(hooks, INVALID_SUBJECT_VALUE, SESSION_ID), invalidSubjectMissFor("number"))
  assert.equal(await recallTool(hooks, "", SESSION_ID), invalidSubjectMissFor("string"))
  const afterInvalid = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(afterInvalid).recallMisses, 1)
  assert.equal(countersOf(afterInvalid).recallHits, 0)

  assert.equal(await recallTool(hooks, STATS_HIT_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  const afterHit = await readStats(hooks, SESSION_ID)
  assert.deepEqual(countersOf(afterHit), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
    recallHits: 1,
    recallMisses: 1,
    processedContextBytes: 491,
    processedContextTokens: tokensForChars(491),
  })
})

const OMISSIONS_TOOL_SUBJECT = "/data/omissions-tool.txt"
const OMISSIONS_FENCE_TAG = "omissions"
const OMISSIONS_QUIET_SUBJECT = "/data/omissions-quiet.txt"
// The composite run's advisory figures: the effective watermark is the
// fractional one (captured budget times the watermark ratio), the band
// start the ratio times it, and the estimate the pre-eviction candidates
// figure (the evictor replaces the candidate with its tombstone only
// after the advisory read it), probed once from a live run.
const OMISSIONS_COMPOSITE_WATERMARK_TOKENS = WATERMARK_PROBE_CONTEXT_LIMIT * WATERMARK_RATIO
const OMISSIONS_COMPOSITE_PRE_EVICT_TOKENS = 572

const omissionsCompositeBundle = (): StrictBundle => ({
  messages: [
    {
      info: { sessionID: SESSION_ID, role: USER_ROLE },
      parts: [
        reasoningPart(REASONING_COLD_TEXT),
        textPart(fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, OMISSIONS_FENCE_TAG))),
        pathToolPart(OMISSIONS_TOOL_SUBJECT, MIN_EVICTABLE_BYTES),
      ],
    },
    ...fillerMessages().map((parts) => syntheticMessageFor(SESSION_ID, parts)),
  ],
})

const OMISSIONS_LINE_LEAD = "standing omissions: "
const OMISSIONS_TOOL_OUTPUTS_LABEL = "tool outputs"
const OMISSIONS_REASONING_BLOCKS_LABEL = "reasoning blocks"
const OMISSIONS_FENCED_BLOCKS_LABEL = "fenced blocks"
const OMISSIONS_RELOAD_LEAD = "; reload via "

const omissionsFooterFor = (toolEvictions: number, reasoningParts: number, fenceBlocks: number): string =>
  `${COMPACTION_BLOCK_MARKER} ${OMISSIONS_LINE_LEAD}${toolEvictions} ${OMISSIONS_TOOL_OUTPUTS_LABEL}, ${reasoningParts} ${OMISSIONS_REASONING_BLOCKS_LABEL}, ${fenceBlocks} ${OMISSIONS_FENCED_BLOCKS_LABEL}${OMISSIONS_RELOAD_LEAD}${RECALL_TOOL_NAME}`

test("describe reports the newest run's declared omissions by category with the recall reload pointer", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = omissionsCompositeBundle()
  await runTransform(hooks, bundle)

  assert.equal(bundle.messages[0].parts.length, 2)
  assert.ok((bundle.messages[0].parts[1] as { state?: { output?: string } }).state?.output?.startsWith(TOMBSTONE_MARKER))

  const stats = await readStats(hooks, SESSION_ID)
  assert.deepEqual(stats.omissions, {
    toolEvictions: 1,
    reasoningParts: 1,
    fenceBlocks: 1,
    reloadTool: RECALL_TOOL_NAME,
  })

  const quietHooks = await loadPluginHooks()
  await setContextLimit(
    quietHooks,
    SESSION_ID,
    contextForWatermarkTokens(tokensForChars(STANDARD_BUNDLE_CHARS) + HEADROOM_TOKENS),
  )
  await runTransform(quietHooks, buildStandardBundle(SESSION_ID, OMISSIONS_QUIET_SUBJECT))

  assert.deepEqual((await readStats(quietHooks, SESSION_ID)).omissions, {
    toolEvictions: 0,
    reasoningParts: 0,
    fenceBlocks: 0,
    reloadTool: RECALL_TOOL_NAME,
  })
})

test("describe pins the omissions block and the advisory preview in one evicting run's payload in emission order", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = omissionsCompositeBundle()
  await runTransform(hooks, bundle)
  assert.ok(toolPartAt(bundle.messages[0], 1).state.output.startsWith(TOMBSTONE_MARKER))

  const stats = await readStats(hooks, SESSION_ID)
  assert.deepEqual(stats.omissions, {
    toolEvictions: 1,
    reasoningParts: 1,
    fenceBlocks: 1,
    reloadTool: RECALL_TOOL_NAME,
  })
  assert.deepEqual(stats.advisory, {
    ratio: ADVISORY_BAND_RATIO_DEFAULT,
    bandStartTokens: ADVISORY_BAND_RATIO_DEFAULT * OMISSIONS_COMPOSITE_WATERMARK_TOKENS,
    estimatedTokens: OMISSIONS_COMPOSITE_PRE_EVICT_TOKENS,
    deficitTokens: OMISSIONS_COMPOSITE_PRE_EVICT_TOKENS - OMISSIONS_COMPOSITE_WATERMARK_TOKENS,
    subjects: [OMISSIONS_TOOL_SUBJECT],
  })
  const keys = Object.keys(stats)
  assert.ok(keys.indexOf("omissions") < keys.indexOf("advisory"), "omissions must emit before advisory")
  assert.ok(keys.indexOf("advisory") < keys.indexOf("composition"), "advisory must emit before composition")
})

test("describe carries no omissions block for a session before any transform run", async () => {
  const hooks = await loadPluginHooks()

  const stats = await readStats(hooks, SESSION_ID)

  assert.equal(Object.hasOwn(stats, "omissions"), false)
})

test("describe counts a post eviction touch exactly once for a matching later call and never recounts repeated transforms", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, POST_EVICT_TOUCH_PATH)
  await runTransform(hooks, bundle)
  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))

  bundle.messages.push(syntheticMessageFor(SESSION_ID, [pathToolPart(POST_EVICT_TOUCH_PATH, APPEARANCE_ONLY_OUTPUT_BYTES)]))
  await runTransform(hooks, bundle)
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).faults, 1)

  await runTransform(hooks, bundle)
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).faults, 1)
})

test("describe leaves post eviction touches at zero when a later call matches nothing evicted", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, POST_EVICT_TOUCH_PATH)
  await runTransform(hooks, bundle)

  bundle.messages.push(
    syntheticMessageFor(SESSION_ID, [pathToolPart(POST_EVICT_UNMATCHED_PATH, APPEARANCE_ONLY_OUTPUT_BYTES)]),
  )
  await runTransform(hooks, bundle)

  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).faults, 0)
})

test("describe forgets the oldest evicted subject past the hundred subject cap and stops counting its post eviction touches", async () => {
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

  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).faults, 1)
})

test("transform credits a subject's fault from both a reload and a post eviction appearance and defers it past single source subjects", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildBundle([
    [pathToolPart(FAULT_CREDIT_RELOADED_PATH, MIN_EVICTABLE_BYTES), pathToolPart(FAULT_CREDIT_SIBLING_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)
  assert.equal(await recallTool(hooks, FAULT_CREDIT_RELOADED_PATH, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  await evictAndReload(hooks, FAULT_CREDIT_SINGLE_HIT_PATH)

  bundle.messages.push(
    syntheticMessageFor(SESSION_ID, [
      pathToolPart(FAULT_CREDIT_RELOADED_PATH, APPEARANCE_ONLY_OUTPUT_BYTES),
      pathToolPart(FAULT_CREDIT_SIBLING_PATH, APPEARANCE_ONLY_OUTPUT_BYTES),
    ]),
  )
  await runTransform(hooks, bundle)
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).faults, 2)

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

test("describe counts one post eviction touch when a single bash appearance matches two evicted subjects", async () => {
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

    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).faults, 1)
    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, 2)
    assert.equal(lines[1].faultsThisRun, 1)
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
    await recallTool(hooks, faultMapBoundSubject(FAULT_MAP_REFRESHED_INDEX), SESSION_ID),
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
    await recallTool(hooks, faultMapBoundSubject(FAULT_MAP_REFRESHED_INDEX), SESSION_ID),
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

test("describe counts dedup tombstones without counting evictions and stays incremental across repeated transforms", async () => {
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

test("describe credits the dedup token-savings estimate once per pair and holds it constant across repeated standing runs", async () => {
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
    dedupedBytesUnique: DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES,
    dedupedUnique: DEDUP_SAVINGS_PAIR_COUNT,
    dedupTokensSaved: tokensForChars(DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES),
    processedContextBytes: 6234,
    processedContextTokens: tokensForChars(6234),
  })

  // The host re-materializes the stored messages on every run, so a standing
  // pair re-tombstones every run (the per-request truth stays on the line's
  // dedupedThisRun and the deduped count) and the repeat runs on a fresh
  // identical copy; the lifetime unique totals credit each pair once, in
  // count and in first-crossing bytes alike, mirroring the reasoning
  // unique precedent.
  await runTransform(hooks, buildBundle(dedupSavingsParts()))
  const counters = countersOf(await readStats(hooks, SESSION_ID))
  assert.equal(counters.deduped, DEDUP_SAVINGS_PAIR_COUNT * REPEATED_STANDING_RUNS)
  assert.equal(counters.dedupedUnique, DEDUP_SAVINGS_PAIR_COUNT)
  assert.equal(counters.dedupedBytesUnique, DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES)
  assert.equal(counters.dedupTokensSaved, tokensForChars(DEDUP_SAVINGS_PAIR_COUNT * THREE_ENTRY_OUTPUT_BYTES))
})

// Characterization pin (not red-first: it pins the shipped behavior): one
// run superseding two copies of the same pair walks newest first, so the
// newer superseded copy's key/byte pair is admitted first and credits its
// bytes once; the older copy re-reports the already-admitted key and adds
// nothing, while deduped counts both tombstones.
test("describe credits one pair's first-admitted superseded bytes when a single run supersedes two copies of it", async () => {
  const hooks = await loadPluginHooks()
  const multiCopyParts = (): MessagePart[][] => [
    [pathToolPart(DEDUP_PATH, 4000)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_PATH, 3000)],
    ...fillerMessages(2),
    [pathToolPart(DEDUP_PATH, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
  ]

  await runTransform(hooks, buildBundle(multiCopyParts()))

  const counters = countersOf(await readStats(hooks, SESSION_ID))
  assert.equal(counters.deduped, 2)
  assert.equal(counters.dedupedUnique, 1)
  assert.equal(counters.dedupedBytesUnique, 3000)
  assert.equal(counters.dedupTokensSaved, tokensForChars(3000))
})

test("describe counts drops when a single run evicts fifty one entries past the page bound", async () => {
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
  assert.equal(countersOf(stats).pagesDropped, 1)
  assert.equal(countersOf(stats).bytesReclaimed, STASH_OVERFLOW_COUNT * MIN_EVICTABLE_BYTES)
  assert.deepEqual(stats.pageStore, { entries: STASH_LIMIT, capacity: STASH_LIMIT })
})

test("transform drops nothing from a session page store holding exactly the fifty entry bound", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const subjects = Array.from({ length: STASH_LIMIT }, (_, index) => `/data/bound${index}.txt`)
  const bundle = buildBundle([
    ...subjects.map((subject) => [pathToolPart(subject, MIN_EVICTABLE_BYTES)]),
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).pagesDropped, 0)
  assert.deepEqual(stats.pageStore, { entries: STASH_LIMIT, capacity: STASH_LIMIT })
  assert.equal(await recallTool(hooks, subjects[0], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("recall drops the earliest runs' entries first when later runs push a session page store past the fifty entry bound", async () => {
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
  assert.equal(countersOf(stats).pagesDropped, STASH_CROSS_RUN_DROP_COUNT)
  assert.deepEqual(stats.pageStore, { entries: STASH_LIMIT, capacity: STASH_LIMIT })
  assert.equal(
    await recallTool(hooks, firstRunSubjects[0], SESSION_ID),
    stashMissFor(
      firstRunSubjects[0],
      pageStoreOccupancyLineFor([
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
    await recallTool(hooks, firstRunSubjects[STASH_CROSS_RUN_DROP_COUNT], SESSION_ID),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(await recallTool(hooks, secondRunSubjects[0], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
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
    assert.equal(line.contextLimit, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
    assert.equal(line.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
    assert.equal(line.estimatedTokens, tokensForChars(STANDARD_BUNDLE_CHARS))
    assert.equal(line.watermarkTokens, tokensForChars(STANDARD_BUNDLE_CHARS) - OVER_BY_ONE_TOKENS)
    assert.equal(line.deficitTokens, OVER_BY_ONE_TOKENS)
    assert.deepEqual(line.evictedThisRun, [
      { tool: READ_TOOL, subject: STATS_LOGGED_SUBJECT, bytes: MIN_EVICTABLE_BYTES, attachmentBytes: 0, messagesAgo: 5 },
    ])
    assert.equal(line.dedupedThisRun, 0)
    assert.equal(line.faultsThisRun, 0)
    assert.equal(line.recallsSinceLastLine, 0)
    assert.deepEqual(line.totals, {
      ...STATS_ZEROED_COUNTERS,
      evictions: 1,
      bytesReclaimed: MIN_EVICTABLE_BYTES,
      evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
      processedContextBytes: 485,
      processedContextTokens: tokensForChars(485),
    })

    await runTransform(hooks, bundle)
    assert.equal(metricsLinesIn(metricsLogPathIn(metricsDir)).length, STATS_LOG_FILE_LINES)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log stamps each flushed line with the plugin version constant and a non-empty plugin session id", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithMetricsLog(metricsLogPathIn(metricsDir))
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_LOGGED_SUBJECT)
    await runTransform(hooks, bundle)

    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].pluginVersion, PLUGIN_VERSION)
    assert.equal(typeof lines[0].pluginSession, "string")
    assert.ok((lines[0].pluginSession as string).length > 0)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log shares one plugin session id across host sessions and draws a distinct one per plugin instance", async () => {
  const sharedMetricsDir = makeMetricsDir()
  const secondMetricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithMetricsLog(metricsLogPathIn(sharedMetricsDir))
    await storeMetricsSession(hooks, 0)
    await storeMetricsSession(hooks, 1)

    const secondHooks = await loadPluginHooksWithMetricsLog(metricsLogPathIn(secondMetricsDir))
    await storeMetricsSession(secondHooks, 0)

    const sharedLines = metricsLinesIn(metricsLogPathIn(sharedMetricsDir))
    const secondLines = metricsLinesIn(metricsLogPathIn(secondMetricsDir))
    assert.equal(sharedLines.length, METRICS_SHARED_INSTANCE_LINE_COUNT)
    assert.equal(secondLines.length, STATS_LOG_FILE_LINES)
    assert.equal(sharedLines[0].pluginSession, sharedLines[1].pluginSession)
    assert.notEqual(sharedLines[0].pluginSession, secondLines[0].pluginSession)
  } finally {
    cleanupMetricsDir(sharedMetricsDir)
    cleanupMetricsDir(secondMetricsDir)
  }
})

test("metrics log records an unknown context limit skip state with null watermark on an eventful run without a captured limit", async () => {
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
    assert.equal(lines[0].contextLimit, null)
    assert.equal(lines[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
    assert.equal(lines[0].watermarkTokens, null)
    assert.equal(lines[0].deficitTokens, null)
    assert.deepEqual(lines[0].evictedThisRun, [])
    assert.equal(lines[0].dedupedThisRun, 1)
    assert.deepEqual(lines[0].totals, {
      ...STATS_ZEROED_COUNTERS,
      deduped: 1,
      dedupedBytesUnique: THREE_ENTRY_OUTPUT_BYTES,
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
    assert.equal(lines[0].contextLimit, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
    assert.equal(lines[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
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
    assert.equal(lines[0].contextLimit, SMALL_CONTEXT_LIMIT)
    assert.equal(lines[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log records recalls since the last line on the next transform after a reload", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const hooks = await loadPluginHooksWithMetricsLog(metricsLogPathIn(metricsDir))
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, STATS_RELOADED_SUBJECT)
    await runTransform(hooks, bundle)
    assert.equal(await recallTool(hooks, STATS_RELOADED_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))

    await runTransform(hooks, bundle)
    const lines = metricsLinesIn(metricsLogPathIn(metricsDir))
    assert.equal(lines.length, METRICS_LINES_AFTER_RELOAD)
    assert.deepEqual(lines[1].evictedThisRun, [])
    assert.equal(lines[1].recallsSinceLastLine, 1)
    assert.deepEqual(lines[1].totals, {
      ...STATS_ZEROED_COUNTERS,
      evictions: 1,
      bytesReclaimed: MIN_EVICTABLE_BYTES,
      evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
      recallHits: 1,
      processedContextBytes: 998,
      processedContextTokens: tokensForChars(998),
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

test("metrics log records an unwritable path in logWriteError surfaced through describe without throwing", async () => {
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

test("describe keeps metrics isolated between two sessions", async () => {
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
    processedContextBytes: 493,
    processedContextTokens: tokensForChars(493),
  })
  const statsB = await readStats(hooks, SESSION_ID_B)
  assert.equal(statsB.session, SESSION_ID_B)
  assert.deepEqual(countersOf(statsB), {
    ...STATS_ZEROED_COUNTERS,
    evictions: STATS_ISOLATION_B_EVICTED_COUNT,
    bytesReclaimed: STATS_ISOLATION_B_EVICTED_COUNT * THREE_ENTRY_OUTPUT_BYTES,
    evictionTokensSaved: tokensForChars(STATS_ISOLATION_B_EVICTED_COUNT * THREE_ENTRY_OUTPUT_BYTES),
    processedContextBytes: 3950,
    processedContextTokens: tokensForChars(3950),
  })
})

test("describe drops the least recently active session metrics when a ninth session transforms", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  await storeMetricsSession(hooks, METRICS_SESSION_OVERFLOW_COUNT - 1)

  assert.deepEqual(countersOf(await readStats(hooks, metricsSessionId(0))), STATS_ZEROED_COUNTERS)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(1))).evictions, 1)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_BOUND - 1))).evictions, 1)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_OVERFLOW_COUNT - 1))).evictions, 1)
})

test("recall leaves live session metrics untouched when a never-transformed session probes a store miss at the session bound", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  assert.equal(
    await recallTool(hooks, METRICS_PROBE_MISS_SUBJECT, METRICS_PROBE_SESSION_ID),
    stashMissFor(METRICS_PROBE_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY),
  )

  assert.equal(countersOf(await readStats(hooks, metricsSessionId(0))).evictions, 1)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_BOUND - 1))).evictions, 1)
  assert.deepEqual(countersOf(await readStats(hooks, METRICS_PROBE_SESSION_ID)), STATS_ZEROED_COUNTERS)
})

test("describe refreshes a probing session's metrics so it survives when a ninth session transforms", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  await readStats(hooks, metricsSessionId(0))
  await storeMetricsSession(hooks, METRICS_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(countersOf(await readStats(hooks, metricsSessionId(0))).evictions, 1)
  assert.deepEqual(countersOf(await readStats(hooks, metricsSessionId(1))), STATS_ZEROED_COUNTERS)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_OVERFLOW_COUNT - 1))).evictions, 1)
})

test("describe leaves live session metrics untouched when a never-transformed session opens the stats tool at the session bound", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < METRICS_SESSION_BOUND; index += 1) await storeMetricsSession(hooks, index)

  assert.deepEqual(countersOf(await readStats(hooks, METRICS_PROBE_SESSION_ID)), STATS_ZEROED_COUNTERS)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(0))).evictions, 1)
  assert.equal(countersOf(await readStats(hooks, metricsSessionId(METRICS_SESSION_BOUND - 1))).evictions, 1)
})

test("describe does not refresh a session page store so a stats-only probe leaves it exposed when a ninth session stores an eviction", async () => {
  const hooks = await loadPluginHooks()
  for (let index = 0; index < STASH_SESSION_BOUND; index += 1) await evictStashSession(hooks, index)

  await readStats(hooks, stashSessionId(0))
  await evictStashSession(hooks, STASH_SESSION_OVERFLOW_COUNT - 1)

  assert.equal(
    await recallTool(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0), STASH_EMPTY_OCCUPANCY),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(1), stashSessionId(1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
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
    assert.equal(countersOf(stats).faults, 1)
    assert.equal(metricsLinesIn(blockedPath).length, METRICS_LINES_AFTER_RECOVERY)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("describe reports the metrics rotation cap in options defaulting to twenty MiB and falling back on invalid caps", async () => {
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

test("describe reports metricsMinLineIntervalMs defaulting to sixty seconds and falling back on invalid values", async () => {
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

test("describe echoes advisoryBand and advisoryBandRatio defaulting to enabled and 0.85 with invalid values falling back", async () => {
  const defaultOptions = (await readStats(await loadPluginHooks(), SESSION_ID)).options as Record<string, unknown>
  assert.equal(defaultOptions.advisoryBand, true)
  assert.equal(defaultOptions.advisoryBandRatio, ADVISORY_BAND_RATIO_DEFAULT)

  const customHooks = await loadPluginHooksWith({ advisoryBand: false, advisoryBandRatio: ADVISORY_BAND_RATIO_CUSTOM })
  const customOptions = (await readStats(customHooks, SESSION_ID)).options as Record<string, unknown>
  assert.equal(customOptions.advisoryBand, false)
  assert.equal(customOptions.advisoryBandRatio, ADVISORY_BAND_RATIO_CUSTOM)

  for (const invalidRatio of ADVISORY_BAND_RATIO_INVALID_VALUES) {
    const hooks = await loadPluginHooksWith({ advisoryBandRatio: invalidRatio })
    const options = (await readStats(hooks, SESSION_ID)).options as Record<string, unknown>
    assert.equal(options.advisoryBandRatio, ADVISORY_BAND_RATIO_DEFAULT, `expected the default ratio for ${String(invalidRatio)}`)
    assert.equal(options.advisoryBand, true)
  }

  for (const invalidBand of ADVISORY_BAND_INVALID_VALUES) {
    const hooks = await loadPluginHooksWith({ advisoryBand: invalidBand })
    const options = (await readStats(hooks, SESSION_ID)).options as Record<string, unknown>
    assert.equal(options.advisoryBand, true, `expected the default band switch for ${String(invalidBand)}`)
    assert.equal(options.advisoryBandRatio, ADVISORY_BAND_RATIO_DEFAULT)
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

    assert.equal(await recallTool(hooks, METRICS_ROTATION_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
    await runTransform(hooks, bundle)

    const rotatedLines = metricsLinesIn(rotatedMetricsPathIn(metricsDir))
    assert.equal(rotatedLines.length, STATS_LOG_FILE_LINES)
    assert.equal(rotatedLines[0].session, SESSION_ID)
    assert.deepEqual(rotatedLines[0].evictedThisRun, [
      { tool: READ_TOOL, subject: METRICS_ROTATION_SUBJECT, bytes: MIN_EVICTABLE_BYTES, attachmentBytes: 0, messagesAgo: 5 },
    ])
    const freshLines = metricsLinesIn(metricsPath)
    assert.equal(freshLines.length, STATS_LOG_FILE_LINES)
    assert.equal(freshLines[0].recallsSinceLastLine, 1)
    assert.deepEqual(freshLines[0].evictedThisRun, [])
    assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
      ...STATS_ZEROED_COUNTERS,
      evictions: 1,
      bytesReclaimed: MIN_EVICTABLE_BYTES,
      evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES),
      recallHits: 1,
      processedContextBytes: 1014,
      processedContextTokens: tokensForChars(1014),
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
    assert.equal(await recallTool(hooks, METRICS_ROTATION_DISABLED_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
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

test("live state snapshot is written on a quiet run with the exact schema counters page-store occupancy and hot subjects", async () => {
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
      contextLimit: null,
      contextLimitSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
      contextLimitModelKey: null,
      lastRun: { estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS), watermarkTokens: null, deficitTokens: null },
      totals: { ...STATS_ZEROED_COUNTERS, processedContextBytes: STANDARD_BUNDLE_CHARS, processedContextTokens: tokensForChars(STANDARD_BUNDLE_CHARS) },
      retention: {
        pool: 1,
        reasons: { inWindow: 0, protectedTool: 0, patternProtected: 0, faultShielded: 0, retainedRead: 0 },
        faultShieldedShiftMessages: 0,
      },
      pageStore: { entries: 0, capacity: STASH_LIMIT },
      hotSubjects: [LIVE_STATE_QUIET_SUBJECT],
    })

    await runTransform(hooks, bundle)
    assert.deepEqual(snapshotBodyOf(stateDir, SESSION_ID).snapshot, {
      session: SESSION_ID,
      manualMode: false,
      contextLimit: null,
      contextLimitSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
      contextLimitModelKey: null,
      lastRun: { estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS), watermarkTokens: null, deficitTokens: null },
      totals: { ...STATS_ZEROED_COUNTERS, processedContextBytes: 2 * STANDARD_BUNDLE_CHARS, processedContextTokens: tokensForChars(2 * STANDARD_BUNDLE_CHARS) },
      retention: {
        pool: 1,
        reasons: { inWindow: 0, protectedTool: 0, patternProtected: 0, faultShielded: 0, retainedRead: 0 },
        faultShieldedShiftMessages: 0,
      },
      pageStore: { entries: 0, capacity: STASH_LIMIT },
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

test("live state snapshot carries the captured context limit source manual mode and the armed watermark on a manual run", async () => {
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
    assert.equal(snapshot.contextLimit, WATERMARK_PROBE_CONTEXT_LIMIT)
    assert.equal(snapshot.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
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
    assert.deepEqual(snapshot.pageStore, { entries: 0, capacity: STASH_LIMIT })
    assert.deepEqual(snapshot.hotSubjects, [LIVE_STATE_MANUAL_SUBJECT])
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state snapshot carries the newest run's advisory preview when the estimate enters the band and omits it below", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const armedHooks = await loadPluginHooksWithLiveState(stateDir)
    await setContextLimit(armedHooks, SESSION_ID, contextForWatermarkTokens(ADVISORY_PROBE_WATERMARK_TOKENS))
    await runTransform(armedHooks, buildStandardBundle(SESSION_ID, ADVISORY_QUIET_SUBJECT))

    const snapshot = snapshotBodyOf(stateDir, SESSION_ID).snapshot
    assert.deepEqual(snapshot.advisory, advisoryExpectationOf(ADVISORY_QUIET_SUBJECT))

    const belowStateDir = stateDir
    const belowHooks = await loadPluginHooksWithLiveState(belowStateDir, { watermarkTokens: ADVISORY_BELOW_WATERMARK_TOKENS })
    await runTransform(belowHooks, buildStandardBundle(SESSION_ID, ADVISORY_QUIET_SUBJECT))
    assert.equal(Object.hasOwn(snapshotBodyOf(belowStateDir, SESSION_ID).snapshot, "advisory"), false)
  } finally {
    cleanupMetricsDir(stateDir)
  }
})

test("live state snapshot records eviction totals page-store occupancy and an empty hot list after a pressured run", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir)
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    const bundle = buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT)
    await runTransform(hooks, bundle)

    const { snapshot } = snapshotBodyOf(stateDir, SESSION_ID)
    assert.equal(snapshot.manualMode, false)
    assert.equal(snapshot.contextLimit, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
    assert.equal(snapshot.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
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
      processedContextBytes: 495,
      processedContextTokens: tokensForChars(495),
    })
    assert.deepEqual(snapshot.pageStore, { entries: 1, capacity: STASH_LIMIT })
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

test("live state write failure records stateWriteError through describe without interrupting the session", async () => {
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

test("describe reports the live state options defaulting beside the metrics log and round tripping custom values", async () => {
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

test("describe credits each expired reasoning part once and holds the totals constant across repeated standing runs", async () => {
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

test("describe reports only the calling session's reasoning counters", async () => {
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

test("describe counts identical-content reasoning parts once in the unique count and credits their bytes once", async () => {
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

test("describe leaves reasoning counters at zero when a pressured session has no reasoning parts", async () => {
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
    processedContextBytes: 497,
    processedContextTokens: tokensForChars(497),
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
      dedupedBytesUnique: COMPOSITION_TOOL_COLD_BYTES,
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

test("composition fields stay off quiet runs and off describe before any run", async () => {
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
    processedContextBytes: 515,
    processedContextTokens: tokensForChars(515),
  })
  assert.equal(await recallTool(hooks, NON_ARRAY_ATTACHMENTS_PATH, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("recall returns the original output plus a manifest naming the dropped attachment payload after an attachment bearing eviction", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([[attachedReadPart(ATTACHMENT_CALL_ID_PRIMARY, ATTACHMENT_PAYLOAD_CHARS_PRIMARY)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  assert.equal(
    await recallTool(hooks, ATTACHED_PATH, SESSION_ID),
    `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${attachmentManifestLineFor([attachmentSummaryFor(ATTACHMENT_MIME_PNG, ATTACHED_URL_PRIMARY_CHARS)])}`,
  )
})

test("recall lists every attachment in the manifest when an eviction drops multiple attachments", async () => {
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
    await recallTool(hooks, ATTACHED_PATH, SESSION_ID),
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

test("describe counts a superseded duplicate's attachment payload chars in the dedup token-savings estimate", async () => {
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
    dedupedBytesUnique: MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS,
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

test("describe counts attachment payload characters in bytesReclaimed for an attachment bearing eviction", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildBundle([[attachedReadPart(ATTACHMENT_CALL_ID_COUNTED, ATTACHMENT_PAYLOAD_CHARS_PRIMARY)], ...fillerMessages()])
  await runTransform(hooks, bundle)

  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), {
    ...STATS_ZEROED_COUNTERS,
    evictions: 1,
    bytesReclaimed: MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS,
    evictionTokensSaved: tokensForChars(MIN_EVICTABLE_BYTES + ATTACHED_URL_PRIMARY_CHARS),
    processedContextBytes: 510,
    processedContextTokens: tokensForChars(510),
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
      processedContextBytes: 510,
      processedContextTokens: tokensForChars(510),
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
    await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID),
    stashMissFor(
      fenceFirstLineOf(FENCE_LINE_TAG),
      pageStoreOccupancyLineFor([{ tool: FENCE_STASH_TOOL_LABEL, subject: fenceFirstLineOf(FENCE_LINE_TAG_B), msgIndex: 0 }]),
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
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG), STASH_EMPTY_OCCUPANCY))
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

test("recall returns the exact stored fence block text after a fence eviction", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`))

  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)
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
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG_A), SESSION_ID), `${blockA}\n`)
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG_B), SESSION_ID), `${blockB}\n`)
})

test("transform never evicts an unterminated fence however large it grows", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const text = `${FENCE_PROSE_BEFORE}\n${FENCE_TICKS}${FENCE_LANGUAGE_TS}\n${fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG).join("\n")}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG), STASH_EMPTY_OCCUPANCY))
})

test("transform keeps an all blank fenced block untouched no matter how many blank lines it holds", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, Array.from({ length: FENCE_OVER_LINES }, () => ""))
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await recallTool(hooks, UNKNOWN_TARGET_LABEL, SESSION_ID), stashMissFor(UNKNOWN_TARGET_LABEL, STASH_EMPTY_OCCUPANCY))
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
  assert.equal(await recallTool(hooks, truncated, SESSION_ID), `${block}\n`)
})

test("recall evicts the oldest stored entry when fence evictions push a session page store past the fifty entry bound", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const fenceCount = STASH_OVERFLOW_COUNT
  const blocks = Array.from({ length: fenceCount }, (_, index) =>
    fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, `block${index}`)),
  )
  const text = `${FENCE_PROSE_BEFORE}\n${blocks.join(`\n${FENCE_PROSE_MIDDLE}\n`)}\n${FENCE_PROSE_AFTER}`
  await runTransform(hooks, userFenceBundle(text))

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).fenceEvicted, fenceCount)
  assert.equal(countersOf(stats).pagesDropped, 1)
  assert.deepEqual(stats.pageStore, { entries: STASH_LIMIT, capacity: STASH_LIMIT })
  assert.equal(
    await recallTool(hooks, fenceFirstLineOf("block0"), SESSION_ID),
    stashMissFor(
      fenceFirstLineOf("block0"),
      pageStoreOccupancyLineFor(
        Array.from({ length: STASH_LIMIT }, (_, index) => ({
          tool: FENCE_STASH_TOOL_LABEL,
          subject: fenceFirstLineOf(`block${index + 1}`),
          msgIndex: 0,
        })),
      ),
    ),
  )
  assert.equal(await recallTool(hooks, fenceFirstLineOf("block1"), SESSION_ID), `${blocks[1]}\n`)
})

test("transform lowers the estimate with fence bytes before the context-limit decision and lands the block in the shared bounded session page store", async () => {
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
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(countersOf(stats).fenceEvicted, 1)
  assert.equal(countersOf(stats).evictions, 0)
  assert.deepEqual(stats.pageStore, { entries: 1, capacity: STASH_LIMIT })
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
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)
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

test("recall keeps two same subject fence evictions in one part reloadable instead of overwriting the first stored page", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const blockA = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const blockB = fenceBlockText(FENCE_LANGUAGE_JS, fenceContentLines(FENCE_OVER_LINES + 1, FENCE_LINE_TAG))
  await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${blockA}\n${FENCE_PROSE_MIDDLE}\n${blockB}\n${FENCE_PROSE_AFTER}`))

  assert.equal(
    await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID),
    `${blockB}\n\n${olderMatchesLineFor(fenceFirstLineOf(FENCE_LINE_TAG), [pointerFor(FENCE_STASH_TOOL_LABEL, 0)])}`,
  )
})

test("describe counts fence evictions in a distinct fenceEvicted counter without counting tool evictions", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`))

  const stats = await readStats(hooks, SESSION_ID)
  assert.deepEqual(countersOf(stats), {
    ...STATS_ZEROED_COUNTERS,
    fenceEvicted: 1,
    bytesReclaimed: block.length + FENCE_TRAILING_NEWLINE_CHARS,
    evictionTokensSaved: tokensForChars(block.length + FENCE_TRAILING_NEWLINE_CHARS),
    processedContextBytes: 286,
    processedContextTokens: tokensForChars(286),
  })
  assert.deepEqual(stats.options.userFenceEviction, { enabled: true, minBlockLines: FENCE_DEFAULT_MIN_BLOCK_LINES })
  assert.deepEqual(stats.pageStore, { entries: 1, capacity: STASH_LIMIT })
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
      processedContextBytes: 286,
      processedContextTokens: tokensForChars(286),
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

const purgeMetricsBundle = (): StrictBundle =>
  buildBundle([
    [errorToolPart(READ_TOOL, { [PATH_INPUT_KEY]: PURGE_ERROR_PATH }, outputOfBytes(UNCOMPLETED_OUTPUT_BYTES))],
    ...fillerMessages(RECENT_WINDOW_MESSAGES + 1),
  ])

test("metrics line carries purgedThisRun on a purge run and stays quiet on the already-purged rerun", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithMetricsLog(metricsPath)

    const bundle = purgeMetricsBundle()
    await runTransform(hooks, bundle)
    assert.equal(inputAt(bundle.messages[0]), PURGE_MARKER)

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].purgedThisRun, 1)

    await runTransform(hooks, bundle)
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log flushes immediately on a purge inside the coalesce interval", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithCoalesce(metricsPath)
    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    await runTransform(hooks, purgeMetricsBundle())

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].purgedThisRun, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("batched cadence keeps purgedThisRun on the fire run and writes nothing while the purge is deferred", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWith({ metricsLog: true, metricsPath, mutationBatchCadence: 2 })

    const bundle = purgeMetricsBundle()
    await runTransform(hooks, bundle)
    assert.deepEqual(inputAt(bundle.messages[0]), { [PATH_INPUT_KEY]: PURGE_ERROR_PATH })
    assert.equal(existsSync(metricsPath), false)

    await runTransform(hooks, bundle)
    assert.equal(inputAt(bundle.messages[0]), PURGE_MARKER)

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal(lines[0].purgedThisRun, 1)
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

test("metrics log keeps recall accounting correct across a suppressed then flushed sequence", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithCoalesce(metricsPath)
    await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

    await runTransform(hooks, buildStandardBundle(SESSION_ID, METRICS_COALESCE_RELOAD_SUBJECT))
    assert.equal(await recallTool(hooks, METRICS_COALESCE_RELOAD_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
    await runTransform(hooks, reasoningOnlyBundle())
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].recallsSinceLastLine, 1)

    assert.equal(await recallTool(hooks, METRICS_COALESCE_RELOAD_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
    await runTransform(hooks, buildBundle([[textPart(textOfChars(FILLER_TEXT_CHARS))], ...fillerMessages(2)]))

    const flushedLines = metricsLinesIn(metricsPath)
    assert.equal(flushedLines.length, METRICS_COALESCE_LINES_AFTER_SPAN)
    assert.equal(flushedLines[METRICS_COALESCE_LINES_AFTER_SPAN - 1].recallsSinceLastLine, 1)
    assert.deepEqual(flushedLines[METRICS_COALESCE_LINES_AFTER_SPAN - 1].evictedThisRun, [])
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).recallHits, METRICS_COALESCE_STASH_HIT_COUNT)
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).recallMisses, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("metrics log flushes a coalesced session when the context-limit source changes mid sitting", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hooks = await loadPluginHooksWithCoalesce(metricsPath)
    await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, LARGE_DEFAULT_CONTEXT_TOKENS)

    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)
    assert.equal(metricsLinesIn(metricsPath)[0].contextLimit, LARGE_DEFAULT_CONTEXT_TOKENS)
    assert.equal(metricsLinesIn(metricsPath)[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)

    await runTransform(hooks, reasoningOnlyBundle())
    assert.equal(metricsLinesIn(metricsPath).length, STATS_LOG_FILE_LINES)

    // A chat.params event from another model without a limit invalidates
    // the stored capture, so the budget source changes model to unknown.
    await setChatParamsForModel(hooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID, undefined)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesIn(metricsPath)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].contextLimit, null)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
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
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG), STASH_EMPTY_OCCUPANCY))
})

test("transform never closes a fence span on a four space indented fence line", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const contentLines = fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG)
  contentLines.push(`${FENCE_INDENT_FOUR_SPACES}${FENCE_TICKS}`)
  const text = `${FENCE_PROSE_BEFORE}\n${FENCE_TICKS}${FENCE_LANGUAGE_TS}\n${contentLines.join("\n")}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(textAt(bundle, 0), text)
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG), STASH_EMPTY_OCCUPANCY))
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
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)
})

test("transform evicts a fence indented up to three spaces and stores its exact indented text", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  const block = `${FENCE_INDENT_THREE_SPACES}${FENCE_TICKS}${FENCE_LANGUAGE_TS}\n${fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG).join("\n")}\n${FENCE_INDENT_TWO_SPACES}${FENCE_TICKS}`
  const text = `${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`
  const bundle = userFenceBundle(text)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG))}\n${FENCE_PROSE_AFTER}`,
  )
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)
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
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), stashMissFor(fenceFirstLineOf(FENCE_LINE_TAG), STASH_EMPTY_OCCUPANCY))
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

test("transform keeps a per model override limit from driving eviction while manualMode is enabled", async () => {
  const hooks = await loadPluginHooksWith({
    manualMode: true,
    modelContextTokens: { [OVERRIDE_MODEL_KEY]: SMALL_CONTEXT_LIMIT },
  })
  await setChatParamsForModel(hooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, undefined)

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_OVERRIDE_BUDGET_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(stats.contextLimit, SMALL_CONTEXT_LIMIT)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
})

test("transform under manualMode with an unknown context limit is byte-identical to the unknown-limit stand-down", async () => {
  const manualHooks = await loadPluginHooksWith({ manualMode: true })
  const standDownHooks = await loadPluginHooks()

  const manualBundle = buildFallbackBudgetBundle(LEGACY_FALLBACK_BUNDLE_OVER_WATERMARK_CHARS)
  const standDownBundle = buildFallbackBudgetBundle(LEGACY_FALLBACK_BUNDLE_OVER_WATERMARK_CHARS)
  await runTransform(manualHooks, manualBundle)
  await runTransform(standDownHooks, standDownBundle)

  assert.deepEqual(manualBundle, standDownBundle)
})

test("transform under manualMode with a captured limit is byte-identical to the unknown-limit stand-down", async () => {
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

test("the compacting hook appends hot subjects and the store note for a session with recorded evictions", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.equal(output.context.length, 3)
  assert.equal(output.context[0], hintLineFor([HINT_RENDERED_SUBJECT]))
  assert.ok(output.context[1].startsWith(COMPACTION_BLOCK_MARKER))
  assert.ok(output.context[1].includes(RECALL_TOOL_NAME))
  assert.ok(output.context[1].includes(HINT_RENDERED_SUBJECT))
  assert.equal(output.context[2], omissionsFooterFor(1, 0, 0))
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

test("a throwing compaction enrichment degrades to an unmodified prompt with lastError set", async () => {
  const hooks = await loadPluginHooksWith({
    errorCompaction: () => { throw new Error(COMPACTION_FAULT_MESSAGE) },
  })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: ["keep me"] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.deepEqual(output.context, ["keep me"])
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal((stats.lastError as Record<string, unknown>).message, COMPACTION_FAULT_MESSAGE)
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

test("the compacting hook keeps only the omissions footer when hintSubjects is 0 even with a populated session page store", async () => {
  const hooks = await loadPluginHooksWith({ hintSubjects: 0 })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.equal(output.context.length, 1)
  assert.equal(output.context[0], omissionsFooterFor(1, 0, 0))
})

test("the compacting hook attaches the store note and the omissions footer when the session remembers no evicted subjects but holds stored outputs", async () => {
  const hooks = await loadPluginHooksWith({ rememberedEvictedSubjects: 0 })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.equal(output.context.length, 2)
  assert.ok(output.context[0].startsWith(COMPACTION_BLOCK_MARKER))
  assert.ok(output.context[0].includes(RECALL_TOOL_NAME))
  assert.equal(output.context[1], omissionsFooterFor(1, 0, 0))
})

test("the store note dedupes repeated subjects and caps at the subject bound, newest first", async () => {
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

test("the compacting hook appends the standing-omissions footer exactly when the newest run omitted anything", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await runTransform(hooks, omissionsCompositeBundle())

  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.equal(output.context.length, 3)
  assert.equal(output.context[2], omissionsFooterFor(1, 1, 1))

  const quietHooks = await loadPluginHooks()
  await setContextLimit(
    quietHooks,
    SESSION_ID,
    contextForWatermarkTokens(tokensForChars(STANDARD_BUNDLE_CHARS) + HEADROOM_TOKENS),
  )
  await runTransform(quietHooks, buildStandardBundle(SESSION_ID, OMISSIONS_QUIET_SUBJECT))

  const quietOutput = { context: [] as string[] }
  await quietHooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, quietOutput)

  assert.equal(quietOutput.context.length, 0)
})

test("a frozen context array degrades through the fault boundary with the native prompt left unmodified", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  const output = { context: Object.freeze([] as string[]) }
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, output)

  assert.equal(output.context.length, 0)
  const stats = await readStats(hooks, SESSION_ID)
  const lastError = stats.lastError as Record<string, unknown>
  assert.equal(typeof lastError.message, "string")
  assert.ok((lastError.message as string).length > 0)
})

test("the compacting hook returns silently when the output carries no context array", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, HINT_RENDERED_SUBJECT))

  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, {})
  await hooks["experimental.session.compacting"]({ sessionID: SESSION_ID }, { context: "not an array" })

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.lastError, undefined)
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

test("a throwing hygiene hook degrades to the original output with lastError set", async () => {
  const hygieneDir = makeMetricsDir()
  const hygienePath = join(hygieneDir, HYGIENE_LOG_BASENAME)
  const hooks = await loadPluginHooksWith({
    errorHygiene: () => {
      throw new Error(HYGIENE_FAULT_MESSAGE)
    },
    ingestionHygienePath: hygienePath,
  })

  const output = await runHygieneHook(hooks, HYGIENE_DIRTY_OUTPUT)

  assert.equal(output.output, HYGIENE_DIRTY_OUTPUT)
  assert.equal(existsSync(hygienePath), false)
  const stats = await readStats(hooks, SESSION_ID)
  assert.equal((stats.lastError as Record<string, unknown>).message, HYGIENE_FAULT_MESSAGE)
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
  const lastError = stats.lastError as Record<string, unknown>
  assert.equal(typeof lastError.message, "string")
  assert.ok((lastError.message as string).length > 0)
  cleanupMetricsDir(hygieneDir)
})

const agedBundle = (): StrictBundle => buildBundle([[pathToolPart(AGED_READ_PATH, MIN_EVICTABLE_BYTES)], ...fillerMessages(AGED_FILLER_COUNT)])

test("an aged read older than the threshold evicts with no context limit captured and credits the counters", async () => {
  const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: AGED_EVICTION_MESSAGES })

  const bundle = agedBundle()
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(await recallTool(hooks, AGED_READ_PATH, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
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
  assert.equal(await recallTool(hooks, AGED_RETOUCHED_PATH, SESSION_ID), stashMissFor(AGED_RETOUCHED_PATH, STASH_EMPTY_OCCUPANCY))
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
  assert.equal(await recallTool(hooks, AGED_READ_PATH, SESSION_ID), stashMissFor(AGED_READ_PATH, STASH_EMPTY_OCCUPANCY))
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

test("the aged read tier evicts unchanged under an eviction batch multiplier above one", async () => {
  const hooks = await loadPluginHooksWith({ agedReadEvictionMessages: AGED_EVICTION_MESSAGES, evictionBatchMultiplier: 2 })

  const bundle = agedBundle()
  await runTransform(hooks, bundle)

  assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, 1)
  const lastRun = (await readStats(hooks, SESSION_ID)).lastRun as Record<string, unknown>
  assert.equal(lastRun.watermarkTokens, null)
  assert.equal(lastRun.deficitTokens, null)
})

test("an aged read matching a protected pattern survives under an eviction batch multiplier above one", async () => {
  const hooks = await loadPluginHooksWith({
    agedReadEvictionMessages: AGED_EVICTION_MESSAGES,
    protectedPatterns: [AGED_PROTECTED_GLOB],
    evictionBatchMultiplier: 2,
  })

  const bundle = buildBundle([[pathToolPart(AGED_PROTECTED_PATH, MIN_EVICTABLE_BYTES)], ...fillerMessages(AGED_FILLER_COUNT)])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, 0)
})

test("a protected tool output survives the watermark tier under an eviction batch multiplier above one", async () => {
  const hooks = await loadPluginHooksWith({ evictionBatchMultiplier: 2 })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(PROTECTED_MULTIPLIER_BUNDLE_CHARS, PARTIAL_DEFICIT_TOKENS))

  const bundle = buildBundle([
    [completedToolPart(TASK_TOOL, {}, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))],
    [pathToolPart("/data/a.txt", THREE_ENTRY_OUTPUT_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.ok(toolPartAt(bundle.messages[1], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(countersOf(await readStats(hooks, SESSION_ID)).evictions, 1)
})

test("the manual-mode dry run previews the multiplied walk without mutating", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true, evictionBatchMultiplier: 2 })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(THREE_ENTRY_BUNDLE_CHARS, PARTIAL_DEFICIT_TOKENS))

  const bundle = buildThreeEntryDeficitBundle()
  await runTransform(hooks, bundle)

  const dryRun = (await readStats(hooks, SESSION_ID)).dryRun as Record<string, unknown>
  assert.equal(dryRun.wouldEvictCount, 2)
  assert.deepEqual(dryRun.wouldEvictSubjects, ["/data/a.txt", "/data/b.txt"])
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(toolPartAt(bundle.messages[1], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
  assert.equal(toolPartAt(bundle.messages[2], 0).state.output, outputOfBytes(THREE_ENTRY_OUTPUT_BYTES))
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

test("a faulting transform run degrades to identity behavior and surfaces lastError", async () => {
  const hooks = await loadPluginHooksWith({ errorTransform: () => FAULT_MESSAGE })
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, FAULT_SUBJECT)
  await runTransform(hooks, bundle)

  // Identity behavior: the output the host delivered comes back unchanged,
  // with no tombstone, dedup marker, or other plugin edit.
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  const stats = await readStats(hooks, SESSION_ID)
  const lastError = stats.lastError as Record<string, unknown>
  assert.ok(lastError !== undefined)
  assert.equal(lastError.message, FAULT_MESSAGE)
  assert.equal(typeof lastError.at, "string")
})

test("a fault on one session does not leak into another session's run", async () => {
  const hooks = await loadPluginHooksWith({
    errorTransform: ((): (() => string | undefined) => {
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
  assert.equal((faultedStats.lastError as Record<string, unknown>).message, FAULT_MESSAGE)
  const healthyStats = await readStats(hooks, SESSION_ID_B)
  assert.equal(Object.hasOwn(healthyStats, "lastError"), false)
})

test("a second fault replaces the session's lastError message", async () => {
  const hooks = await loadPluginHooksWith({ errorTransform: ((): (() => string | undefined) => {
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
  assert.equal((stats.lastError as Record<string, unknown>).message, SECOND_SESSION_FAULT)
})

test("a throwing tool returns the structured error shape instead of throwing", async () => {
  const hooks = await loadPluginHooks()

  // The internals guard ordinary hostile shapes and return their own miss
  // strings, so the boundary is exercised with an args object whose
  // property getter throws mid-read: the boundary must convert the throw
  // into the structured error string.
  const hostileArgs = Object.create(null, { subject: { get: () => { throw new Error(TOOL_FAULT_MESSAGE) } } })
  const result = await (hooks as Record<string, Record<string, { execute: (args: unknown, context: unknown) => Promise<string> }>>)[TOOL_MAP_KEY][RECALL_TOOL_NAME].execute(
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
  assert.equal(stats.contextLimit, null)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
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

// Advisory-band probe figures: the standard bundle's estimate (522 tokens)
// sits between 0.85 x 600 = 510 (band start) and the 600-token watermark,
// while 0.85 x 620 = 527 clears the estimate entirely. The ratio comes
// from the plugin's own exported default so expectation and behavior
// cannot drift.
const ADVISORY_BAND_RATIO_CUSTOM = 0.7
const ADVISORY_BAND_RATIO_INVALID_VALUES: unknown[] = [0, 1, 1.5, -0.5, "0.9", Number.NaN, Number.POSITIVE_INFINITY]
const ADVISORY_BAND_INVALID_VALUES: unknown[] = ["yes", 1, 0, null]
const ADVISORY_PROBE_WATERMARK_TOKENS = 600
const ADVISORY_BELOW_WATERMARK_TOKENS = 620
const ADVISORY_PROBE_ESTIMATED_TOKENS = tokensForChars(STANDARD_BUNDLE_CHARS)
const ADVISORY_PROBE_BAND_START_TOKENS = ADVISORY_BAND_RATIO_DEFAULT * ADVISORY_PROBE_WATERMARK_TOKENS
const ADVISORY_PROBE_DEFICIT_TOKENS = ADVISORY_PROBE_ESTIMATED_TOKENS - ADVISORY_PROBE_WATERMARK_TOKENS
const ADVISORY_QUIET_SUBJECT = "/data/advisory-quiet.txt"
const ADVISORY_OLDEST_SUBJECT = "/data/advisory-oldest.txt"
const ADVISORY_COLD_SUBJECT = "/data/advisory-cold.txt"
const ADVISORY_WARM_SUBJECT = "/data/advisory-warm.txt"
const ADVISORY_NEWEST_SUBJECT = "/data/advisory-newest.txt"

const advisoryExpectationOf = (path: string): Record<string, unknown> => ({
  ratio: ADVISORY_BAND_RATIO_DEFAULT,
  bandStartTokens: ADVISORY_PROBE_BAND_START_TOKENS,
  estimatedTokens: ADVISORY_PROBE_ESTIMATED_TOKENS,
  deficitTokens: ADVISORY_PROBE_DEFICIT_TOKENS,
  subjects: [path],
})

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

test("manual mode with watermarkTokens and no captured context limit still reports the dry run", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true, watermarkTokens: DRY_RUN_WATERMARK_TOKENS })

  const bundle = buildDryRunBundle()
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.contextLimit, null)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
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
  assert.equal(await recallTool(hooks, FAULT_DRY_RUN_RELOADED_PATH, SESSION_ID), `${faultFenceBlock}\n`)

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

test("a run whose estimate enters the advisory band carries the preview in describe and evicts nothing by itself", async () => {
  const hooks = await loadPluginHooksWith({ watermarkTokens: ADVISORY_PROBE_WATERMARK_TOKENS })
  await setContextLimit(hooks, SESSION_ID, contextForWatermarkTokens(ADVISORY_PROBE_WATERMARK_TOKENS))

  const bundle = buildStandardBundle(SESSION_ID, ADVISORY_QUIET_SUBJECT)
  await runTransform(hooks, bundle)
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))

  const stats = await readStats(hooks, SESSION_ID)
  assert.deepEqual(stats.advisory, advisoryExpectationOf(ADVISORY_QUIET_SUBJECT))
})

test("the advisory stays absent when the estimate sits below the band start or no effective watermark exists", async () => {
  const belowBandHooks = await loadPluginHooksWith({ watermarkTokens: ADVISORY_BELOW_WATERMARK_TOKENS })
  await runTransform(belowBandHooks, buildStandardBundle(SESSION_ID, ADVISORY_QUIET_SUBJECT))
  assert.equal(Object.hasOwn(await readStats(belowBandHooks, SESSION_ID), "advisory"), false)

  const noWatermarkHooks = await loadPluginHooks()
  await runTransform(noWatermarkHooks, buildStandardBundle(SESSION_ID, ADVISORY_QUIET_SUBJECT))
  assert.equal(Object.hasOwn(await readStats(noWatermarkHooks, SESSION_ID), "advisory"), false)

  const disarmedHooks = await loadPluginHooksWith({
    advisoryBand: false,
    watermarkTokens: ADVISORY_PROBE_WATERMARK_TOKENS,
  })
  await runTransform(disarmedHooks, buildStandardBundle(SESSION_ID, ADVISORY_QUIET_SUBJECT))
  assert.equal(Object.hasOwn(await readStats(disarmedHooks, SESSION_ID), "advisory"), false)
})

test("manual mode computes the advisory alongside the dry run with the top candidates in eviction order bounded to three", async () => {
  const hooks = await loadPluginHooksWith({
    manualMode: true,
    watermarkTokens: ADVISORY_PROBE_WATERMARK_TOKENS,
  })
  await setContextLimit(hooks, SESSION_ID, contextForWatermarkTokens(ADVISORY_PROBE_WATERMARK_TOKENS))

  const bundle = buildBundle([
    [pathToolPart(ADVISORY_OLDEST_SUBJECT, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(ADVISORY_COLD_SUBJECT, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(ADVISORY_WARM_SUBJECT, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(ADVISORY_NEWEST_SUBJECT, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)
  assert.equal(toolPartAt(bundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(bundle.messages[3], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(bundle.messages[6], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(toolPartAt(bundle.messages[9], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))

  const stats = await readStats(hooks, SESSION_ID)
  assert.ok(stats.dryRun !== undefined)
  const advisoryEstimateTokens = tokensForChars(4 * MIN_EVICTABLE_BYTES + (2 + 2 + 2 + RECENT_WINDOW_FILLER_MESSAGES) * FILLER_TEXT_CHARS)
  assert.deepEqual(stats.advisory, {
    ratio: ADVISORY_BAND_RATIO_DEFAULT,
    bandStartTokens: ADVISORY_PROBE_BAND_START_TOKENS,
    estimatedTokens: advisoryEstimateTokens,
    deficitTokens: advisoryEstimateTokens - ADVISORY_PROBE_WATERMARK_TOKENS,
    subjects: [ADVISORY_OLDEST_SUBJECT, ADVISORY_COLD_SUBJECT, ADVISORY_WARM_SUBJECT],
  })
})

test("describe renders the advisory block after the dry-run block and before the composition block", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true, watermarkTokens: ADVISORY_PROBE_WATERMARK_TOKENS })
  await setContextLimit(hooks, SESSION_ID, contextForWatermarkTokens(ADVISORY_PROBE_WATERMARK_TOKENS))
  await runTransform(hooks, buildStandardBundle(SESSION_ID, ADVISORY_QUIET_SUBJECT))

  const keys = Object.keys(await readStats(hooks, SESSION_ID))
  const dryRunIndex = keys.indexOf("dryRun")
  const advisoryIndex = keys.indexOf("advisory")
  const compositionIndex = keys.indexOf("composition")
  assert.ok(dryRunIndex !== -1)
  assert.ok(advisoryIndex !== -1)
  assert.ok(compositionIndex !== -1)
  assert.ok(dryRunIndex < advisoryIndex && advisoryIndex < compositionIndex, `advisory must render after dryRun and before composition: ${keys.join(",")}`)
})

const RETENTION_PROBE_PLAIN_SUBJECT = "/data/retention-plain.txt"
const RETENTION_PROBE_PATTERN_SUBJECT = "/data/retention-pattern-1.txt"
const RETENTION_PROBE_WINDOW_SUBJECT = "/data/retention-window.txt"
const RETENTION_PROBE_RETAINED_SUBJECT = "/data/retention-retained.txt"
const RETENTION_PROBE_PROTECTED_TOOL = GREP_TOOL
const RETENTION_PROBE_PROTECTED_PATTERN = "/data/retention-pattern-*.txt"
const RETENTION_PROBE_SEARCH_PATTERN = "/data/retention-search-*.txt"
const RETENTION_FAULT_SUBJECT = "/data/retention-faulted.txt"
const RETENTION_FAULT_SHIFT_MESSAGES = 5

test("describe classifies the newest run's retention pool by every matching reason over the unfiltered candidate entries", async () => {
  const hooks = await loadPluginHooksWith({
    protectedTools: [RETENTION_PROBE_PROTECTED_TOOL],
    protectedPatterns: [RETENTION_PROBE_PROTECTED_PATTERN],
  })
  const bundle = buildBundle([
    [pathToolPart(RETENTION_PROBE_PLAIN_SUBJECT, MIN_EVICTABLE_BYTES)],
    [pathToolPart(RETENTION_PROBE_PATTERN_SUBJECT, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(2),
    [completedToolPart(GREP_TOOL, { [PATTERN_INPUT_KEY]: RETENTION_PROBE_SEARCH_PATTERN }, outputOfBytes(MIN_EVICTABLE_BYTES))],
    [pathToolPart(RETENTION_PROBE_WINDOW_SUBJECT, MIN_EVICTABLE_BYTES)],
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual((await readStats(hooks, SESSION_ID)).retention, {
    pool: 4,
    reasons: { inWindow: 2, protectedTool: 1, patternProtected: 1, faultShielded: 0, retainedRead: 0 },
    faultShieldedShiftMessages: 0,
  })
})

test("describe pins the retention window tags to distinct geometry: born in the window versus re-touched back into it", async () => {
  const hooks = await loadPluginHooks()
  const bundle = buildBundle([
    [pathToolPart(RETENTION_PROBE_RETAINED_SUBJECT, MIN_EVICTABLE_BYTES)],
    [pathToolPart(RETENTION_PROBE_RETAINED_SUBJECT, APPEARANCE_ONLY_OUTPUT_BYTES)],
    ...fillerMessages(2),
    [pathToolPart(RETENTION_PROBE_WINDOW_SUBJECT, MIN_EVICTABLE_BYTES)],
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual((await readStats(hooks, SESSION_ID)).retention, {
    pool: 2,
    reasons: { inWindow: 1, protectedTool: 0, patternProtected: 0, faultShielded: 0, retainedRead: 1 },
    faultShieldedShiftMessages: 0,
  })
})

test("a faulted entry carries the fault-shielded tag with its sort-key shift and still lands in evicted under pressure", async () => {
  const hooks = await loadPluginHooks()
  await setContextLimit(hooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))

  const firstBundle = buildStandardBundle(SESSION_ID, RETENTION_FAULT_SUBJECT)
  await runTransform(hooks, firstBundle)
  assert.ok(toolPartAt(firstBundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))

  const secondBundle = buildBundle([
    [textPart(textOfChars(FILLER_TEXT_CHARS))],
    [pathToolPart(RETENTION_FAULT_SUBJECT, MIN_EVICTABLE_BYTES)],
    ...fillerMessages(),
  ])
  await runTransform(hooks, secondBundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.deepEqual(stats.retention, {
    pool: 1,
    reasons: { inWindow: 0, protectedTool: 0, patternProtected: 0, faultShielded: 1, retainedRead: 0 },
    faultShieldedShiftMessages: RETENTION_FAULT_SHIFT_MESSAGES,
  })
  assert.equal((stats.omissions as Record<string, unknown>).toolEvictions, 1)
  assert.ok(toolPartAt(secondBundle.messages[1], 0).state.output.startsWith(TOMBSTONE_MARKER))
})

test("describe renders the retention block after the omissions block and omits it when the newest pool is empty", async () => {
  const hooks = await loadPluginHooksWith({ userFenceEviction: { enabled: true } })
  await runTransform(hooks, omissionsCompositeBundle())

  const keys = Object.keys(await readStats(hooks, SESSION_ID))
  const omissionsIndex = keys.indexOf("omissions")
  const retentionIndex = keys.indexOf("retention")
  const compositionIndex = keys.indexOf("composition")
  assert.ok(omissionsIndex !== -1)
  assert.ok(retentionIndex !== -1)
  assert.ok(compositionIndex !== -1)
  assert.ok(
    omissionsIndex < retentionIndex && retentionIndex < compositionIndex,
    `retention must render after omissions and before composition: ${keys.join(",")}`,
  )

  const emptyPoolHooks = await loadPluginHooks()
  await runTransform(emptyPoolHooks, buildBundle([[textPart(textOfChars(FILLER_TEXT_CHARS))], ...fillerMessages()]))
  assert.equal(Object.hasOwn(await readStats(emptyPoolHooks, SESSION_ID), "retention"), false)
})

test("live state snapshot carries the newest run's retention breakdown and leaves it absent when the pool empties", async () => {
  const stateDir = makeLiveStateDir()
  try {
    const hooks = await loadPluginHooksWithLiveState(stateDir)
    await runTransform(hooks, buildStandardBundle(SESSION_ID, LIVE_STATE_QUIET_SUBJECT))

    const snapshot = snapshotBodyOf(stateDir, SESSION_ID).snapshot
    assert.deepEqual(snapshot.retention, {
      pool: 1,
      reasons: { inWindow: 0, protectedTool: 0, patternProtected: 0, faultShielded: 0, retainedRead: 0 },
      faultShieldedShiftMessages: 0,
    })

    await runTransform(hooks, buildBundle([[textPart(textOfChars(FILLER_TEXT_CHARS))], ...fillerMessages()]))
    assert.equal(Object.hasOwn(snapshotBodyOf(stateDir, SESSION_ID).snapshot, "retention"), false)
  } finally {
    cleanupMetricsDir(stateDir)
  }
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

test("transform keeps fence eviction, the page stores, and recall active while manualMode is enabled", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true, userFenceEviction: { enabled: true } })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
  const bundle = userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`)
  await runTransform(hooks, bundle)

  assert.equal(
    textAt(bundle, 0),
    `${FENCE_PROSE_BEFORE}\n${fenceTombstoneFor(FENCE_LANGUAGE_TS, FENCE_OVER_LINES, fenceFirstLineOf(FENCE_LINE_TAG))}\n${FENCE_PROSE_AFTER}`,
  )
  assert.equal(await recallTool(hooks, fenceFirstLineOf(FENCE_LINE_TAG), SESSION_ID), `${block}\n`)
})

test("describe reports the manual state the captured context limit and the armed watermark last run", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_STATS_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.options.manualMode, true)
  assert.equal(stats.contextLimit, WATERMARK_PROBE_CONTEXT_LIMIT)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
  assert.deepEqual(stats.lastRun, {
    estimatedTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    watermarkTokens: MANUAL_ARMED_WATERMARK_TOKENS,
    deficitTokens: MANUAL_ARMED_DEFICIT_TOKENS,
  })
})

test("describe keeps a null watermark and deficit for a manual session with no context limit and no watermarkTokens", async () => {
  const hooks = await loadPluginHooksWith({ manualMode: true })

  const bundle = buildStandardBundle(SESSION_ID, MANUAL_UNWATERMARKED_SUBJECT)
  await runTransform(hooks, bundle)

  const stats = await readStats(hooks, SESSION_ID)
  assert.equal(stats.contextLimit, null)
  assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
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

test("describe reports the default page-store capacity of fifty entries when stashLimit is unset", async () => {
  const stats = await readStats(await loadPluginHooks(), SESSION_ID)

  assert.deepEqual(stats.pageStore, { entries: 0, capacity: STASH_LIMIT })
})

test("recall applies a custom stashLimit dropping the oldest stored entry past the bound", async () => {
  const hooks = await loadPluginHooksWith({ stashLimit: STASH_LIMIT_OVERRIDE })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)

  const subjects = Array.from({ length: STASH_LIMIT_OVERFLOW_COUNT }, (_, index) => `${STASH_LIMIT_OVERRIDE_SUBJECT_PREFIX}${index}.txt`)
  const bundle = buildBundle([
    ...subjects.map((subject) => [pathToolPart(subject, MIN_EVICTABLE_BYTES)]),
    ...fillerMessages(),
  ])
  await runTransform(hooks, bundle)

  assert.deepEqual((await readStats(hooks, SESSION_ID)).pageStore, {
    entries: STASH_LIMIT_OVERRIDE,
    capacity: STASH_LIMIT_OVERRIDE,
  })
  assert.equal(
    await recallTool(hooks, subjects[0], SESSION_ID),
    stashMissFor(
      subjects[0],
      pageStoreOccupancyLineFor(subjects.slice(1).map((subject, index) => ({ tool: READ_TOOL, subject, msgIndex: index + 1 }))),
    ),
  )
  assert.equal(await recallTool(hooks, subjects[1], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(await recallTool(hooks, subjects[2], SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
})

test("describe keeps the default page-store capacity when stashLimit is invalid", async () => {
  for (const invalidLimit of STASH_LIMIT_INVALID_VALUES) {
    const hooks = await loadPluginHooksWith({ stashLimit: invalidLimit })
    const stats = await readStats(hooks, SESSION_ID)

    assert.deepEqual(stats.pageStore, { entries: 0, capacity: STASH_LIMIT })
  }
})

test("recall drops the least recently active session page store when the stashSessions bound is exceeded", async () => {
  const hooks = await loadPluginHooksWith({ stashSessions: SESSION_BOUND_OVERRIDE })
  for (let index = 0; index < SESSION_BOUND_OVERRIDE; index += 1) await evictStashSession(hooks, index)

  await evictStashSession(hooks, SESSION_BOUND_OVERRIDE)

  assert.equal(
    await recallTool(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0), STASH_EMPTY_OCCUPANCY),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(1), stashSessionId(1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(SESSION_BOUND_OVERRIDE), stashSessionId(SESSION_BOUND_OVERRIDE)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
})

test("recall keeps early session page stores when an invalid stashSessions falls back to the default bound", async () => {
  const hooks = await loadPluginHooksWith({ stashSessions: SESSION_BOUND_INVALID_ZERO })
  for (let index = 0; index < STASH_SESSION_OVERFLOW_COUNT; index += 1) await evictStashSession(hooks, index)

  assert.equal(
    await recallTool(hooks, stashSessionSubject(0), stashSessionId(0)),
    stashMissFor(stashSessionSubject(0), STASH_EMPTY_OCCUPANCY),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(1), stashSessionId(1)),
    outputOfBytes(MIN_EVICTABLE_BYTES),
  )
  assert.equal(
    await recallTool(hooks, stashSessionSubject(STASH_SESSION_OVERFLOW_COUNT - 1), stashSessionId(STASH_SESSION_OVERFLOW_COUNT - 1)),
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

test("describe drops the least recently active session metrics when the metricsSessions bound is exceeded", async () => {
  const hooks = await loadPluginHooksWith({ metricsSessions: SESSION_BOUND_OVERRIDE })
  await setContextLimit(hooks, SESSION_ID, WATERMARK_PROBE_CONTEXT_LIMIT)
  await setContextLimit(hooks, SESSION_ID_B, WATERMARK_PROBE_CONTEXT_LIMIT)

  await runTransform(hooks, buildStandardBundle(SESSION_ID, "/data/metrics-bound-a.txt"))
  await runTransform(hooks, buildStandardBundle(SESSION_ID_B, "/data/metrics-bound-b.txt"))
  await runTransform(hooks, buildStandardBundle(BOUND_TEST_SESSION_C, "/data/metrics-bound-c.txt"))

  assert.equal(countersOf(await readStats(hooks, SESSION_ID_B)).evictions, 1)
  assert.deepEqual(countersOf(await readStats(hooks, SESSION_ID)), STATS_ZEROED_COUNTERS)
})

test("describe keeps session metrics when an invalid metricsSessions falls back to the default bound", async () => {
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

  return countersOf(await readStats(hooks, SESSION_ID)).faults
}

test("describe forgets the oldest evicted subject at the rememberedEvictedSubjects bound so its touch goes uncounted", async () => {
  assert.equal(await rememberedSubjectsTouchCountFor(REMEMBERED_SUBJECTS_OVERRIDE), 1)
})

test("describe keeps both evicted subjects remembered when rememberedEvictedSubjects is invalid", async () => {
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
  contextLimit: null,
  contextLimitSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
  contextLimitModelKey: null,
  estimatedTokens: 0,
  watermarkTokens: null,
  deficitTokens: null,
  evictedThisRun: [],
  dedupedThisRun: 0,
  reasoningExpiredThisRun: 0,
  reasoningBytesExpiredThisRun: 0,
  fenceEvictedThisRun: 0,
  faultsThisRun: 0,
  recallsSinceLastLine: 0,
  totals: { ...STATS_ZEROED_COUNTERS, evictions },
})

const rehydrateSeedSnapshot = (session: string, ts: string, evictions: number): string =>
  `${JSON.stringify({
    ts,
    session,
    manualMode: false,
    contextLimit: null,
    contextLimitSource: CONTEXT_TOKENS_SOURCE_UNKNOWN,
    contextLimitModelKey: null,
    lastRun: { estimatedTokens: 0, watermarkTokens: null, deficitTokens: null },
    totals: { ...STATS_ZEROED_COUNTERS, evictions },
    pageStore: { entries: 0, capacity: STASH_LIMIT },
    hotSubjects: [],
  })}\n`

const withCounterDeltas = (baseline: Record<string, number>, deltas: Record<string, number>): Record<string, number> => {
  const expected = { ...baseline }
  for (const [key, delta] of Object.entries(deltas)) expected[key] = (expected[key] ?? 0) + delta
  expected.evictionTokensSaved = tokensForChars(expected.bytesReclaimed)
  expected.dedupTokensSaved = tokensForChars(expected.dedupedBytesUnique)
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
const REHYDRA_SITTING_PROCESSED_CHARS = 4058

const SECOND_SITTING_COUNTER_DELTAS = {
  evictions: 1,
  bytesReclaimed: MIN_EVICTABLE_BYTES + REHYDRA_FENCE_BYTES,
  recallHits: 1,
  recallMisses: 1,
  deduped: 1,
  dedupedUnique: 1,
  dedupedBytesUnique: THREE_ENTRY_OUTPUT_BYTES,
  reasoningExpiredUnique: 1,
  reasoningBytesExpiredUnique: REHYDRA_REASONING_TEXT.length,
  fenceEvicted: 1,
  processedContextBytes: REHYDRA_SITTING_PROCESSED_CHARS,
}

const runFirstSitting = async (hooks: HookMap): Promise<void> => {
  await runEvictionTransform(hooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)
  assert.equal(await recallTool(hooks, REHYDRA_EVICTION_SUBJECT_A, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.equal(
    await recallTool(hooks, REHYDRA_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      REHYDRA_MISS_SUBJECT,
      pageStoreOccupancyLineFor([{ tool: READ_TOOL, subject: REHYDRA_EVICTION_SUBJECT_A, msgIndex: 0 }]),
    ),
  )
  await runQuietProbeTransform(hooks, SESSION_ID)
  await runDedupTransform(hooks, SESSION_ID)
  await runReasoningTransform(hooks, SESSION_ID)
  await runFenceTransform(hooks)
}

const runSecondSitting = async (hooks: HookMap): Promise<void> => {
  await runEvictionTransform(hooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_B)
  assert.equal(await recallTool(hooks, REHYDRA_EVICTION_SUBJECT_B, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  await runDedupTransform(hooks, SESSION_ID)
  await runReasoningTransform(hooks, SESSION_ID)
  await runFenceTransform(hooks)
  assert.equal(
    await recallTool(hooks, REHYDRA_MISS_SUBJECT, SESSION_ID),
    stashMissFor(
      REHYDRA_MISS_SUBJECT,
      pageStoreOccupancyLineFor([
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
    assert.equal(lines[lines.length - 1].recallsSinceLastLine, 1)
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
    // the restarted instance's recallHits figure proves rehydration happened
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
    assert.equal(countersOf(await readStats(restarted, SESSION_ID)).recallHits, 1)
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

    const expected = withCounterDeltas(baseline, { evictions: 1, bytesReclaimed: MIN_EVICTABLE_BYTES, processedContextBytes: 513 })
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
      processedContextBytes: 513,
      processedContextTokens: tokensForChars(513),
    })
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

// The 2026-10-02 reset: a record written before the key renames carries
// the retired totals spellings (stashHits and siblings, now recallHits
// and siblings) the renamed schema does not admit, and every renamed key
// sits in UPGRADE_REQUIRED_COUNTER_KEYS, so the seeder rejects the
// record wholesale: the session restarts at zero instead of rehydrating
// half-old figures, and the pre-rename budget fields (modelContextTokens
// and siblings) stop rehydrating too.
test("a pre-rename record is rejected by the seeder so the session restarts at zero with an unknown context limit", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    writeFileSync(
      metricsPath,
      `${JSON.stringify({
        ts: "2026-09-17T00:00:00.000Z",
        session: SESSION_ID,
        modelContextTokens: 250000,
        modelContextTokensSource: CONTEXT_TOKENS_SOURCE_OVERRIDE,
        modelContextTokensModelKey: "provider/model",
        estimatedTokens: 60000,
        watermarkTokens: 125000,
        deficitTokens: 0,
        evictedThisRun: [],
        dedupedThisRun: 0,
        reasoningExpiredThisRun: 0,
        reasoningBytesExpiredThisRun: 0,
        fenceEvictedThisRun: 0,
        postEvictionTouchesThisRun: 0,
        stashReadsSinceLastLine: 0,
        totals: {
          evictions: 4,
          bytesReclaimed: 12000,
          stashHits: 7,
          stashMisses: 3,
          stashDropped: 1,
          deduped: 2,
          dedupedBytes: 900,
          dedupedUnique: 2,
          collapsedWindows: 0,
          collapsedWindowBytes: 0,
          reasoningExpiredUnique: 0,
          reasoningBytesExpiredUnique: 0,
          postEvictionTouches: 1,
          fenceEvicted: 0,
          processedContextBytes: 480,
          processedContextTokens: 120,
          evictionTokensSaved: 3000,
          dedupTokensSaved: 225,
          collapsedWindowTokensSaved: 0,
          reasoningTokensSaved: 0,
        },
      })}\n`,
    )

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    // No chat.params capture: with the seed rejected the persisted limit
    // must not refill, so the budget stays unknown and eviction stands
    // down (no metrics line, whatever the bundle carries).
    await runTransform(hooks, buildStandardBundle(SESSION_ID, REHYDRA_EVICTION_SUBJECT_A))

    const stats = await readStats(hooks, SESSION_ID)
    assert.equal(stats.contextLimit, null)
    assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
    assert.deepEqual(countersOf(stats), {
      ...STATS_ZEROED_COUNTERS,
      processedContextBytes: STANDARD_BUNDLE_CHARS,
      processedContextTokens: tokensForChars(STANDARD_BUNDLE_CHARS),
    })
    assert.equal(metricsLinesIn(metricsPath).length, 1)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a quiet post restart run writes no metrics line because seeded recalls are logged through", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runEvictionTransform(firstSittingHooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)
    assert.equal(await recallTool(firstSittingHooks, REHYDRA_EVICTION_SUBJECT_A, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
    assert.equal(
      await recallTool(firstSittingHooks, REHYDRA_MISS_SUBJECT, SESSION_ID),
      stashMissFor(
        REHYDRA_MISS_SUBJECT,
        pageStoreOccupancyLineFor([{ tool: READ_TOOL, subject: REHYDRA_EVICTION_SUBJECT_A, msgIndex: 0 }]),
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

test("resumed session resolves the context limit persisted in its checkpoint and logs it instead of null unknown", async () => {
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
    assert.equal(lines[0].contextLimit, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    assert.equal(lines[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
    assert.equal(lines[0].watermarkTokens, BUDGET_PERSISTENCE_CONTEXT_LIMIT * WATERMARK_RATIO)
    assert.ok((lines[0].deficitTokens as number) < 0)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a live chat.params capture overrides the context limit rehydrated from the checkpoint", async () => {
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
    assert.equal(lines[0].contextLimit, SMALL_CONTEXT_LIMIT)
    assert.equal(lines[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a mid sitting model change without a limit invalidates the rehydrated context limit and stands eviction down", async () => {
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
    assert.equal(metricsLinesForSession(metricsPath, SESSION_ID)[0].contextLimit, BUDGET_PERSISTENCE_CONTEXT_LIMIT)

    await setChatParamsForModel(secondSittingHooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID, undefined)
    assert.equal((await runStandDownProbe(secondSittingHooks)).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
    const stats = await readStats(secondSittingHooks, SESSION_ID)
    assert.equal(stats.contextLimit, null)
    assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)

    await runTransform(secondSittingHooks, reasoningOnlyBundle())
    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].contextLimit, null)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a model change across a restart suppresses the persisted context limit instead of refilling it", async () => {
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
    assert.equal(lines[0].contextLimit, null)
    assert.equal(lines[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)

    assert.equal((await runStandDownProbe(secondSittingHooks)).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
    assert.equal(countersOf(await readStats(secondSittingHooks, SESSION_ID)).evictions, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a same model no limit chat params event keeps the rehydrated context limit resolved", async () => {
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
    assert.equal(lines[0].contextLimit, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    assert.equal(lines[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a model change across a restart suppresses a context limit seeded from the metrics log tail", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWith({ metricsLog: true, metricsPath, liveStateLog: false })
    await setChatParamsForModel(firstSittingHooks, SESSION_ID, OVERRIDE_MODEL_PROVIDER, OVERRIDE_MODEL_ID, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    await runTransform(firstSittingHooks, reasoningOnlyBundle())
    const seedLine = metricsLinesForSession(metricsPath, SESSION_ID)[0]
    assert.equal(seedLine.contextLimit, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    assert.equal(seedLine.contextLimitModelKey, OVERRIDE_MODEL_KEY)

    const secondSittingHooks = await loadPluginHooksWith({ metricsLog: true, metricsPath, liveStateLog: false })
    await setChatParamsForModel(secondSittingHooks, SESSION_ID, OTHER_MODEL_PROVIDER, OTHER_MODEL_ID, undefined)
    await runTransform(secondSittingHooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].contextLimit, null)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)

    assert.equal((await runStandDownProbe(secondSittingHooks)).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
    assert.equal(countersOf(await readStats(secondSittingHooks, SESSION_ID)).evictions, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("a removed model override suppresses the persisted override limit across a restart", async () => {
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
    assert.equal(rehydratedLines[0].contextLimit, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    assert.equal(rehydratedLines[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_OVERRIDE)
    assert.equal(rehydratedLines.length, STATS_LOG_FILE_LINES)

    // The override leaves the config only now: the third sitting rehydrates
    // a budget whose source is an override the options no longer carry.
    const thirdSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(thirdSittingHooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].contextLimit, null)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)

    assert.equal((await runStandDownProbe(thirdSittingHooks)).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
    assert.equal(countersOf(await readStats(thirdSittingHooks, SESSION_ID)).evictions, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a removed defaultContextTokens option suppresses the persisted default limit across a restart", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, { defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir, { defaultContextTokens: EXPLICIT_DEFAULT_CONTEXT_TOKENS })
    await runTransform(secondSittingHooks, reasoningOnlyBundle())
    const rehydratedLines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(rehydratedLines[0].contextLimit, EXPLICIT_DEFAULT_CONTEXT_TOKENS)
    assert.equal(rehydratedLines[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_DEFAULT)
    assert.equal(rehydratedLines.length, STATS_LOG_FILE_LINES)

    // The option leaves the config only now: the third sitting rehydrates
    // a budget whose source is a default the options no longer carry.
    const thirdSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(thirdSittingHooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, METRICS_COALESCE_LINES_AFTER_FLUSH)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].contextLimit, null)
    assert.equal(lines[METRICS_COALESCE_LINES_AFTER_FLUSH - 1].contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)

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
    hostileSnapshot.contextLimit = BUDGET_PERSISTENCE_CONTEXT_LIMIT
    hostileSnapshot.contextLimitSource = CONTEXT_TOKENS_SOURCE_MODEL
    hostileSnapshot.contextLimitModelKey = 47
    writeFileSync(liveStatePathIn(stateDir, SESSION_ID), `${JSON.stringify(hostileSnapshot)}\n`)

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal((lines[0].totals as Record<string, number>).evictions, 0)
    assert.equal(lines[0].contextLimit, null)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("describe resolves the rehydrated context limit once the session entry is hydrated", async () => {
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
    assert.equal(stats.contextLimit, BUDGET_PERSISTENCE_CONTEXT_LIMIT)
    assert.equal(stats.contextLimitSource, CONTEXT_TOKENS_SOURCE_MODEL)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("eviction engages on a resumed session whose context limit rehydrated where a fresh process stood down", async () => {
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

test("a checkpoint predating context-limit persistence seeds counters and leaves the context limit unknown", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const legacySnapshot = JSON.parse(rehydrateSeedSnapshot(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS)) as Record<string, unknown>
    delete legacySnapshot.contextLimit
    delete legacySnapshot.contextLimitSource
    writeFileSync(liveStatePathIn(stateDir, SESSION_ID), `${JSON.stringify(legacySnapshot)}\n`)

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal((lines[0].totals as Record<string, number>).evictions, REHYDRA_NEWER_RECORD_EVICTIONS)
    assert.equal(lines[0].contextLimit, null)
    assert.equal(lines[0].contextLimitSource, CONTEXT_TOKENS_SOURCE_UNKNOWN)
  } finally {
    cleanupMetricsDir(metricsDir)
    cleanupMetricsDir(stateDir)
  }
})

test("a checkpoint whose context-limit fields are invalid rejects the whole record and the session starts zeroed", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const hostileSnapshot = JSON.parse(rehydrateSeedSnapshot(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS)) as Record<string, unknown>
    hostileSnapshot.contextLimit = "most of it"
    writeFileSync(liveStatePathIn(stateDir, SESSION_ID), `${JSON.stringify(hostileSnapshot)}\n`)

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runTransform(hooks, reasoningOnlyBundle())

    const lines = metricsLinesForSession(metricsPath, SESSION_ID)
    assert.equal(lines.length, STATS_LOG_FILE_LINES)
    assert.equal((lines[0].totals as Record<string, number>).evictions, 0)
    assert.equal(lines[0].contextLimit, null)
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

test("describe re-counts the standing reasoning set when the metrics store evicts and re-seeds the session entry within one process", async () => {
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

test("a store miss issued while the session's first hydration is in flight counts against the seeded entry", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const firstSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runEvictionTransform(firstSittingHooks, SESSION_ID, REHYDRA_EVICTION_SUBJECT_A)
    assert.equal(
      await recallTool(firstSittingHooks, REHYDRA_MISS_SUBJECT, SESSION_ID),
      stashMissFor(
        REHYDRA_MISS_SUBJECT,
        pageStoreOccupancyLineFor([{ tool: READ_TOOL, subject: REHYDRA_EVICTION_SUBJECT_A, msgIndex: 0 }]),
      ),
    )
    await runQuietProbeTransform(firstSittingHooks, SESSION_ID)

    const secondSittingHooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await setContextLimit(secondSittingHooks, SESSION_ID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
    const resumeTransform = runTransform(secondSittingHooks, buildStandardBundle(SESSION_ID, REHYDRA_EVICTION_SUBJECT_B))
    assert.equal(
      await recallTool(secondSittingHooks, REHYDRA_MISS_SUBJECT, SESSION_ID),
      stashMissFor(REHYDRA_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY),
    )
    await resumeTransform

    assert.equal(countersOf(await readStats(secondSittingHooks, SESSION_ID)).recallMisses, 2)
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

test("a metrics line predating dedupedBytesUnique is rejected by the seeder and the session restarts at zero", async () => {
  const metricsDir = makeMetricsDir()
  const stateDir = makeLiveStateDir()
  try {
    const metricsPath = metricsLogPathIn(metricsDir)
    const legacyTotals: Record<string, unknown> = { ...STATS_ZEROED_COUNTERS, evictions: REHYDRA_NEWER_RECORD_EVICTIONS }
    delete legacyTotals.dedupedBytesUnique
    writeFileSync(
      metricsPath,
      `${JSON.stringify({ ...rehydrateSeedLine(SESSION_ID, REHYDRA_LATER_TS, REHYDRA_NEWER_RECORD_EVICTIONS), totals: legacyTotals })}\n`,
    )

    const hooks = await loadPluginHooksWithPersistence(metricsPath, stateDir)
    await runQuietProbeTransform(hooks, SESSION_ID)

    const counters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(counters.evictions, 0)
    assert.equal(counters.dedupedBytesUnique, 0)
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

test("describe is callable and the legacy lru_stats name is no longer registered", async () => {
  const hooks = await loadPluginHooks()

  assert.equal((hooks as Record<string, Record<string, unknown>>)[TOOL_MAP_KEY]["lru_stats"], undefined)
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
const PAGE_STORE_SCHEMA_NEWER_SUBJECT = "/data/page-store-schema-newer.txt"
const PAGE_STORE_SCHEMA_LEGACY_SUBJECT = "/data/page-store-schema-legacy.txt"
const PAGE_STORE_SCHEMA_OLDER_SUBJECT = "/data/page-store-schema-older.txt"
const PAGE_STORE_SCHEMA_GARBAGE_SUBJECT = "/data/page-store-schema-garbage.txt"
const PAGE_STORE_SCHEMA_NEWER_OUTPUT = "newer-schema output that must never surface"
const PAGE_STORE_SCHEMA_GARBAGE_OUTPUT = "garbage-schema output that must never surface"
const PAGE_STORE_FUTURE_KIND = "future-kind"
const PAGE_STORE_FUTURE_KIND_SUBJECT = "/data/page-store-future-kind.txt"
const PAGE_STORE_FUTURE_KIND_OUTPUT = "future-kind output that must never surface"
const PAGE_STORE_SUMMARY_SUBJECT = "/data/page-store-summary.txt"
const PAGE_STORE_SUMMARY_SIBLING_SUBJECT = "/data/page-store-summary-sibling.txt"
const PAGE_STORE_SUMMARY_TEXT = "condensed: the build listed three targets and one warning"
const PAGE_STORE_SUMMARY_NEWER_TEXT = "newer summary that must win the per-key merge"
const PAGE_STORE_SUMMARY_OLDER_TEXT = "older summary that must lose the per-key merge"
const PAGE_STORE_SUMMARY_STALE_TEXT = "stale summary describing the older session's content"
const PAGE_STORE_COLLIDED_OLD_OUTPUT = "old content at the collided key"
const PAGE_STORE_COLLIDED_NEW_OUTPUT = "new content at the collided key"
const PAGE_STORE_SUMMARY_MODEL = "zai/glm-5.3"
const PAGE_STORE_SUMMARY_TOKENS = 48
const PAGE_STORE_SUMMARY_STASH_SLOT = 3
const PAGE_STORE_MALFORMED_FIELD_VALUE = 42

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

const summaryLineOf = (subject: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ts: PAGE_STORE_SEED_TS,
  schemaVersion: PAGE_STORE_SCHEMA_VERSION,
  session: SESSION_ID,
  kind: PAGE_STORE_SUMMARY_LINE_KIND,
  tool: READ_TOOL,
  subject,
  msgIndex: 0,
  partIndex: 0,
  summary: PAGE_STORE_SUMMARY_TEXT,
  summaryModel: PAGE_STORE_SUMMARY_MODEL,
  summaryTokens: PAGE_STORE_SUMMARY_TOKENS,
  ...extra,
})

const summaryRecordOf = (subject: string, extra: Partial<PageSummaryRecord> = {}): PageSummaryRecord => ({
  tool: READ_TOOL,
  subject,
  msgIndex: 0,
  partIndex: 0,
  summary: PAGE_STORE_SUMMARY_TEXT,
  summaryModel: PAGE_STORE_SUMMARY_MODEL,
  summaryTokens: PAGE_STORE_SUMMARY_TOKENS,
  ...extra,
})

const directPageStoreOptionsFor = (storePath: string, extra: Record<string, unknown> = {}): ResolvedOptions =>
  resolveOptions({
    metricsLog: false,
    liveStateLog: false,
    ingestionHygieneCopy: false,
    pageStore: true,
    pageStorePath: storePath,
    ...extra,
  })

const writeSummaryLinesDirect = async (
  storePath: string,
  summaries: PageSummaryRecord[],
  extra: Record<string, unknown> = {},
  guard: PageStoreGuard = { newerSchemaObserved: false },
): Promise<MetricsStore> => {
  const metrics: MetricsStore = new Map()
  await recordPageStoreSummaryLines(directPageStoreOptionsFor(storePath, extra), metrics, SESSION_ID, summaries, guard)
  return metrics
}

const mergedPagesFor = async (storePath: string, subject: string): Promise<StoredPageMatch[]> =>
  pageStoreMatchesFor(directPageStoreOptionsFor(storePath), subject, { newerSchemaObserved: false }, new Map(), SESSION_ID)

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
      await recallTool(secondSittingHooks, PAGE_STORE_ROUNDTRIP_SUBJECT, SESSION_ID_B),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
    assert.equal(countersOf(await readStats(secondSittingHooks, SESSION_ID_B)).recallHits, 1)
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
      await recallTool(hooks, PAGE_STORE_OLDER_SUBJECT, SESSION_ID),
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
      await recallTool(hooks, PAGE_STORE_ATTACHED_SUBJECT, SESSION_ID),
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
    assert.ok((await recallTool(secondSittingHooks, PAGE_STORE_FAULT_RELOADED, SESSION_ID)).startsWith(outputOfBytes(MIN_EVICTABLE_BYTES)))

    const bundle = await runFaultContest(secondSittingHooks, [PAGE_STORE_FAULT_RELOADED, PAGE_STORE_FAULT_SIBLING], OVER_BY_ONE_TOKENS)
    assertEntryTombstoned(bundle, 1)
    assertEntryKept(bundle, 0)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a session page store hit keeps precedence over the page store and stays byte-identical", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)

    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)

    assert.equal(await recallTool(hooks, PAGE_STORE_EVICTED_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
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
      await recallTool(hooks, PAGE_STORE_CORRUPT_SUBJECT, SESSION_ID),
      `${PAGE_STORE_CORRUPT_GOOD_OUTPUT}\n${PAGE_STORE_RESTORED_LINE}`,
    )
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a stashed page line carries the store's current schema version", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)

    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)

    const lines = pageLinesIn(storePath)
    assert.equal(lines.length, 1)
    assert.equal(lines[0].schemaVersion, PAGE_STORE_SCHEMA_VERSION)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a legacy page line without a schema version still serves through recall", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)
    seedPageStore(storePath, [pageLineOf(PAGE_STORE_SCHEMA_LEGACY_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES))])

    assert.equal(
      await recallTool(hooks, PAGE_STORE_SCHEMA_LEGACY_SUBJECT, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a newer-schema page line is skipped for matching while the known-version page still serves and describe carries the diagnostic", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SCHEMA_NEWER_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES), { schemaVersion: PAGE_STORE_SCHEMA_VERSION }),
      pageLineOf(PAGE_STORE_SCHEMA_NEWER_SUBJECT, PAGE_STORE_SCHEMA_NEWER_OUTPUT, { schemaVersion: PAGE_STORE_SCHEMA_VERSION + 1 }),
    ])

    assert.equal(
      await recallTool(hooks, PAGE_STORE_SCHEMA_NEWER_SUBJECT, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
    const stats = await readStats(hooks, SESSION_ID)
    assert.equal(typeof stats.pageStoreSchemaError, "string")
    assert.ok((stats.pageStoreSchemaError as string).includes(String(PAGE_STORE_SCHEMA_VERSION + 1)))
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("an eviction after another session observed a newer schema appends and rotates nothing and carries the halt diagnostic", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SCHEMA_NEWER_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES), { schemaVersion: PAGE_STORE_SCHEMA_VERSION + 1 }),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath, {
      pageStoreRotationMaxBytes: statSync(storePath).size,
    })
    await recallTool(hooks, PAGE_STORE_SCHEMA_NEWER_SUBJECT, SESSION_ID)
    const storeBefore = readFileSync(storePath, "utf8")

    const bundle = await runPageStoreEviction(hooks, SESSION_ID_B, PAGE_STORE_EVICTED_SUBJECT)

    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
    assert.equal(readFileSync(storePath, "utf8"), storeBefore)
    assert.equal(existsSync(rotatedPageStorePathIn(pagesDir)), false)
    const stats = await readStats(hooks, SESSION_ID_B)
    assert.equal(typeof stats.pageStoreSchemaError, "string")
    const haltDiagnostic = stats.pageStoreSchemaError as string
    assert.ok(haltDiagnostic.includes(String(PAGE_STORE_SCHEMA_VERSION)))
    assert.ok(!haltDiagnostic.includes(String(PAGE_STORE_SCHEMA_VERSION + 1)))
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("an eviction against a near-cap store holding a newer-schema line renames and appends nothing without any prior recall", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const seedContent = `${JSON.stringify(
      pageLineOf(PAGE_STORE_SCHEMA_NEWER_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES), { schemaVersion: PAGE_STORE_SCHEMA_VERSION + 1 }),
    )}\n`
    writeFileSync(storePath, seedContent)

    const hooks = await loadPluginHooksWithPageStore(storePath, {
      pageStoreRotationMaxBytes: Buffer.byteLength(seedContent),
    })
    const bundle = await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)

    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
    assert.equal(readFileSync(storePath, "utf8"), seedContent)
    assert.equal(existsSync(rotatedPageStorePathIn(pagesDir)), false)
    const stats = await readStats(hooks, SESSION_ID)
    assert.equal(typeof stats.pageStoreSchemaError, "string")
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a garbage schemaVersion skips the line as invalid without a flag while the well-formed page still serves", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const hooks = await loadPluginHooksWithPageStore(storePath)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SCHEMA_GARBAGE_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES)),
      pageLineOf(PAGE_STORE_SCHEMA_GARBAGE_SUBJECT, PAGE_STORE_SCHEMA_GARBAGE_OUTPUT, { schemaVersion: "two" }),
    ])

    assert.equal(
      await recallTool(hooks, PAGE_STORE_SCHEMA_GARBAGE_SUBJECT, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
    const stats = await readStats(hooks, SESSION_ID)
    assert.equal(stats.pageStoreSchemaError, undefined)
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
      await recallTool(hooks, PAGE_STORE_ABSENT_MISS_SUBJECT, SESSION_ID),
      stashMissFor(PAGE_STORE_ABSENT_MISS_SUBJECT, STASH_EMPTY_OCCUPANCY),
    )

    writeFileSync(storePath, "")
    assert.equal(
      await recallTool(hooks, PAGE_STORE_ABSENT_MISS_SUBJECT, SESSION_ID),
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

    const result = await recallTool(hooks, PAGE_STORE_ABSENT_MISS_SUBJECT, SESSION_ID)

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
      await recallTool(hooks, PAGE_STORE_ABSENT_MISS_SUBJECT, SESSION_ID),
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

test("an older-stamped page line still serves through recall and leaves the store writable without a schema diagnostic", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SCHEMA_OLDER_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES), { schemaVersion: PAGE_STORE_SCHEMA_VERSION - 1 }),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(
      await recallTool(hooks, PAGE_STORE_SCHEMA_OLDER_SUBJECT, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
    assert.equal((await readStats(hooks, SESSION_ID)).pageStoreSchemaError, undefined)

    const bundle = await runPageStoreEviction(hooks, SESSION_ID_B, PAGE_STORE_EVICTED_SUBJECT)
    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
    assert.equal(pageLinesIn(storePath).length, 2)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("an older-stamped line of an unknown kind is skipped unreadable without flagging the store while the older page serves", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SCHEMA_OLDER_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES), { schemaVersion: PAGE_STORE_SCHEMA_VERSION - 1 }),
      {
        ts: PAGE_STORE_SEED_TS,
        schemaVersion: PAGE_STORE_SCHEMA_VERSION - 1,
        session: SESSION_ID,
        kind: PAGE_STORE_FUTURE_KIND,
        tool: READ_TOOL,
        subject: PAGE_STORE_FUTURE_KIND_SUBJECT,
        msgIndex: 0,
        partIndex: 0,
        output: PAGE_STORE_FUTURE_KIND_OUTPUT,
      },
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(
      await recallTool(hooks, PAGE_STORE_FUTURE_KIND_SUBJECT, SESSION_ID),
      stashMissFor(PAGE_STORE_FUTURE_KIND_SUBJECT, STASH_EMPTY_OCCUPANCY),
    )
    assert.equal(
      await recallTool(hooks, PAGE_STORE_SCHEMA_OLDER_SUBJECT, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
    assert.equal((await readStats(hooks, SESSION_ID)).pageStoreSchemaError, undefined)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a newer-schema summary line is skipped for serving and halts this build's appends like any newer-schema line", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES)),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT, { schemaVersion: PAGE_STORE_SCHEMA_VERSION + 1, summary: PAGE_STORE_SUMMARY_NEWER_TEXT }),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(
      await recallTool(hooks, PAGE_STORE_SUMMARY_SUBJECT, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
    const stats = await readStats(hooks, SESSION_ID)
    assert.equal(typeof stats.pageStoreSchemaError, "string")
    assert.ok((stats.pageStoreSchemaError as string).includes(String(PAGE_STORE_SCHEMA_VERSION + 1)))

    const storeBefore = readFileSync(storePath, "utf8")
    const bundle = await runPageStoreEviction(hooks, SESSION_ID_B, PAGE_STORE_EVICTED_SUBJECT)
    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
    assert.equal(readFileSync(storePath, "utf8"), storeBefore)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("the summary writer lands the binding v2 summary line shape with and without a stash slot", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    await writeSummaryLinesDirect(storePath, [
      summaryRecordOf(PAGE_STORE_SUMMARY_SUBJECT),
      summaryRecordOf(PAGE_STORE_SUMMARY_SIBLING_SUBJECT, { stashSlot: PAGE_STORE_SUMMARY_STASH_SLOT }),
    ])

    const lines = pageLinesIn(storePath)
    assert.equal(lines.length, 2)
    assertValidTimestamp(lines[0].ts)
    assert.equal(lines[0].schemaVersion, PAGE_STORE_SCHEMA_VERSION)
    assert.equal(lines[0].session, SESSION_ID)
    assert.equal(lines[0].kind, PAGE_STORE_SUMMARY_LINE_KIND)
    assert.equal(lines[0].kind, "summary")
    assert.equal(lines[0].tool, READ_TOOL)
    assert.equal(lines[0].subject, PAGE_STORE_SUMMARY_SUBJECT)
    assert.equal(lines[0].msgIndex, 0)
    assert.equal(lines[0].partIndex, 0)
    assert.equal(lines[0].stashSlot, undefined)
    assert.equal(lines[0].summary, PAGE_STORE_SUMMARY_TEXT)
    assert.equal(lines[0].summaryModel, PAGE_STORE_SUMMARY_MODEL)
    assert.equal(lines[0].summaryTokens, PAGE_STORE_SUMMARY_TOKENS)
    assert.equal(lines[1].subject, PAGE_STORE_SUMMARY_SIBLING_SUBJECT)
    assert.equal(lines[1].stashSlot, PAGE_STORE_SUMMARY_STASH_SLOT)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("the summary writer rotates the store at the cap exactly like the page writer", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const seedLine = pageLineOf(PAGE_STORE_ROTATION_A_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES))
    const seedContent = `${JSON.stringify(seedLine)}\n`
    writeFileSync(storePath, seedContent)

    await writeSummaryLinesDirect(storePath, [summaryRecordOf(PAGE_STORE_SUMMARY_SUBJECT)], {
      pageStoreRotationMaxBytes: Buffer.byteLength(seedContent),
    })

    assert.equal(readFileSync(rotatedPageStorePathIn(pagesDir), "utf8"), seedContent)
    const freshLines = pageLinesIn(storePath)
    assert.equal(freshLines.length, 1)
    assert.equal(freshLines[0].kind, PAGE_STORE_SUMMARY_LINE_KIND)
    assert.equal(freshLines[0].subject, PAGE_STORE_SUMMARY_SUBJECT)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("the summary writer refuses under the downgrade guard and stays silent under the disabled gates", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const haltedMetrics = await writeSummaryLinesDirect(storePath, [summaryRecordOf(PAGE_STORE_SUMMARY_SUBJECT)], {}, {
      newerSchemaObserved: true,
    })
    assert.equal(existsSync(storePath), false)
    assert.equal(typeof haltedMetrics.get(SESSION_ID)?.pageStoreSchemaError, "string")

    const switchedOffMetrics = await writeSummaryLinesDirect(storePath, [summaryRecordOf(PAGE_STORE_SUMMARY_SUBJECT)], { pageStore: false })
    assert.equal(existsSync(storePath), false)
    assert.equal(switchedOffMetrics.get(SESSION_ID)?.pageStoreSchemaError, undefined)

    await writeSummaryLinesDirect(storePath, [summaryRecordOf(PAGE_STORE_SUMMARY_SUBJECT)], {
      pageStoreRotationMaxBytes: METRICS_ROTATION_DISABLED_MAX_BYTES,
    })
    assert.equal(existsSync(storePath), false)

    const enabledMetrics = await writeSummaryLinesDirect(storePath, [summaryRecordOf(PAGE_STORE_SUMMARY_SUBJECT)])
    assert.equal(pageLinesIn(storePath).length, 1)
    assert.equal(enabledMetrics.get(SESSION_ID)?.pageStoreWriteError, undefined)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a malformed summary line is skipped and the page still serves without a diagnostic", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES)),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT, { summaryModel: PAGE_STORE_MALFORMED_FIELD_VALUE }),
    ])
    const hooks = await loadPluginHooksWithPageStore(storePath)

    assert.equal(
      await recallTool(hooks, PAGE_STORE_SUMMARY_SUBJECT, SESSION_ID),
      `${outputOfBytes(MIN_EVICTABLE_BYTES)}\n${PAGE_STORE_RESTORED_LINE}`,
    )
    assert.equal((await readStats(hooks, SESSION_ID)).pageStoreSchemaError, undefined)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("pageStoreMatchesFor merges the newest summary per page key and no summary across keys", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    seedPageStore(storePath, [
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, "page one for the summarized key"),
      pageLineOf(PAGE_STORE_SUMMARY_SUBJECT, "page two for the summarized key", { msgIndex: 4 }),
      pageLineOf(PAGE_STORE_SUMMARY_SIBLING_SUBJECT, outputOfBytes(MIN_EVICTABLE_BYTES)),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT, { summary: PAGE_STORE_SUMMARY_OLDER_TEXT }),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT, { msgIndex: 4, summary: PAGE_STORE_SUMMARY_OLDER_TEXT }),
      summaryLineOf(PAGE_STORE_SUMMARY_SUBJECT, { msgIndex: 4, summary: PAGE_STORE_SUMMARY_NEWER_TEXT }),
    ])

    const summarized = await mergedPagesFor(storePath, PAGE_STORE_SUMMARY_SUBJECT)
    assert.equal(summarized.length, 2)
    assert.equal(summarized[0].output, "page one for the summarized key")
    assert.equal(summarized[0].summary?.summary, PAGE_STORE_SUMMARY_OLDER_TEXT)
    assert.equal(summarized[1].output, "page two for the summarized key")
    assert.equal(summarized[1].summary?.summary, PAGE_STORE_SUMMARY_NEWER_TEXT)

    const unsummarized = await mergedPagesFor(storePath, PAGE_STORE_SUMMARY_SIBLING_SUBJECT)
    assert.equal(unsummarized.length, 1)
    assert.equal(unsummarized[0].summary, undefined)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

const COMPRESSION_FAKE_SUMMARY = "1. the build passed\n2. one warning on line 9"
const COMPRESSION_PARITY_SUBJECT = "/data/compression-parity.txt"
const COMPRESSION_COLLISION_SUBJECT = "/data/compression-collision.txt"
const COMPRESSION_SIDE_MODEL = "zai/glm-5.3"
const COMPRESSION_LIFECYCLE_CALLS = 4
const COMPRESSION_MALFORMED_PROMPTS = 2
const COMPRESSION_INVALID_BUDGETS = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]

// The wiring fake mirrors the HOST client envelope the entry's adapter
// consumes: client.session.create/prompt/messages/delete, each resolving
// the SDK result shape ({ data } on success). create yields side-N ids in
// order; readback returns one user row and one assistant row carrying the
// configured text (readTexts scripts per read, falling back to the
// default summary); holdPrompt parks each prompt until releasePrompts so
// the fire-and-forget ordering is observable; settledAfter resolves once
// that many side sessions were deleted. promptBodies captures each
// prompt's body so the tools-off map is pinnable.
const createWiringFakeClient = (config: { readTexts?: string[]; holdPrompt?: boolean } = {}) => {
  const calls: string[] = []
  const created: string[] = []
  const deleted: string[] = []
  const promptBodies: unknown[] = []
  let createCount = 0
  let readCount = 0
  let parkedPrompts = 0
  let promptReleases: ((value: void) => void)[] = []
  const promptWaiters: { count: number; resolve: (value: void) => void }[] = []
  const deleteWaiters: { count: number; resolve: (value: void) => void }[] = []
  const resolveWaiters = (waiters: { count: number; resolve: (value: void) => void }[], count: number): void => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]
      if (waiter !== undefined && count >= waiter.count) {
        waiters.splice(index, 1)
        waiter.resolve()
      }
    }
  }
  const client = {
    session: {
      create: async ({ body }: { body?: { title?: string } }) => {
        calls.push("create")
        createCount += 1
        const id = `side-${createCount}`
        created.push(id)
        return { data: { id, title: body?.title, parentID: null } }
      },
      prompt: async ({ path, body }: { path: { id: string }; body?: unknown }) => {
        calls.push(`prompt:${path.id}`)
        promptBodies.push(body)
        if (config.holdPrompt === true) {
          parkedPrompts += 1
          resolveWaiters(promptWaiters, parkedPrompts)
          await new Promise<void>((resolve) => { promptReleases.push(resolve) })
        }
        return { data: { info: { id: `msg-${path.id}`, role: "assistant", providerID: "zai", modelID: "glm-5.3" }, parts: [] } }
      },
      messages: async ({ path }: { path: { id: string } }) => {
        calls.push(`read:${path.id}`)
        const index = readCount
        readCount += 1
        return {
          data: [
            { info: { role: "user" }, parts: [{ type: "text", text: "summarize" }] },
            {
              info: { role: "assistant", modelID: "glm-5.3", providerID: "zai" },
              parts: [{ type: "text", text: config.readTexts?.[index] ?? COMPRESSION_FAKE_SUMMARY }],
            },
          ],
        }
      },
      delete: async ({ path }: { path: { id: string } }) => {
        calls.push(`delete:${path.id}`)
        deleted.push(path.id)
        resolveWaiters(deleteWaiters, deleted.length)
        return { data: true }
      },
    },
  }
  return {
    client,
    calls,
    created,
    deleted,
    promptBodies,
    releasePrompts: (): void => {
      for (const release of promptReleases) release()
      promptReleases = []
    },
    // Resolves once that many prompts are parked: the drain parks one
    // tick after the transform returns, so a release issued before this
    // resolves would be swallowed by the parking.
    whenPrompted: (count: number): Promise<void> =>
      parkedPrompts >= count ? Promise.resolve() : new Promise<void>((resolve) => { promptWaiters.push({ count, resolve }) }),
    settledAfter: (count: number): Promise<void> =>
      deleted.length >= count ? Promise.resolve() : new Promise<void>((resolve) => { deleteWaiters.push({ count, resolve }) }),
  }
}

// The loader takes the fake host client structurally: the entry's seam
// input is the host client envelope, not the SummaryClient contract the
// adapter produces.
const loadPluginHooksWithClient = async (client: unknown, extra: Record<string, unknown> = {}): Promise<HookMap> =>
  (await contextManagerFactory(
    { client },
    { metricsLog: false, liveStateLog: false, ingestionHygieneCopy: false, pageStore: false, ...extra },
  )) as HookMap

const loadPluginHooksWithClientAndStore = async (client: unknown, storePath: string, extra: Record<string, unknown> = {}): Promise<HookMap> =>
  (await contextManagerFactory(
    { client },
    {
      metricsLog: false,
      liveStateLog: false,
      ingestionHygieneCopy: false,
      pageStore: true,
      pageStorePath: storePath,
      ...extra,
    },
  )) as HookMap

test("a gate-on watermark eviction runs one side-call lifecycle and lands a v2 summary line beside the page", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const fake = createWiringFakeClient()
    const hooks = await loadPluginHooksWithClientAndStore(fake.client, storePath, { [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true })

    const bundle = await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)
    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
    await fake.settledAfter(1)

    assert.equal(fake.created.length, 1)
    assert.deepEqual(fake.calls, [
      "create",
      `prompt:${fake.created[0]}`,
      `read:${fake.created[0]}`,
      `delete:${fake.created[0]}`,
    ])
    assert.equal(fake.calls.length, COMPRESSION_LIFECYCLE_CALLS)
    // The side prompt carries the verbatim evicted output and the full
    // tools-off map, so the summarizing model holds no tool surface.
    const promptBody = fake.promptBodies[0] as { parts?: Array<{ text?: string }>; tools?: Record<string, boolean> } | undefined
    assert.ok(promptBody?.parts?.[0]?.text?.includes(outputOfBytes(MIN_EVICTABLE_BYTES)))
    const tools = promptBody?.tools ?? {}
    assert.ok(Object.keys(tools).length > 0)
    assert.equal(Object.values(tools).every((off) => off === false), true)
    const lines = pageLinesIn(storePath)
    assert.equal(lines.length, 2)
    const summaryLine = lines.find((line) => line.kind === PAGE_STORE_SUMMARY_LINE_KIND)
    assert.equal(summaryLine?.schemaVersion, PAGE_STORE_SCHEMA_VERSION)
    assert.equal(summaryLine?.session, SESSION_ID)
    assert.equal(summaryLine?.tool, READ_TOOL)
    assert.equal(summaryLine?.subject, PAGE_STORE_EVICTED_SUBJECT)
    assert.equal(summaryLine?.msgIndex, 0)
    assert.equal(summaryLine?.partIndex, 0)
    assert.equal(summaryLine?.summary, COMPRESSION_FAKE_SUMMARY)
    assert.equal(summaryLine?.summaryModel, COMPRESSION_SIDE_MODEL)
    assert.equal(typeof summaryLine?.summaryTokens, "number")
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("recall after a wired compression serves the summary by default and verbatim true recovers the original", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const fake = createWiringFakeClient()
    const hooks = await loadPluginHooksWithClientAndStore(fake.client, storePath, { [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true })
    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)
    await fake.settledAfter(1)

    assert.equal(await recallTool(hooks, PAGE_STORE_EVICTED_SUBJECT, SESSION_ID), summaryServeTextFor(COMPRESSION_FAKE_SUMMARY))
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).recallHits, 0)

    const verbatim = await recallToolArgs(hooks, { [RECALL_ARG_NAME]: PAGE_STORE_EVICTED_SUBJECT, [RECALL_VERBATIM_ARG_NAME]: true }, SESSION_ID)
    assert.equal(verbatim, outputOfBytes(MIN_EVICTABLE_BYTES))
    assert.equal(countersOf(await readStats(hooks, SESSION_ID)).recallHits, 1)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a gate-on aged read eviction fires the side call like the watermark tier", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const fake = createWiringFakeClient()
    const hooks = await loadPluginHooksWithClientAndStore(fake.client, storePath, {
      [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true,
      agedReadEvictionMessages: AGED_EVICTION_MESSAGES,
    })

    const bundle = buildBundle([
      [pathToolPart(AGED_READ_PATH, MIN_EVICTABLE_BYTES)],
      ...fillerMessages(AGED_FILLER_COUNT),
    ])
    await runTransform(hooks, bundle)
    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
    await fake.settledAfter(1)

    assert.equal(fake.created.length, 1)
    const lines = pageLinesIn(storePath)
    assert.equal(lines.filter((line) => line.kind === PAGE_STORE_SUMMARY_LINE_KIND).length, 1)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a fence eviction never fires the side call even when the compression gate is on", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const fake = createWiringFakeClient()
    const hooks = await loadPluginHooksWithClientAndStore(fake.client, storePath, {
      [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true,
      userFenceEviction: { enabled: true },
    })

    const block = fenceBlockText(FENCE_LANGUAGE_TS, fenceContentLines(FENCE_OVER_LINES, FENCE_LINE_TAG))
    await runTransform(hooks, userFenceBundle(`${FENCE_PROSE_BEFORE}\n${block}\n${FENCE_PROSE_AFTER}`))

    assert.deepEqual(fake.calls, [])
    assert.equal(fake.created.length, 0)
    const lines = pageLinesIn(storePath)
    assert.equal(lines.length, 1)
    assert.equal(lines[0].tool, FENCE_STASH_TOOL_LABEL)
    assert.equal(lines[0].kind, undefined)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("the transform lands the tombstone the page line and the run outcome before the side call settles", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const fake = createWiringFakeClient({ holdPrompt: true })
    const hooks = await loadPluginHooksWithClientAndStore(fake.client, storePath, { [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true })

    const bundle = await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)

    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
    assert.equal(pageLinesIn(storePath).length, 1)
    const stats = await readStats(hooks, SESSION_ID)
    assert.equal(countersOf(stats).evictions, 1)
    assert.notEqual(stats.lastRun, null)

    await fake.whenPrompted(1)
    fake.releasePrompts()
    await fake.settledAfter(1)
    assert.equal(pageLinesIn(storePath).length, 2)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("gate off with a client present and gate on without a client stay byte-identical to today and fire nothing", async () => {
  const evictionLimit = contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS)

  const plainHooks = await loadPluginHooks()
  const plainBundle = buildStandardBundle(SESSION_ID, COMPRESSION_PARITY_SUBJECT)
  await setContextLimit(plainHooks, SESSION_ID, evictionLimit)
  await runTransform(plainHooks, plainBundle)

  const gatedOffFake = createWiringFakeClient()
  const gatedOffHooks = await loadPluginHooksWithClient(gatedOffFake.client, { [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: false })
  const gatedOffBundle = buildStandardBundle(SESSION_ID, COMPRESSION_PARITY_SUBJECT)
  await setContextLimit(gatedOffHooks, SESSION_ID, evictionLimit)
  await runTransform(gatedOffHooks, gatedOffBundle)

  const noClientHooks = await loadPluginHooksWith({ [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true })
  const noClientBundle = buildStandardBundle(SESSION_ID, COMPRESSION_PARITY_SUBJECT)
  await setContextLimit(noClientHooks, SESSION_ID, evictionLimit)
  await runTransform(noClientHooks, noClientBundle)

  const plainOutput = toolPartAt(plainBundle.messages[0], 0).state.output
  assert.ok(plainOutput.startsWith(TOMBSTONE_MARKER))
  assert.equal(toolPartAt(gatedOffBundle.messages[0], 0).state.output, plainOutput)
  assert.equal(toolPartAt(noClientBundle.messages[0], 0).state.output, plainOutput)
  assert.equal(gatedOffFake.calls.length, 0)
  assert.equal(gatedOffFake.created.length, 0)
})

test("a wired side-call failure keeps today's tombstone store line and full-serve recall", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const fake = createWiringFakeClient({ readTexts: ["", ""] })
    const hooks = await loadPluginHooksWithClientAndStore(fake.client, storePath, { [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true })

    const bundle = await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)
    assert.ok(toolPartAt(bundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
    await fake.settledAfter(1)

    assert.equal(fake.calls.filter((call) => call.startsWith("prompt:")).length, COMPRESSION_MALFORMED_PROMPTS)
    assert.equal(fake.deleted.length, 1)
    const lines = pageLinesIn(storePath)
    assert.equal(lines.length, 1)
    assert.equal(lines[0].kind, undefined)
    assert.equal(await recallTool(hooks, PAGE_STORE_EVICTED_SUBJECT, SESSION_ID), outputOfBytes(MIN_EVICTABLE_BYTES))
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a wired compression accrues the session summary counters into describe and the metrics log totals", async () => {
  const metricsDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(metricsDir)
    const metricsPath = metricsLogPathIn(metricsDir)
    const fake = createWiringFakeClient()
    const hooks = await loadPluginHooksWithClientAndStore(fake.client, storePath, {
      [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true,
      metricsLog: true,
      metricsPath,
    })

    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)
    await fake.settledAfter(1)
    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_REPLACEMENT_SUBJECT)
    const lines = metricsLinesIn(metricsPath)
    assert.ok(lines.length >= 2)
    const newestTotals = lines[lines.length - 1].totals as Record<string, number>
    assert.equal(newestTotals.summariesQueued, 2)
    assert.equal(newestTotals.summariesWritten, 1)
    assert.equal(newestTotals.summaryFailures, 0)
    await fake.settledAfter(2)
    const counters = countersOf(await readStats(hooks, SESSION_ID))
    assert.equal(counters.summariesQueued, 2)
    assert.equal(counters.summariesWritten, 2)
    assert.equal(counters.summaryFailures, 0)
  } finally {
    cleanupMetricsDir(metricsDir)
  }
})

test("a wired side-call failure accrues the failure counter and surfaces summaryLastError through describe", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const fake = createWiringFakeClient({ readTexts: ["", ""] })
    const hooks = await loadPluginHooksWithClientAndStore(fake.client, storePath, { [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true })

    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)
    await fake.settledAfter(1)

    const stats = await readStats(hooks, SESSION_ID)
    const counters = countersOf(stats)
    assert.equal(counters.summariesQueued, 1)
    assert.equal(counters.summariesWritten, 0)
    assert.equal(counters.summaryFailures, COMPRESSION_MALFORMED_PROMPTS)
    assert.match(String(stats.summaryLastError), /^malformed: /)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("a summary written by session A serves a cross-session recall of A's page", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const fake = createWiringFakeClient()
    const hooks = await loadPluginHooksWithClientAndStore(fake.client, storePath, { [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true })

    await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)
    await fake.settledAfter(1)

    assert.equal(await recallTool(hooks, PAGE_STORE_EVICTED_SUBJECT, SESSION_ID_B), summaryServeTextFor(COMPRESSION_FAKE_SUMMARY))
    assert.equal(countersOf(await readStats(hooks, SESSION_ID_B)).recallHits, 0)
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("session B's stash page at the same key never serves session A's wired summary", async () => {
  const pagesDir = makeMetricsDir()
  try {
    const storePath = pageStorePathIn(pagesDir)
    const fake = createWiringFakeClient({ readTexts: [COMPRESSION_FAKE_SUMMARY, "", ""] })
    const hooks = await loadPluginHooksWithClientAndStore(fake.client, storePath, { [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true })

    await runPageStoreEviction(hooks, SESSION_ID, COMPRESSION_COLLISION_SUBJECT)
    await fake.settledAfter(1)
    await runPageStoreEviction(hooks, SESSION_ID_B, COMPRESSION_COLLISION_SUBJECT)
    await fake.settledAfter(2)

    assert.equal(fake.deleted.length, 2)
    assert.equal(await recallTool(hooks, COMPRESSION_COLLISION_SUBJECT, SESSION_ID_B), outputOfBytes(MIN_EVICTABLE_BYTES))
  } finally {
    cleanupMetricsDir(pagesDir)
  }
})

test("the transform hook stands down for a side session with identity output", async () => {
  const fake = createWiringFakeClient({ holdPrompt: true })
  const hooks = await loadPluginHooksWithClient(fake.client, { [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true })
  const hostBundle = await runPageStoreEviction(hooks, SESSION_ID, PAGE_STORE_EVICTED_SUBJECT)
  const sideSessionID = fake.created[0]
  assert.ok(sideSessionID !== undefined)

  await setContextLimit(hooks, sideSessionID, contextForDeficit(STANDARD_BUNDLE_CHARS, OVER_BY_ONE_TOKENS))
  const sideBundle = buildStandardBundle(sideSessionID, PAGE_STORE_EVICTED_SUBJECT)
  await runTransform(hooks, sideBundle)

  assert.equal(toolPartAt(sideBundle.messages[0], 0).state.output, outputOfBytes(MIN_EVICTABLE_BYTES))
  assert.ok(toolPartAt(hostBundle.messages[0], 0).state.output.startsWith(TOMBSTONE_MARKER))
  assert.equal(fake.created.length, 1)

  await fake.whenPrompted(1)
  fake.releasePrompts()
  await fake.settledAfter(1)
})

test("describe echoes the compression pair defaulting to off and the compressor's 256-token budget", async () => {
  assert.equal(SCHEMA_DEFAULT_SUMMARY_TOKEN_BUDGET, SUMMARIES_DEFAULT_SUMMARY_TOKEN_BUDGET)
  const hooks = await loadPluginHooks()

  const options = (await readStats(hooks, SESSION_ID)).options as Record<string, unknown>

  assert.equal(options[OPTION_SUMMARIZE_EVICTED_OUTPUTS], false)
  assert.equal(options[OPTION_SUMMARY_TOKEN_BUDGET], SCHEMA_DEFAULT_SUMMARY_TOKEN_BUDGET)
})

test("an invalid summaryTokenBudget drops to the default and a valid pair passes through", () => {
  for (const invalidBudget of COMPRESSION_INVALID_BUDGETS) {
    assert.equal(resolveOptions({ [OPTION_SUMMARY_TOKEN_BUDGET]: invalidBudget })[OPTION_SUMMARY_TOKEN_BUDGET], SCHEMA_DEFAULT_SUMMARY_TOKEN_BUDGET)
  }
  assert.equal(resolveOptions({ [OPTION_SUMMARY_TOKEN_BUDGET]: 512 })[OPTION_SUMMARY_TOKEN_BUDGET], 512)
  assert.equal(resolveOptions({ [OPTION_SUMMARIZE_EVICTED_OUTPUTS]: true })[OPTION_SUMMARIZE_EVICTED_OUTPUTS], true)
  assert.equal(resolveOptions({})[OPTION_SUMMARIZE_EVICTED_OUTPUTS], false)
})
