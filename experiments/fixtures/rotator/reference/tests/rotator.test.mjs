import test from "node:test";
import assert from "node:assert/strict";

import { appendLine, rotatePastCap, parseLog, validateEntry } from "../src/rotator.mjs";

const sizeOf = (entry) => JSON.stringify(entry).length;
const bytesOf = (entries) => entries.reduce((total, entry) => total + sizeOf(entry), 0);

test("validateEntry accepts a well-formed entry and drops unknown fields", () => {
  const entry = { ts: 1000, key: "session-a", tokens: 5, extra: "noise" };
  assert.deepStrictEqual(validateEntry(entry), { ts: 1000, key: "session-a", tokens: 5 });
});

test("validateEntry defaults a missing tokens field to 0", () => {
  assert.deepStrictEqual(validateEntry({ ts: 1000, key: "session-a" }), {
    ts: 1000,
    key: "session-a",
    tokens: 0,
  });
});

test("validateEntry replaces a non-numeric tokens field with 0", () => {
  assert.deepStrictEqual(validateEntry({ ts: 1000, key: "session-a", tokens: "7" }), {
    ts: 1000,
    key: "session-a",
    tokens: 0,
  });
});

test("validateEntry rejects a non-numeric ts", () => {
  assert.strictEqual(validateEntry({ ts: "1000", key: "session-a" }), null);
});

test("validateEntry rejects NaN ts", () => {
  assert.strictEqual(validateEntry({ ts: NaN, key: "session-a" }), null);
});

test("validateEntry rejects a non-string key", () => {
  assert.strictEqual(validateEntry({ ts: 1000, key: 7 }), null);
});

test("validateEntry rejects an empty key", () => {
  assert.strictEqual(validateEntry({ ts: 1000, key: "" }), null);
});

test("appendLine appends an entry when no same-key entry exists", () => {
  const lines = [{ ts: 0, key: "a", tokens: 1 }];
  const result = appendLine(lines, { ts: 5, key: "b", tokens: 2 }, { coalesceMs: 10 });
  assert.deepStrictEqual(result, [
    { ts: 0, key: "a", tokens: 1 },
    { ts: 5, key: "b", tokens: 2 },
  ]);
});

test("appendLine merges into the most recent same-key entry within the coalesce window", () => {
  const lines = [{ ts: 0, key: "a", tokens: 1 }];
  const result = appendLine(lines, { ts: 5, key: "a", tokens: 2 }, { coalesceMs: 10 });
  assert.deepStrictEqual(result, [{ ts: 5, key: "a", tokens: 3 }]);
});

test("appendLine merges when the gap equals the coalesce window exactly", () => {
  const lines = [{ ts: 0, key: "a", tokens: 1 }];
  const result = appendLine(lines, { ts: 10, key: "a", tokens: 2 }, { coalesceMs: 10 });
  assert.deepStrictEqual(result, [{ ts: 10, key: "a", tokens: 3 }]);
});

test("appendLine appends instead of merging when the gap exceeds the coalesce window", () => {
  const lines = [{ ts: 0, key: "a", tokens: 1 }];
  const result = appendLine(lines, { ts: 11, key: "a", tokens: 2 }, { coalesceMs: 10 });
  assert.deepStrictEqual(result, [
    { ts: 0, key: "a", tokens: 1 },
    { ts: 11, key: "a", tokens: 2 },
  ]);
});

test("appendLine merges with the most recent same-key entry when keys interleave", () => {
  const lines = [
    { ts: 0, key: "a", tokens: 1 },
    { ts: 1, key: "b", tokens: 2 },
  ];
  const result = appendLine(lines, { ts: 5, key: "a", tokens: 4 }, { coalesceMs: 10 });
  assert.deepStrictEqual(result, [
    { ts: 5, key: "a", tokens: 5 },
    { ts: 1, key: "b", tokens: 2 },
  ]);
});

test("appendLine coalesces a chain of successive appends by accumulating tokens", () => {
  let lines = [{ ts: 0, key: "a", tokens: 1 }];
  lines = appendLine(lines, { ts: 5, key: "a", tokens: 2 }, { coalesceMs: 10 });
  lines = appendLine(lines, { ts: 9, key: "a", tokens: 4 }, { coalesceMs: 10 });
  assert.deepStrictEqual(lines, [{ ts: 9, key: "a", tokens: 7 }]);
});

