export const STATUS_TABLE = [
  ["0x01", "OK"],
  ["0x04", "DEGRADED"],
  ["0x07", "OFFLINE"],
  ["0x0B", "MAINTENANCE"],
  ["0x0E", "CALIBRATING"],
  ["0x12", "FAULT-POWER"],
  ["0x16", "FAULT-SENSOR"],
  ["0x19", "FAULT-LINK"],
  ["0x1D", "STALE"],
  ["0x23", "TEST-MODE"],
  ["0x28", "LOW-BATTERY"],
  ["0x2C", "OVERTEMP"],
  ["0x31", "HUMIDITY-ALARM"],
  ["0x35", "VIBRATION-ALARM"],
  ["0x3A", "SIGNAL-LOST"],
  ["0x3E", "REBOOTING"],
  ["0x41", "THROTTLED"],
  ["0x47", "UNRELIABLE"],
];

export const CALIBRATION_TABLE = [
  ["THERM-A", 0.1, -40],
  ["THERM-B", 0.1, -27.5],
  ["HUMID-CAP", 0.05, 0],
  ["BARO", 0.25, 800],
  ["WIND-CUP", 0.5, 0],
  ["PYRANOM", 1.2, 0],
  ["CO2-NDIR", 0.8, 400],
  ["NOX-CELL", 0.02, 0],
  ["PM-LASER", 0.35, 0],
  ["SOIL-TDR", 0.15, -5],
  ["RAIN-TIP", 0.2, 0],
  ["MAG-FLUX", 0.03, 12.5],
];

export const SITE_TABLE = [
  ["KIRUNA", "2019-04-17T00:00:00Z", "s"],
  ["NY-ALESUND", "2020-11-02T00:00:00Z", "s"],
  ["SODANKYLA", "2018-06-09T00:00:00Z", "s"],
  ["ABISKO", "2021-01-23T00:00:00Z", "m"],
  ["ANDENES", "2019-09-30T00:00:00Z", "s"],
  ["HORNOYA", "2022-03-14T00:00:00Z", "h"],
  ["PALLAS", "2020-05-25T00:00:00Z", "s"],
  ["KEVO", "2017-10-11T00:00:00Z", "m"],
  ["TROMSO", "2019-12-01T00:00:00Z", "s"],
  ["OULU", "2021-07-19T00:00:00Z", "s"],
  ["JOKIOINEN", "2018-02-06T00:00:00Z", "h"],
  ["SOROYA", "2022-08-08T00:00:00Z", "s"],
];

export const DAT_LAYOUT = [
  ["site", 12, "left"],
  ["device", 10, "left"],
  ["family", 12, "left"],
  ["counter", 12, "zero"],
  ["status", 6, "left"],
  ["raw", 10, "zero"],
  ["checksum", 8, "left"],
  ["flag", 4, "left"],
  ["seq", 6, "zero"],
  ["reserved", 8, "zero"],
];

const UNIT_MS = { s: 1000, m: 60000, h: 3600000 };

const STATUS_CODES = new Map(STATUS_TABLE);
const CALIBRATIONS = new Map(CALIBRATION_TABLE.map(([family, scale, offset]) => [family, { scale, offset }]));
const SITE_CLOCKS = new Map(
  SITE_TABLE.map(([site, anchor, unit]) => [site, { anchorMs: Date.parse(anchor), unitMs: UNIT_MS[unit] }]),
);
const DAT_OFFSETS = new Map();
let datCursor = 0;
for (const [field, width] of DAT_LAYOUT) {
  DAT_OFFSETS.set(field, [datCursor, width]);
  datCursor += width;
}
const DAT_LINE_LENGTH = datCursor;

const DEDUP_WINDOW_MS = 90000;

const DAT_MIN_LENGTH = DAT_LINE_LENGTH - DAT_LAYOUT[DAT_LAYOUT.length - 1][1] + 1;

function datSlice(line, field) {
  const [start, width] = DAT_OFFSETS.get(field);
  return line.slice(start, start + width);
}

function checksum40(text) {
  let sum = 0;
  const head = text.slice(0, 40);
  for (let i = 0; i < head.length; i++) sum += head.charCodeAt(i);
  return sum.toString(16).toUpperCase().padStart(4, "0");
}

function calibratedValue(family, raw) {
  const calibration = CALIBRATIONS.get(family);
  if (!calibration) return null;
  return Math.round((raw * calibration.scale + calibration.offset) * 100) / 100;
}

function canonicalRecord({ site, device, family, status, utcMs, value, seq }) {
  return { site, device, family, status, utcMs, value, seq };
}

export function mapStatus(code) {
  return STATUS_CODES.get(code) ?? null;
}

export function applyCalibration(family, raw) {
  return calibratedValue(family, raw);
}

export function toUtcMs(site, counter) {
  const clock = SITE_CLOCKS.get(site);
  if (!clock) return null;
  return clock.anchorMs + counter * clock.unitMs;
}

