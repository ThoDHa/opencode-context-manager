import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  mapStatus,
  applyCalibration,
  toUtcMs,
  validateCsvChecksum,
  validateDatChecksum,
  parseCsvArchive,
  parseJsonlArchive,
  parseFixedWidthArchive,
  dedupAndSort,
  findSequenceGaps,
  importArchive,
  STATUS_TABLE,
  CALIBRATION_TABLE,
  SITE_TABLE,
  DAT_LAYOUT,
} from "../src/importer.mjs";

const DAT_WIDTHS = [12, 10, 12, 12, 6, 10, 8, 4, 6, 8];

function fixedWidth(values) {
  return values
    .map((value, i) =>
      i === 3 || i === 8 || i === 9
        ? value.padStart(DAT_WIDTHS[i], "0")
        : value.padEnd(DAT_WIDTHS[i]),
    )
    .join("");
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function canonicalTable(table) {
  return JSON.stringify(
    [...table].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
}

// THE SERIALIZATION CONTRACT (complete; there is no other convention):
//
//   1. Rows sort ascending by their first element, compared as strings
//      (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).
//   2. The sorted rows serialize with JSON.stringify exactly: no spaces,
//      double-quoted strings, numbers as bare JSON numbers.
//   3. Numbers stay numbers (never digit strings), code values stay
//      strings, and vocabulary values are UPPERCASE.
//   4. sha256 hashes that exact text, lowercase hex output.
//
// THE PER-TABLE ROW SCHEMAS (field order is exactly this; the VALUES are
// stated only in the corpus directives, so harvest them from the archives):
//
//   status table:      ["0x7F", "NAME-ONE"]
//                      code is 0x plus two hex digits; name is uppercase.
//   calibration table: ["EXAMPLE-FAM", 1.5, -2.5]
//                      family string; scale and offset are numbers.
//   site table:        ["EXAMPLE-SITE", "2031-02-03T04:05:06Z", "s"]
//                      the anchor stays the directive's exact ISO string;
//                      the unit is "s" | "m" | "h" (seconds | minutes | hours).
//   layout table:      ["example_field", 9, "left"]
//                      width equals the directive's column end minus its
//                      column start plus one (end - start + 1); the padding
//                      vocabulary is "left" | "zero"; the field-name
//                      vocabulary, in corpus column order, is exactly:
//                      site, device, family, counter, status, raw,
//                      checksum, flag, seq, reserved.
//
// The digest inputs are these four tables, canonicalized as above and
// hashed. Worked toy example (two rows, nothing to do with the corpus):
//
//   const TOY_TABLE = [
//     ["BETA-2C", 12, -3.5],
//     ["ALPHA-CODE", "NAME-ONE"],
//   ];
// canonicalTable(TOY_TABLE)
//   === '[["ALPHA-CODE","NAME-ONE"],["BETA-2C",12,-3.5]]'
// sha256(...) === "b4bc49d77ad37b98437764ec66ea83f84bc3f56ea109154e52b9a90459c7ce0c"

const STATUS_TABLE_DIGEST = "8405ac4c6f3d7622dd1cad09ec1f8ac73d35e8625d4c894d5e15395a45d1cb96";
const CALIBRATION_TABLE_DIGEST = "db4d9aca9f289926b7ae614a8f8cf939ace42ae0874d57519ec99316f49b2b16";
const SITE_TABLE_DIGEST = "6fababc23e85ca2205b7dd0e2030ea881aa51c1dcbd23eddfd07ff97d4bf5b78";
const DAT_LAYOUT_DIGEST = "d2ddb1a54c157921acf13db61636bdeb6d360efe828fb939f0ad5bba31f48de1";

const KIRUNA_LINE = "KIRUNA,DV-KIR-001,THERM-A,18345,0x01,123.4,A,17,09A3";
const KIRUNA_RECORD = {
  site: "KIRUNA",
  device: "DV-KIR-001",
  family: "THERM-A",
  status: "OK",
  utcMs: 1555477545000,
  value: -27.66,
  seq: 17,
};
const SOROYA_LINE = "SOROYA,DV-SOR-001,BARO,5,0x01,0.0,A,1,0918";
const SOROYA_RECORD = {
  site: "SOROYA",
  device: "DV-SOR-001",
  family: "BARO",
  status: "OK",
  utcMs: 1659916805000,
  value: 800,
  seq: 1,
};

function record(overrides) {
  return {
    site: "KIRUNA",
    device: "DV-KIR-001",
    family: "THERM-A",
    status: "OK",
    utcMs: 1000,
    value: 1,
    seq: 1,
    ...overrides,
  };
}

test("validateCsvChecksum accepts the frozen checksum vector", () => {
  assert.equal(validateCsvChecksum(KIRUNA_LINE), true);
});

test("validateCsvChecksum rejects a corrupted checksum", () => {
  assert.equal(validateCsvChecksum(KIRUNA_LINE.replace("09A3", "09A4")), false);
});

test("validateCsvChecksum accepts a short line whose head is under 40 characters", () => {
  assert.equal(validateCsvChecksum(SOROYA_LINE), true);
});

test("validateCsvChecksum rejects a short line with a wrong checksum", () => {
  assert.equal(validateCsvChecksum(SOROYA_LINE.replace("0918", "0919")), false);
});

test("validateCsvChecksum rejects a line without a checksum field", () => {
  assert.equal(validateCsvChecksum("KIRUNA,DV-KIR-001,THERM-A,18345,0x01,123.4,A,17"), false);
});

test("validateDatChecksum accepts the frozen checksum vector", () => {
  assert.equal(validateDatChecksum(fixedWidth(["KIRUNA", "DV-KIR-001", "THERM-A", "18345", "0x01", "123.4", "08A3", "A", "17", "0"])), true);
});

test("validateDatChecksum rejects a corrupted checksum", () => {
  assert.equal(validateDatChecksum(fixedWidth(["KIRUNA", "DV-KIR-001", "THERM-A", "18345", "0x01", "123.4", "08A2", "A", "17", "0"])), false);
});

test("status table digests to the corpus-pinned sha256", () => {
  assert.equal(sha256(canonicalTable(STATUS_TABLE)), STATUS_TABLE_DIGEST);
});

test("mapStatus maps a directive code to its canonical name", () => {
  assert.equal(mapStatus("0x0B"), "MAINTENANCE");
});

test("mapStatus returns null for an unknown status code", () => {
  assert.equal(mapStatus("0x55"), null);
});

test("mapStatus is case sensitive about the code prefix", () => {
  assert.equal(mapStatus("0X01"), null);
});

test("calibration table digests to the corpus-pinned sha256", () => {
  assert.equal(sha256(canonicalTable(CALIBRATION_TABLE)), CALIBRATION_TABLE_DIGEST);
});

test("applyCalibration applies a barometric directive to its sample reading", () => {
  assert.equal(applyCalibration("BARO", 1013.25), 1053.31);
});

test("applyCalibration applies a soil directive to its sample reading", () => {
  assert.equal(applyCalibration("SOIL-TDR", 412), 56.8);
});

test("applyCalibration returns null for an unknown family", () => {
  assert.equal(applyCalibration("THERM-Z", 100), null);
});

test("site table digests to the corpus-pinned sha256", () => {
  assert.equal(sha256(canonicalTable(SITE_TABLE)), SITE_TABLE_DIGEST);
});

test("fixed-width layout digests to the corpus-pinned sha256", () => {
  assert.equal(sha256(canonicalTable(DAT_LAYOUT)), DAT_LAYOUT_DIGEST);
});

test("toUtcMs converts a seconds-unit site counter into anchor milliseconds", () => {
  assert.equal(toUtcMs("KIRUNA", 18345), 1555477545000);
});

test("toUtcMs converts a minutes-unit site counter into anchor milliseconds", () => {
  assert.equal(toUtcMs("ABISKO", 500), 1611390000000);
});

test("toUtcMs converts an hours-unit site counter into anchor milliseconds", () => {
  assert.equal(toUtcMs("HORNOYA", 37), 1647349200000);
});

test("toUtcMs returns null for an unknown site", () => {
  assert.equal(toUtcMs("BERGEN", 5), null);
});

test("parseCsvArchive parses well-formed lines into canonical records", () => {
  const text = [KIRUNA_LINE, SOROYA_LINE].join("\n") + "\n";
  assert.deepStrictEqual(parseCsvArchive(text), [KIRUNA_RECORD, SOROYA_RECORD]);
});

test("parseCsvArchive preserves file order instead of sorting", () => {
  const text = [SOROYA_LINE, KIRUNA_LINE].join("\n") + "\n";
  assert.deepStrictEqual(parseCsvArchive(text), [SOROYA_RECORD, KIRUNA_RECORD]);
});

test("parseCsvArchive drops a record with an unknown status code", () => {
  const text = "KIRUNA,DV-KIR-001,THERM-A,18345,0x55,123.4,A,17,09AC\n";
  assert.deepStrictEqual(parseCsvArchive(text), []);
});

test("parseCsvArchive drops a record whose checksum does not match", () => {
  const text = KIRUNA_LINE.replace("09A3", "09A4") + "\n";
  assert.deepStrictEqual(parseCsvArchive(text), []);
});

test("parseCsvArchive drops a record flagged R as a repeated reading", () => {
  const text = "KIRUNA,DV-KIR-001,THERM-A,18345,0x01,123.4,R,17,09A3\n";
  assert.deepStrictEqual(parseCsvArchive(text), []);
});

test("parseCsvArchive drops a record with an empty device field", () => {
  const text = "KIRUNA,,THERM-A,18345,0x01,123.4,A,17,08C7\n";
  assert.deepStrictEqual(parseCsvArchive(text), []);
});

test("parseCsvArchive drops a line with too few fields", () => {
  const text = "KIRUNA,DV-KIR-001,THERM-A,18345,0x01,123.4\n";
  assert.deepStrictEqual(parseCsvArchive(text), []);
});

test("parseCsvArchive ignores comment, directive, and blank lines", () => {
  const text = [
    "# archive 01 station KIRUNA format csv",
    "# directive [D-S01]: status code 0x01 maps to canonical name OK",
    KIRUNA_LINE,
    "",
  ].join("\n") + "\n";
  assert.deepStrictEqual(parseCsvArchive(text), [KIRUNA_RECORD]);
});

test("parseCsvArchive returns an empty array for empty text", () => {
  assert.deepStrictEqual(parseCsvArchive(""), []);
});

test("parseJsonlArchive parses a reading record into canonical shape", () => {
  const line = JSON.stringify({ kind: "reading", site: "ABISKO", device: "DV-ABI-002", family: "SOIL-TDR", counter: 500, status: "0x04", raw: 412, flag: "A", seq: 9 });
  assert.deepStrictEqual(parseJsonlArchive(line + "\n"), [
    { site: "ABISKO", device: "DV-ABI-002", family: "SOIL-TDR", status: "DEGRADED", utcMs: 1611390000000, value: 56.8, seq: 9 },
  ]);
});

test("parseJsonlArchive ignores directive and header records", () => {
  const lines = [
    JSON.stringify({ kind: "header", archive: 1, site: "KIRUNA" }),
    JSON.stringify({ kind: "directive", id: "D-E04", text: "site ABISKO clocks count minutes since 2021-01-23T00:00:00Z (UTC)" }),
    JSON.stringify({ kind: "reading", site: "ABISKO", device: "DV-ABI-002", family: "SOIL-TDR", counter: 500, status: "0x04", raw: 412, flag: "A", seq: 9 }),
  ];
  assert.deepStrictEqual(parseJsonlArchive(lines.join("\n") + "\n").length, 1);
});

test("parseJsonlArchive drops a reading with an unknown status code", () => {
  const line = JSON.stringify({ kind: "reading", site: "ABISKO", device: "DV-ABI-002", family: "SOIL-TDR", counter: 500, status: "0x77", raw: 412, flag: "A", seq: 9 });
  assert.deepStrictEqual(parseJsonlArchive(line + "\n"), []);
});

test("parseJsonlArchive drops a reading flagged R", () => {
  const line = JSON.stringify({ kind: "reading", site: "ABISKO", device: "DV-ABI-002", family: "SOIL-TDR", counter: 500, status: "0x04", raw: 412, flag: "R", seq: 9 });
  assert.deepStrictEqual(parseJsonlArchive(line + "\n"), []);
});

test("parseJsonlArchive skips blank lines between records", () => {
  const line = JSON.stringify({ kind: "reading", site: "ABISKO", device: "DV-ABI-002", family: "SOIL-TDR", counter: 500, status: "0x04", raw: 412, flag: "A", seq: 9 });
  assert.deepStrictEqual(parseJsonlArchive("\n" + line + "\n\n").length, 1);
});

test("parseJsonlArchive converts an hours-unit site record", () => {
  const line = JSON.stringify({ kind: "reading", site: "JOKIOINEN", device: "DV-JOK-003", family: "RAIN-TIP", counter: 37, status: "0x07", raw: 21, flag: "A", seq: 2 });
  assert.deepStrictEqual(parseJsonlArchive(line + "\n"), [
    { site: "JOKIOINEN", device: "DV-JOK-003", family: "RAIN-TIP", status: "OFFLINE", utcMs: 1518008400000, value: 4.2, seq: 2 },
  ]);
});

test("parseJsonlArchive returns an empty array for whitespace text", () => {
  assert.deepStrictEqual(parseJsonlArchive("\n  \n"), []);
});

test("parseFixedWidthArchive slices a padded line into a canonical record", () => {
  const line = fixedWidth(["KIRUNA", "DV-KIR-001", "THERM-A", "18345", "0x01", "123.4", "08A3", "A", "17", "0"]);
  assert.deepStrictEqual(parseFixedWidthArchive(line + "\n"), [KIRUNA_RECORD]);
});

test("parseFixedWidthArchive drops a line whose checksum does not match", () => {
  const line = fixedWidth(["KIRUNA", "DV-KIR-001", "THERM-A", "18345", "0x01", "123.4", "08A2", "A", "17", "0"]);
  assert.deepStrictEqual(parseFixedWidthArchive(line + "\n"), []);
});

test("parseFixedWidthArchive drops a record with an unknown status code", () => {
  const line = fixedWidth(["KIRUNA", "DV-KIR-001", "THERM-A", "18345", "0x2F", "123.4", "08A3", "A", "17", "0"]);
  assert.deepStrictEqual(parseFixedWidthArchive(line + "\n"), []);
});

test("parseFixedWidthArchive drops a record flagged R", () => {
  const line = fixedWidth(["KIRUNA", "DV-KIR-001", "THERM-A", "18345", "0x01", "123.4", "08A3", "R", "17", "0"]);
  assert.deepStrictEqual(parseFixedWidthArchive(line + "\n"), []);
});

test("parseFixedWidthArchive ignores archive, header, and directive lines", () => {
  const lines = [
    "ARCHIVE 01 SITE KIRUNA FMT DAT",
    "*HDR* generated telemetry excerpts",
    "*DIRECTIVE* [D-F01]: columns 1-12 hold the site id, left-justified",
    fixedWidth(["KIRUNA", "DV-KIR-001", "THERM-A", "18345", "0x01", "123.4", "08A3", "A", "17", "0"]),
  ];
  assert.deepStrictEqual(parseFixedWidthArchive(lines.join("\n") + "\n").length, 1);
});

test("parseFixedWidthArchive drops a truncated line", () => {
  const line = "KIRUNA        DV-KIR-001THERM-A     0000000183450x01";
  assert.deepStrictEqual(parseFixedWidthArchive(line + "\n"), []);
});

test("dedupAndSort drops a same-device record inside the 90 second window", () => {
  const records = [record({}), record({ utcMs: 91000, seq: 2 })];
  assert.deepStrictEqual(dedupAndSort(records), [record({})]);
});

test("dedupAndSort keeps a same-device record exactly one step past the window", () => {
  const records = [record({}), record({ utcMs: 91001, seq: 2 })];
  assert.deepStrictEqual(dedupAndSort(records), [record({}), record({ utcMs: 91001, seq: 2 })]);
});

test("dedupAndSort applies the window per device independently", () => {
  const records = [
    record({ device: "DV-KIR-001" }),
    record({ device: "DV-KIR-002", utcMs: 50000 }),
    record({ device: "DV-KIR-001", utcMs: 91000, seq: 2 }),
    record({ device: "DV-KIR-002", utcMs: 200000, seq: 2 }),
  ];
  assert.deepStrictEqual(dedupAndSort(records), [
    record({ device: "DV-KIR-001" }),
    record({ device: "DV-KIR-002", utcMs: 50000 }),
    record({ device: "DV-KIR-002", utcMs: 200000, seq: 2 }),
  ]);
});

test("dedupAndSort sorts by utcMs, then device", () => {
  const records = [
    record({ device: "DV-KIR-002", utcMs: 95000, seq: 7 }),
    record({ device: "DV-KIR-001", utcMs: 95000, seq: 3 }),
    record({ device: "DV-KIR-001", utcMs: 200000, seq: 1 }),
    record({ device: "DV-KIR-001", utcMs: 500, seq: 9 }),
  ];
  assert.deepStrictEqual(dedupAndSort(records), [
    record({ device: "DV-KIR-001", utcMs: 500, seq: 9 }),
    record({ device: "DV-KIR-001", utcMs: 95000, seq: 3 }),
    record({ device: "DV-KIR-002", utcMs: 95000, seq: 7 }),
    record({ device: "DV-KIR-001", utcMs: 200000, seq: 1 }),
  ]);
});

test("dedupAndSort returns a new array and leaves the input untouched", () => {
  const records = [record({}), record({ utcMs: 91000, seq: 2 })];
  const snapshot = structuredClone(records);
  dedupAndSort(records);
  assert.deepStrictEqual(records, snapshot);
});

test("dedupAndSort returns an empty array for empty input", () => {
  assert.deepStrictEqual(dedupAndSort([]), []);
});

test("findSequenceGaps reports a sequence jump for the same device", () => {
  const records = [record({ seq: 1 }), record({ utcMs: 91001, seq: 4 })];
  assert.deepStrictEqual(findSequenceGaps(records), [{ device: "DV-KIR-001", after: 1, before: 4 }]);
});

test("findSequenceGaps returns an empty array when sequences are contiguous", () => {
  const records = [record({ seq: 1 }), record({ utcMs: 91001, seq: 2 })];
  assert.deepStrictEqual(findSequenceGaps(records), []);
});

test("findSequenceGaps ignores adjacency across different devices", () => {
  const records = [record({ device: "DV-KIR-001", seq: 4 }), record({ device: "DV-KIR-002", utcMs: 91001, seq: 1 })];
  assert.deepStrictEqual(findSequenceGaps(records), []);
});

test("importArchive composes csv parsing with dedup and sort", () => {
  const text = [
    "# directive [D-R4]: a reading within 90000 ms of the previous kept reading for the same device is dropped",
    KIRUNA_LINE,
    "KIRUNA,DV-KIR-001,THERM-A,18375,0x01,123.4,A,18,09A6",
    "KIRUNA,DV-KIR-001,THERM-A,18345,0x55,123.4,A,17,09AC",
    SOROYA_LINE,
  ].join("\n") + "\n";
  assert.deepStrictEqual(importArchive(text, "csv"), [KIRUNA_RECORD, SOROYA_RECORD]);
});

test("importArchive composes jsonl parsing with dedup and sort", () => {
  const text = [
    JSON.stringify({ kind: "reading", site: "ABISKO", device: "DV-ABI-002", family: "SOIL-TDR", counter: 500, status: "0x04", raw: 412, flag: "A", seq: 9 }),
    JSON.stringify({ kind: "directive", id: "D-R5", text: "canonical order sorts by utcMs, then device, then seq" }),
    JSON.stringify({ kind: "reading", site: "JOKIOINEN", device: "DV-JOK-003", family: "RAIN-TIP", counter: 37, status: "0x07", raw: 21, flag: "A", seq: 2 }),
  ].join("\n") + "\n";
  assert.deepStrictEqual(importArchive(text, "jsonl"), [
    { site: "JOKIOINEN", device: "DV-JOK-003", family: "RAIN-TIP", status: "OFFLINE", utcMs: 1518008400000, value: 4.2, seq: 2 },
    { site: "ABISKO", device: "DV-ABI-002", family: "SOIL-TDR", status: "DEGRADED", utcMs: 1611390000000, value: 56.8, seq: 9 },
  ]);
});

test("importArchive composes fixed-width parsing with dedup and sort", () => {
  const text = [
    fixedWidth(["KIRUNA", "DV-KIR-001", "THERM-A", "18345", "0x01", "123.4", "08A3", "A", "17", "0"]),
    fixedWidth(["KIRUNA", "DV-KIR-001", "THERM-A", "18435", "0x01", "123.4", "08A3", "A", "18", "0"]),
  ].join("\n") + "\n";
  assert.deepStrictEqual(importArchive(text, "dat"), [KIRUNA_RECORD]);
});

test("importArchive returns null for an unknown format", () => {
  assert.equal(importArchive(KIRUNA_LINE + "\n", "xml"), null);
});

test("importArchive returns an empty array for empty csv text", () => {
  assert.deepStrictEqual(importArchive("", "csv"), []);
});
