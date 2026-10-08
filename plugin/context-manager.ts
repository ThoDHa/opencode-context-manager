import { randomUUID } from "node:crypto"
import type { Plugin, PluginInput, PluginModule } from "@opencode-ai/plugin"
import { PLUGIN_ID } from "./schema.ts"

import { chatParamsHookBody, type ChatParamsModel, type ContextLimitEntry } from "./context-limits.ts"
import type { MessageBundle } from "./messages.ts"
import { resolveOptions, type ContextManagerOptions } from "./options.ts"
import { FALLBACK_SESSION_KEY, rememberSessionValue, sessionKeyFromContext, touchMapEntry, trimMapToBound } from "./session-maps.ts"
import { HINT_LINE_PREFIX, orderedRenderedSubjectsOf, RECALL_TOOL_NAME, SUBJECT_SEPARATOR } from "./vocabulary.ts"
import { rememberError, type MetricsHydration, type MetricsStore, type PersistedTotals, type SessionMetrics } from "./state.ts"
import { appendHygieneCopy, migrateLegacyDefaultPaths, newestPersistedTotalsOf, PRUNE_SCAN_NEVER, type PruneThrottle } from "./persistence.ts"
import { pageKeyOf, recordPageStoreSummaryLines } from "./page-store.ts"
import type { PageStoreBySession, PageStoreGuard, PageSummaryLookup, PageSummaryRecord, SessionPageStore } from "./page-store.ts"
import { stripTerminalNoiseFrom, type HygieneCadenceBySession } from "./hygiene.ts"
import { deliverHint, type HintMembershipBySession } from "./hints.ts"
import { DEFAULT_SUMMARY_MAP_LIMIT, createSummaryCompressor } from "./summaries.ts"
import type { SummaryClient, SummaryStoreLine } from "./summaries.ts"
import { DESCRIBE_TOOL_DESCRIPTION, DESCRIBE_TOOL_NAME, executeReadEvicted, executeStatsTool, guardTool, RECALL_TOOL_ARGS, RECALL_TOOL_DESCRIPTION } from "./tools.ts"
import { transformHookBody, type TransformHookDeps } from "./pipeline.ts"

export { ADVISORY_BAND_RATIO_DEFAULT, DEFAULT_INGESTION_HYGIENE_ROTATION_MAX_BYTES, DEFAULT_METRICS_ROTATION_MAX_BYTES, DEFAULT_PAGE_STORE_ROTATION_MAX_BYTES } from "./options.ts"
export { METRIC_NUMBER_KEYS, METRICS_CURSOR_KEYS, RAW_COUNTER_KEYS } from "./state.ts"
export type { MetricsCursorKey } from "./state.ts"
export { PAGE_STORE_SCHEMA_VERSION } from "./page-store.ts"

// The compaction-prompt enrichment: when the host's native compaction
// fires, append a compact block carrying the session's remembered evicted
// subjects (sharing the hint line's newest-first order and hintSubjects
// bound, not its membership: the hint renders live subjects, this renders
// remembered evicted subjects) and, when the session stash holds
// reloadable outputs, a one-line note naming the newest stashed subjects
// through recall. Appends context strings only; the native prompt
// is never replaced, and an unknown session attaches nothing.
const COMPACTION_BLOCK_MARKER = "[ctx]"
const OMISSIONS_LINE_LEAD = "standing omissions: "
const OMISSIONS_TOOL_OUTPUTS_LABEL = "tool outputs"
const OMISSIONS_REASONING_BLOCKS_LABEL = "reasoning blocks"
const OMISSIONS_FENCED_BLOCKS_LABEL = "fenced blocks"
const OMISSIONS_RELOAD_LEAD = "; reload via "
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

// The side session's tools-off map: sent on every side prompt so the
// summarizing model never holds the host's tool surface. The LRU-60
// spike's Q7 probe measured the map both accepted and effective; the
// names are the host's standard tool set.
const SIDE_SESSION_TOOLS_OFF: Record<string, boolean> = {
  bash: false,
  edit: false,
  write: false,
  read: false,
  grep: false,
  glob: false,
  list: false,
  patch: false,
  todowrite: false,
  task: false,
  webfetch: false,
}

// A loosely typed host error payload: the SDK's failure result carries a
// generic error object whose specific reason, when present, sits at
// .data.message (the LRU-60 spike's Q5 shape).
const summaryErrorTextOf = (error: unknown): string => {
  if (error instanceof Error) return error.message
  const fields = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {}
  const data = fields["data"]
  const message = typeof data === "object" && data !== null ? (data as Record<string, unknown>)["message"] : undefined
  return typeof message === "string" ? message : String(error)
}

