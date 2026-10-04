/**
 * An in-memory JSONL metrics-log rotator.
 *
 * Entries are records of the shape produced by {@link validateEntry}:
 * `{ ts: number, key: string, tokens: number }`. The `ts` field is a fixed
 * numeric timestamp supplied by callers, never read from the clock.
 */

/**
 * Validates a candidate log entry against the schema.
 *
 * A valid entry has a finite numeric `ts`, a non-empty string `key`, and an
 * optional numeric `tokens` field defaulting to 0. Unknown fields are
 * dropped; a non-numeric `tokens` field is replaced with 0.
 *
 * @param {unknown} obj the candidate entry
 * @returns {{ ts: number, key: string, tokens: number } | null} a sanitized
 *   entry, or null when `ts` or `key` violate the schema
 */
export function validateEntry(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;
  if (typeof obj.ts !== "number" || !Number.isFinite(obj.ts)) return null;
  if (typeof obj.key !== "string" || obj.key.length === 0) return null;
  const tokens = typeof obj.tokens === "number" ? obj.tokens : 0;
  return { ts: obj.ts, key: obj.key, tokens };
}

/**
 * Appends an entry to the log with interval coalescing.
 *
 * Starting from the end of `lines`, the most recent entry with the same
 * `key` is located. When `entry.ts` is at most `coalesceMs` newer than that
 * entry's `ts`, the two merge in place: the merged entry keeps the newest
 * `ts`, the same `key`, and the summed `tokens`. Otherwise (no same-key
 * entry, or the gap exceeds the window) the entry is appended at the end.
 *
 * @param {Array<{ ts: number, key: string, tokens?: number }>} lines the
 *   existing log, oldest first
 * @param {{ ts: number, key: string, tokens?: number }} entry the entry to
 *   append; invalid entries leave the log unchanged
 * @param {{ coalesceMs?: number }} [opts] the coalescing window in the same
 *   units as `ts`; defaults to 0, so only identical timestamps coalesce
 * @returns {Array<{ ts: number, key: string, tokens: number }>} a new array;
 *   the input is never mutated
 */
export function appendLine(lines, entry, opts = {}) {
  const clean = validateEntry(entry);
  if (!clean) return [...lines];
  const coalesceMs = opts.coalesceMs ?? 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.key !== clean.key) continue;
    if (clean.ts - line.ts <= coalesceMs) {
      const merged = [...lines];
      merged[i] = { ts: clean.ts, key: clean.key, tokens: (line.tokens ?? 0) + clean.tokens };
      return merged;
    }
    break;
  }
  return [...lines, clean];
}

/**
 * Splits the log into a kept prefix and a rotated remainder.
 *
 * Entries are kept newest-first until adding the next-older entry would push
 * the serialized byte count (JSON.stringify per entry, summed) past `cap`.
 * A cap that exactly fits an entry keeps it. The `keep` floor always retains
 * at least that many newest entries regardless of the cap, so a cap smaller
 * than one line still keeps the newest `keep` entries.
 *
 * @param {Array<{ ts: number, key: string, tokens?: number }>} lines the
 *   log, oldest first
 * @param {number} cap the serialized byte budget for the kept log
 * @param {number} [keep] the minimum number of newest entries to keep;
 *   defaults to 0
 * @returns {{ kept: Array<object>, rotated: Array<object> }} the kept
 *   newest entries in chronological order and the rotated remainder
 */
export function rotatePastCap(lines, cap, keep = 0) {
  const keptNewestFirst = [];
  let accumulatedBytes = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const entryBytes = JSON.stringify(lines[i]).length;
    if (keptNewestFirst.length >= keep && accumulatedBytes + entryBytes > cap) break;
    keptNewestFirst.push(lines[i]);
    accumulatedBytes += entryBytes;
  }
  const kept = keptNewestFirst.reverse();
  return { kept, rotated: lines.slice(0, lines.length - kept.length) };
}

/**
 * Parses JSONL log text into entries.
 *
 * Blank lines (whitespace-only) are skipped. A line that fails to parse,
 * such as a truncated trailing write, is dropped. Parsed entries are
 * returned in line order without schema validation.
 *
 * @param {string} text the raw JSONL log content
 * @returns {Array<object>} the parsed entries in line order
 */
export function parseLog(text) {
  const entries = [];
  for (const line of String(text).split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // The parseLog contract drops unparseable lines: a truncated trailing
      // write must not poison the log.
    }
  }
  return entries;
}
