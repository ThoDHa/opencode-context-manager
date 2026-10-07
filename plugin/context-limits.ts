import type { ResolvedOptions } from "./options.ts"

export const CONTEXT_TOKENS_SOURCE_OVERRIDE = "override"
export const CONTEXT_TOKENS_SOURCE_MODEL = "model"
export const CONTEXT_TOKENS_SOURCE_DEFAULT = "default"
export const CONTEXT_TOKENS_SOURCE_UNKNOWN = "unknown"
const MODEL_KEY_SEPARATOR = "/"

export type ContextTokensSource =
  | typeof CONTEXT_TOKENS_SOURCE_OVERRIDE
  | typeof CONTEXT_TOKENS_SOURCE_MODEL
  | typeof CONTEXT_TOKENS_SOURCE_DEFAULT
  | typeof CONTEXT_TOKENS_SOURCE_UNKNOWN

export type ContextLimitEntry = { tokens: number; source: ContextTokensSource; modelKey: string | undefined }

export type ContextLimit = { tokens: number | null; source: ContextTokensSource; modelKey: string | undefined }

export type ChatParamsModel = { providerID?: string; modelID?: string; limit?: { context?: number } }

export type PersistedContextLimit = { tokens: number; source: ContextTokensSource; modelKey: string | undefined }

export const modelKeyOf = (model: ChatParamsModel | undefined): string | undefined => {
  const providerID = model?.providerID
  const modelID = model?.modelID
  if (typeof providerID !== "string" || providerID.length === 0) return undefined
  if (typeof modelID !== "string" || modelID.length === 0) return undefined
  return `${providerID}${MODEL_KEY_SEPARATOR}${modelID}`
}

// An entry without an identity (a limit-only chat params event) is never
// reset: nothing ties it to a model, so any later event retains it.
export const storedContextLimitBelongsToAnotherModel = (stored: ContextLimitEntry | undefined, modelKey: string | undefined): boolean =>
  modelKey !== undefined && stored !== undefined && stored.modelKey !== undefined && stored.modelKey !== modelKey

export const captureContextLimitOf = (model: ChatParamsModel | undefined, overrides: Record<string, number>): ContextLimitEntry | undefined => {
  const modelKey = modelKeyOf(model)
  const override = modelKey === undefined ? undefined : overrides[modelKey]
  if (override !== undefined) return { tokens: override, source: CONTEXT_TOKENS_SOURCE_OVERRIDE, modelKey }
  const reported = model?.limit?.context
  if (typeof reported === "number" && Number.isFinite(reported) && reported > 0)
    return { tokens: reported, source: CONTEXT_TOKENS_SOURCE_MODEL, modelKey }
  return undefined
}

const resolveContextLimit = (sessionEntry: ContextLimitEntry | undefined, explicitDefault: number | undefined): ContextLimit => {
  if (sessionEntry !== undefined) return { tokens: sessionEntry.tokens, source: sessionEntry.source, modelKey: sessionEntry.modelKey }
  if (explicitDefault !== undefined) return { tokens: explicitDefault, source: CONTEXT_TOKENS_SOURCE_DEFAULT, modelKey: undefined }
  return { tokens: null, source: CONTEXT_TOKENS_SOURCE_UNKNOWN, modelKey: undefined }
}

type ContextLimitResolution = { contextLimit: ContextLimit; fallbackSuppressed: boolean }

// Shared by the transform hook and describe so the two surfaces resolve
// identically. Precedence: a live chat.params capture, the explicit
// defaultContextTokens option, then the budget persisted for the session;
// the persisted value fills only the unknown state. The fallback is
// suppressed when the persisted budget carries a model identity and this
// sitting's chat.params events name a different model: the session
// changed models (mid sitting or across a restart), so the old model's
// budget must not refill and eviction stands down instead. A fallback
// without a model identity (option-sourced, or a snapshot predating the
// model key) is never suppressed, matching the tolerant legacy shape.
export const contextLimitForRun = (
  sessionEntry: ContextLimitEntry | undefined,
  persistedBudget: PersistedContextLimit | undefined,
  sittingModelKey: string | undefined,
  resolvedOptions: Pick<ResolvedOptions, "modelContextTokens" | "defaultContextTokens">,
): ContextLimitResolution => {
  const resolved = resolveContextLimit(sessionEntry, resolvedOptions.defaultContextTokens)
  if (resolved.tokens !== null) return { contextLimit: resolved, fallbackSuppressed: false }
  if (persistedBudget === undefined) return { contextLimit: resolved, fallbackSuppressed: false }
  // A budget sourced from config that config no longer carries must not
  // refill: an override survives only while its model key stays in
  // modelContextTokens, a default only while defaultContextTokens is set.
  const configRemoved =
    (persistedBudget.source === CONTEXT_TOKENS_SOURCE_OVERRIDE &&
      (persistedBudget.modelKey === undefined || resolvedOptions.modelContextTokens[persistedBudget.modelKey] === undefined)) ||
    (persistedBudget.source === CONTEXT_TOKENS_SOURCE_DEFAULT && resolvedOptions.defaultContextTokens === undefined)
  if (configRemoved) return { contextLimit: resolved, fallbackSuppressed: true }
  if (persistedBudget.modelKey !== undefined && sittingModelKey !== undefined && persistedBudget.modelKey !== sittingModelKey) {
    return { contextLimit: resolved, fallbackSuppressed: true }
  }
  return {
    contextLimit: { tokens: persistedBudget.tokens, source: persistedBudget.source, modelKey: persistedBudget.modelKey },
    fallbackSuppressed: false,
  }
}