// The entry's host seam: adapts the host client's session namespace onto
// the SummaryClient contract (create, tools-off, prompt, readback,
// delete). Tools-off rides the prompt body (the SDK session surface has
// no tools switch of its own), so disableTools is a no-op and every side
// prompt carries the full off map. Every created id joins the registry so
// the transform hook can stand down for the side sessions, and leaves it
// only on a settled delete, so a session whose delete failed stays
// guarded. A fault in any touch throws into the compressor's failure
// taxonomy; nothing here blocks or escapes on its own.
const hostSummaryClientOf = (client: PluginInput["client"], sideSessionIds: Set<string>): SummaryClient => ({
  createSession: async (title) => {
    const result = await client.session.create({ body: { title } })
    const id = result.data?.id
    if (typeof id !== "string" || id.length === 0) throw new Error("the side-session create returned no session id")
    sideSessionIds.add(id)
    return id
  },
  disableTools: async () => {},
  sendPrompt: async (sessionId, prompt) => {
    const result = await client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: prompt }], tools: SIDE_SESSION_TOOLS_OFF },
    })
    if (result.data === undefined) return { ok: false, error: summaryErrorTextOf(result.error) }
    return { ok: true }
  },
  readMessages: async (sessionId) => {
    const result = await client.session.messages({ path: { id: sessionId } })
    const rows = result.data
    if (rows === undefined) throw new Error("the side-session readback returned no rows")
    return rows.map((row) => {
      const { info } = row
      // Model ids ride assistant messages; the compressor's model reader
      // only ever looks at the last assistant row, so other rows carry
      // neither.
      const modelID = info.role === "assistant" ? info.modelID : undefined
      const providerID = info.role === "assistant" ? info.providerID : undefined
      return {
        info: { role: info.role, modelID, providerID },
        parts: row.parts.map((part) => ({ type: part.type, text: part.type === "text" ? part.text : undefined })),
      }
    })
  },
  deleteSession: async (sessionId) => {
    const result = await client.session.delete({ path: { id: sessionId } })
    if (result.data === undefined) throw new Error("the side-session delete failed")
    sideSessionIds.delete(sessionId)
  },
})

const server = (async (pluginInput, rawOptions) => {
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
  // The compression-on-evict side path: built only when the gate is on
  // AND the host provided a client. Every other start leaves the plugin
  // byte-identical to the pre-compression build: no sink reaches the
  // walk, no side session is created, and recall consults an empty map.
  const sideSessionIds = new Set<string>()
  const summariesBySessionAndKey = new Map<string, Map<string, PageSummaryRecord>>()
  const summarySink = async (line: SummaryStoreLine): Promise<void> => {
    const record: PageSummaryRecord = {
      tool: line.tool,
      subject: line.subject,
      msgIndex: line.msgIndex,
      partIndex: line.partIndex,
      ...(line.stashSlot === undefined ? {} : { stashSlot: line.stashSlot }),
      summary: line.summary,
      summaryModel: line.summaryModel,
      summaryTokens: line.summaryTokens,
    }
    // The consult map's write side, session-then-key exactly like the
    // store merge: the line's own session scopes it, so a summary never
    // serves another session's page at the same key.
    const byPageKey = touchMapEntry(summariesBySessionAndKey, line.session) ?? new Map<string, PageSummaryRecord>()
    rememberSessionValue(
      byPageKey,
      pageKeyOf(record.tool, record.subject, record.msgIndex, record.partIndex, record.stashSlot),
      record,
      DEFAULT_SUMMARY_MAP_LIMIT,
    )
    summariesBySessionAndKey.set(line.session, byPageKey)
    trimMapToBound(summariesBySessionAndKey, options.stashSessions)
    // The store line rides the page writer's rotation, downgrade-refusal,
    // and diagnostic machinery; a failed write is a session diagnostic,
    // never a thrown error, so the compressor's drain never wedges here.
    await recordPageStoreSummaryLines(options, metricsBySession, line.session, [record], pageStoreGuard)
  }
  const summaryCompressor =
    options.summarizeEvictedOutputs && pluginInput?.client !== undefined
      ? createSummaryCompressor({
          client: hostSummaryClientOf(pluginInput.client, sideSessionIds),
          sink: summarySink,
          budgetTokens: options.summaryTokenBudget,
        })
      : undefined
  // The recall-side consult seam: scoped by the writing session exactly
  // as the store merge is, so a summary serves only a page its own
  // session wrote and an unscopable session never consults.
  const summaryLookup: PageSummaryLookup = (session, tool, subject, msgIndex, partIndex, stashSlot) => {
    if (session === undefined) return undefined
    return summariesBySessionAndKey.get(session)?.get(pageKeyOf(tool, subject, msgIndex, partIndex, stashSlot))
  }
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
    summaryCompressor,
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
    executeReadEvicted(pageStoreBySession, metricsBySession, metricsHydrationBySession, persistedTotalsForSession, options.metricsSessions, options, args, toolContext, pageStoreGuard, summaryLookup)

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
        // Side-session stand-down: a side session's own model call
        // re-enters this hook, and returning identity output is the
        // recursion guard the LRU-60 spike validated. The session key is
        // the session id whenever one resolved; ids leave the registry
        // only on a settled delete, so a session whose delete failed
        // stays guarded.
        if (sessionKey !== FALLBACK_SESSION_KEY && sideSessionIds.has(sessionKey)) return
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
        args: RECALL_TOOL_ARGS,
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