export function validateCsvChecksum(line) {
  const fields = line.split(",");
  if (fields.length < 9) return false;
  const claimed = fields[fields.length - 1].trim();
  if (!/^[0-9A-Fa-f]{4}$/.test(claimed)) return false;
  const head = fields.slice(0, fields.length - 1).join(",") + ",";
  return checksum40(head) === claimed.toUpperCase();
}

export function validateDatChecksum(line) {
  const claimed = datSlice(line, "checksum").trim();
  if (!/^[0-9A-Fa-f]{4}$/.test(claimed)) return false;
  return checksum40(line) === claimed.toUpperCase();
}

export function parseCsvArchive(text) {
  const records = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(",");
    if (fields.length < 9) continue;
    const [site, device, family, counter, status, raw, flag, seq, claimed] = fields;
    const head = `${site},${device},${family},${counter},${status},${raw},${flag},${seq},`;
    if (checksum40(head) !== claimed.trim().toUpperCase()) continue;
    const statusName = mapStatus(status.trim());
    if (statusName === null) continue;
    if (flag.trim() === "R") continue;
    if (!site.trim() || !device.trim()) continue;
    const value = calibratedValue(family, Number(raw));
    if (value === null) continue;
    const utcMs = toUtcMs(site, Number(counter));
    if (utcMs === null) continue;
    records.push(
      canonicalRecord({
        site,
        device,
        family,
        status: statusName,
        utcMs,
        value,
        seq: Number(seq),
      }),
    );
  }
  return records;
}

export function parseJsonlArchive(text) {
  const records = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.kind !== "reading") continue;
    if (entry.flag === "R") continue;
    if (!String(entry.site ?? "").trim() || !String(entry.device ?? "").trim()) continue;
    const statusName = mapStatus(entry.status);
    if (statusName === null) continue;
    const value = calibratedValue(entry.family, entry.raw);
    if (value === null) continue;
    const utcMs = toUtcMs(entry.site, entry.counter);
    if (utcMs === null) continue;
    records.push(
      canonicalRecord({
        site: entry.site,
        device: entry.device,
        family: entry.family,
        status: statusName,
        utcMs,
        value,
        seq: entry.seq,
      }),
    );
  }
  return records;
}

export function parseFixedWidthArchive(text) {
  const records = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (
      line.startsWith("ARCHIVE") ||
      line.startsWith("*HDR*") ||
      line.startsWith("*DIRECTIVE*")
    ) {
      continue;
    }
    if (line.length < DAT_MIN_LENGTH) continue;
    const claimed = datSlice(line, "checksum").trim();
    if (checksum40(line.slice(0, DAT_OFFSETS.get("checksum")[0]) + claimed) !== claimed.toUpperCase()) continue;
    const statusName = mapStatus(datSlice(line, "status").trim());
    if (statusName === null) continue;
    if (datSlice(line, "flag").trim() === "R") continue;
    const site = datSlice(line, "site").trim();
    const device = datSlice(line, "device").trim();
    if (!site || !device) continue;
    const family = datSlice(line, "family").trim();
    const raw = Number(datSlice(line, "raw").trim());
    const value = calibratedValue(family, raw);
    if (value === null) continue;
    const counter = Number(datSlice(line, "counter").trim());
    const utcMs = toUtcMs(site, counter);
    if (utcMs === null) continue;
    records.push(
      canonicalRecord({
        site,
        device,
        family,
        status: statusName,
        utcMs,
        value,
        seq: Number(datSlice(line, "seq")),
      }),
    );
  }
  return records;
}

export function dedupAndSort(records) {
  const sorted = [...records].sort(
    (a, b) => a.utcMs - b.utcMs || a.device.localeCompare(b.device) || a.seq - b.seq,
  );
  const kept = [];
  const lastKeptMs = new Map();
  for (const recordEntry of sorted) {
    const previous = lastKeptMs.get(recordEntry.device);
    if (previous !== undefined && recordEntry.utcMs - previous <= DEDUP_WINDOW_MS) {
      continue;
    }
    lastKeptMs.set(recordEntry.device, recordEntry.utcMs);
    kept.push(recordEntry);
  }
  return kept;
}

export function findSequenceGaps(records) {
  const gaps = [];
  for (let i = 1; i < records.length; i++) {
    const previous = records[i - 1];
    const current = records[i];
    if (previous.device === current.device && current.seq - previous.seq > 1) {
      gaps.push({ device: current.device, after: previous.seq, before: current.seq });
    }
  }
  return gaps;
}

export function importArchive(text, format) {
  let records;
  if (format === "csv") {
    records = parseCsvArchive(text);
  } else if (format === "jsonl") {
    records = parseJsonlArchive(text);
  } else if (format === "dat") {
    records = parseFixedWidthArchive(text);
  } else {
    return null;
  }
  return dedupAndSort(records);
}
