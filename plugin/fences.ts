import { hotFromIndexOf, TEXT_PART_TYPE } from "./messages.ts"
import type { MessageBundle } from "./messages.ts"
import { boundedSingleLineOf, buildFenceTombstone } from "./vocabulary.ts"
import type { ResolvedOptions } from "./options.ts"
import type { PageEntry, SessionPageStore } from "./page-store.ts"
import { storeEvictedPage } from "./page-store.ts"
import type { FenceEviction } from "./state.ts"

const FENCE_STASH_TOOL_LABEL = "fence"
const FENCE_BACKTICK = "`"
const MIN_FENCE_MARKER_TICKS = 3
// CommonMark: a line indented four or more spaces is indented code, never a fence.
const MAX_FENCE_INDENT_SPACES = 3
const FENCE_INDENT_SPACE = " "
const FENCE_INFO_SEPARATOR = /\s+/
const USER_MESSAGE_ROLE = "user"

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

export const evictLargeUserFences = (messages: MessageBundle[], options: ResolvedOptions, pageStore: SessionPageStore, pageStoreEntries: PageEntry[]): FenceEviction => {
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
