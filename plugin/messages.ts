import type { ResolvedOptions } from "./options.ts"
import type { RunComposition } from "./state.ts"

const FILE_PART_TYPE = "file"
const FILE_FILENAME_KEY = "filename"
export const TEXT_PART_TYPE = "text"

export const REASONING_PART_TYPE = "reasoning"
export const REASONING_TEXT_KEY = "text"
export const REASONING_METADATA_KEY = "metadata"

const ATTACHMENTS_STATE_KEY = "attachments"
export const ATTACHMENT_URL_KEY = "url"
export const ATTACHMENT_MIME_KEY = "mime"

export type FilePartFields = { mime: string; url: string; filename: string }

export type MessageBundle = {
  info: { sessionID?: string; role?: unknown }
  parts: Array<Record<string, unknown>>
}

export const hotFromIndexOf = (messages: MessageBundle[], options: ResolvedOptions): number =>
  messages.length - options.recentWindow

export const retentionFromIndexOf = (messages: MessageBundle[], options: ResolvedOptions): number =>
  messages.length - options.reasoningRetentionMessages

export const completedOutputOf = (part: Record<string, unknown>): { output: string; attachments?: unknown } | undefined => {
  if (part["type"] !== "tool") return undefined
  const state = part["state"]
  if (typeof state !== "object" || state === null) return undefined
  const typedState = state as Record<string, unknown>
  if (typedState["status"] !== "completed" || typeof typedState["output"] !== "string") return undefined
  return typedState as { output: string; attachments?: unknown }
}

export const attachmentPayloadCharsOf = (state: Record<string, unknown>): number => {
  const attachments = state[ATTACHMENTS_STATE_KEY]
  if (!Array.isArray(attachments)) return 0
  let chars = 0
  for (const attachment of attachments) {
    const url =
      typeof attachment === "object" && attachment !== null ? (attachment as Record<string, unknown>)[ATTACHMENT_URL_KEY] : undefined
    if (typeof url === "string") chars += url.length
  }
  return chars
}

export const nonEmptyAttachmentsOf = (state: { attachments?: unknown }): unknown[] | undefined => {
  const attachments = state[ATTACHMENTS_STATE_KEY]
  return Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined
}

export const stripStateAttachments = (state: { attachments?: unknown }): void => {
  if (!Array.isArray(state[ATTACHMENTS_STATE_KEY])) return
  delete state[ATTACHMENTS_STATE_KEY]
}

export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((element) => stableStringify(element)).join(",")}]`
  if (typeof value !== "object" || value === null) return JSON.stringify(value)
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`
}

export const filePartOf = (part: Record<string, unknown>): FilePartFields | undefined => {
  if (part["type"] !== FILE_PART_TYPE) return undefined
  const mime = part[ATTACHMENT_MIME_KEY]
  const url = part[ATTACHMENT_URL_KEY]
  if (typeof mime !== "string" || typeof url !== "string") return undefined
  const filename = part[FILE_FILENAME_KEY]
  return { mime, url, filename: typeof filename === "string" ? filename : "" }
}

export const estimateTokensFromBytes = (bytes: number, charsPerToken: number): number => Math.ceil(bytes / charsPerToken)

export const estimateTokens = (messages: MessageBundle[], charsPerToken: number): number => {
  let chars = 0
  for (const message of messages) {
    for (const part of message.parts) {
      if (part["type"] === TEXT_PART_TYPE && typeof part["text"] === "string") {
        chars += part["text"].length
      } else {
        const outputRef = completedOutputOf(part)
        if (outputRef) chars += outputRef.output.length
      }
    }
  }
  return estimateTokensFromBytes(chars, charsPerToken)
}

// Terminal escape sequences counted for escapeBytes and stripped by
// ingestion hygiene: CSI sequences (ESC [ ... final byte) and OSC
// sequences (ESC ] ... BEL or ST terminator). Matched spans count their
// whole length; a truncated CSI without a final byte, an unterminated
// OSC, and a lone ESC without an introducer are not counted. The OSC
// payload is non-greedy, so consecutive OSC spans each end at their own
// terminator instead of swallowing the text between them. Deterministic
// single pass.
export const ESCAPE_SPAN_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*?(?:\x07|\x1b\\)/g

const escapeBytesOf = (output: string): number => {
  let bytes = 0
  for (const span of output.match(ESCAPE_SPAN_PATTERN) ?? []) bytes += span.length
  return bytes
}

// The post-transform composition of one run's message list: live tool
// outputs, text parts, and the reasoning still inside the retention age.
// Called after every pass has edited the list, so the three sums are the
// view the model actually receives. The estimate relation is exact for
// the two sums the estimate counts: estimatedTokens equals
// ceil((toolPoolBytes + textChars) / charsPerToken) over this same list,
// while reasoningInWindowBytes and attachmentBytes are bill components
// the estimate omits. reasoningInWindowBytes keeps its key while meaning
// retained bytes: the sum runs over the reasoningRetentionMessages
// boundary, not the hot window, so it covers the reasoning the request
// actually carries for any retention setting. attachmentBytes reuses the
// evictor's own attachment accounting (tool-state attachment url payloads
// via attachmentPayloadCharsOf) — a superset of eviction's tool-state
// attachment accounting, extended with file-part url lengths; embedded
// images inside file parts, data-URI text outputs, and non-attachment
// host content are the known gaps, not a second measure.
export const runCompositionOf = (messages: MessageBundle[], options: ResolvedOptions): RunComposition => {
  const retentionFromIndex = retentionFromIndexOf(messages, options)
  let toolPoolBytes = 0
  let textChars = 0
  let reasoningInWindowBytes = 0
  let escapeBytes = 0
  let attachmentBytes = 0
  for (let msgIndex = 0; msgIndex < messages.length; msgIndex += 1) {
    const inRetainedWindow = msgIndex >= retentionFromIndex
    for (const part of messages[msgIndex].parts) {
      if (part["type"] === TEXT_PART_TYPE) {
        const text = part["text"]
        if (typeof text === "string") textChars += text.length
        continue
      }
      if (part["type"] === REASONING_PART_TYPE) {
        const text = part[REASONING_TEXT_KEY]
        if (inRetainedWindow && typeof text === "string") reasoningInWindowBytes += text.length
        continue
      }
      if (part["type"] === FILE_PART_TYPE) {
        const file = filePartOf(part)
        if (file !== undefined) attachmentBytes += file.url.length
        continue
      }
      const outputRef = completedOutputOf(part)
      if (outputRef) {
        toolPoolBytes += outputRef.output.length
        escapeBytes += escapeBytesOf(outputRef.output)
        attachmentBytes += attachmentPayloadCharsOf(outputRef)
      }
    }
  }
  return { toolPoolBytes, textChars, reasoningInWindowBytes, escapeBytes, attachmentBytes }
}
