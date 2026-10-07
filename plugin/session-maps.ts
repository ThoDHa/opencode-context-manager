export const FALLBACK_SESSION_KEY = "no-session"

export const touchMapEntry = <T>(map: Map<string, T>, key: string): T | undefined => {
  const existing = map.get(key)
  if (existing === undefined) return undefined
  map.delete(key)
  map.set(key, existing)
  return existing
}

export const trimMapToBound = <T>(map: Map<string, T>, bound: number): void => {
  while (map.size >= bound) {
    const leastRecentlyActive = map.keys().next()
    if (leastRecentlyActive.done === true) break
    map.delete(leastRecentlyActive.value)
  }
}

export const rememberSessionValue = <T>(map: Map<string, T>, key: string, value: T, bound: number): void => {
  map.delete(key)
  trimMapToBound(map, bound)
  map.set(key, value)
}

// One fault on a subject: the increment refreshes its recency so a hot
// subject survives at the map's bound, and the map is trimmed before the
// write so a brand-new subject never overflows the bound.
export const rememberFaultForSubject = (faultCounts: Map<string, number>, subject: string, bound: number): void => {
  const existing = faultCounts.get(subject)
  rememberSessionValue(faultCounts, subject, (existing ?? 0) + 1, bound)
}

export const sessionIDFromContext = (source: unknown): string | undefined => {
  const sessionID =
    typeof source === "object" && source !== null ? (source as { sessionID?: unknown }).sessionID : undefined
  return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : undefined
}

export const sessionKeyFromContext = (source: unknown): string => sessionIDFromContext(source) ?? FALLBACK_SESSION_KEY