test("appendLine coalesces only identical timestamps when coalesceMs is omitted", () => {
  let lines = [{ ts: 5, key: "a", tokens: 1 }];
  lines = appendLine(lines, { ts: 5, key: "a", tokens: 2 });
  lines = appendLine(lines, { ts: 6, key: "a", tokens: 1 });
  assert.deepStrictEqual(lines, [
    { ts: 5, key: "a", tokens: 3 },
    { ts: 6, key: "a", tokens: 1 },
  ]);
});

test("appendLine returns a new array and leaves the input untouched", () => {
  const lines = [{ ts: 0, key: "a", tokens: 1 }];
  const snapshot = structuredClone(lines);
  const result = appendLine(lines, { ts: 5, key: "a", tokens: 2 }, { coalesceMs: 10 });
  assert.notStrictEqual(result, lines);
  assert.deepStrictEqual(lines, snapshot);
});

test("rotatePastCap keeps the whole log when the serialized size lands exactly on the cap", () => {
  const lines = [
    { ts: 1, key: "a", tokens: 1 },
    { ts: 2, key: "bb", tokens: 2 },
    { ts: 3, key: "ccc", tokens: 3 },
  ];
  const result = rotatePastCap(lines, bytesOf(lines), 0);
  assert.deepStrictEqual(result, { kept: lines, rotated: [] });
});

test("rotatePastCap splits newest-first when the log exceeds the cap", () => {
  const lines = [
    { ts: 1, key: "a", tokens: 1 },
    { ts: 2, key: "bb", tokens: 2 },
    { ts: 3, key: "ccc", tokens: 3 },
  ];
  const result = rotatePastCap(lines, bytesOf([lines[1], lines[2]]), 0);
  assert.deepStrictEqual(result, { kept: [lines[1], lines[2]], rotated: [lines[0]] });
});

test("rotatePastCap keeps the keep-floor newest entries when the cap is smaller than one line", () => {
  const lines = [
    { ts: 1, key: "a", tokens: 1 },
    { ts: 2, key: "bb", tokens: 2 },
    { ts: 3, key: "ccc", tokens: 3 },
  ];
  const result = rotatePastCap(lines, 1, 2);
  assert.deepStrictEqual(result, { kept: [lines[1], lines[2]], rotated: [lines[0]] });
});

test("rotatePastCap rotates everything when keep is 0 and the cap is tiny", () => {
  const lines = [
    { ts: 1, key: "a", tokens: 1 },
    { ts: 2, key: "bb", tokens: 2 },
  ];
  const result = rotatePastCap(lines, 1, 0);
  assert.deepStrictEqual(result, { kept: [], rotated: lines });
});

test("rotatePastCap returns two empty halves for an empty log", () => {
  assert.deepStrictEqual(rotatePastCap([], 100, 0), { kept: [], rotated: [] });
});

test("rotatePastCap honors the keep floor when the cap alone would keep only the newest entry", () => {
  const lines = [
    { ts: 1, key: "a", tokens: 1 },
    { ts: 2, key: "bb", tokens: 2 },
    { ts: 3, key: "ccc", tokens: 3 },
  ];
  const result = rotatePastCap(lines, bytesOf([lines[2]]), 2);
  assert.deepStrictEqual(result, { kept: [lines[1], lines[2]], rotated: [lines[0]] });
});

test("parseLog returns an empty array for empty text", () => {
  assert.deepStrictEqual(parseLog(""), []);
});

test("parseLog returns an empty array for whitespace-only text", () => {
  assert.deepStrictEqual(parseLog("\n  \n\t\n"), []);
});

test("parseLog preserves entry order across multiple lines", () => {
  const entries = [
    { ts: 1, key: "a", tokens: 1 },
    { ts: 2, key: "b", tokens: 2 },
    { ts: 3, key: "c", tokens: 3 },
  ];
  const text = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  assert.deepStrictEqual(parseLog(text), entries);
});

test("parseLog skips blank lines between and around entries", () => {
  const first = { ts: 1, key: "a", tokens: 1 };
  const second = { ts: 2, key: "b", tokens: 2 };
  const text = "\n" + JSON.stringify(first) + "\n\n" + JSON.stringify(second) + "\n\n";
  assert.deepStrictEqual(parseLog(text), [first, second]);
});

test("parseLog drops a truncated trailing line and keeps the valid prefix", () => {
  const first = { ts: 1, key: "a", tokens: 1 };
  const text = JSON.stringify(first) + "\n" + '{"ts":2,"key":"b","tok';
  assert.deepStrictEqual(parseLog(text), [first]);
});
