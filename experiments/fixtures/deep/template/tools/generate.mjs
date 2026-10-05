#!/usr/bin/env node
// Deterministic telemetry-corpus generator for the deep standardized exercise.
// Regenerates the data/ tree of a work tree byte-identically from a fixed
// seed. Usage: node tools/generate.mjs <targetDir>
//
// Calibration knobs: DIRECTIVE_COUNT and STATUS_CHAIN_LENGTH move the
// solver's harvest work, so they are the knobs that move the turn count;
// RECORD_COUNT ranges and ARCHIVE_COUNT move corpus bytes only. Any knob
// change requires regenerating data/ and keeping every other exercise file
// consistent with the new corpus before the exercise is used again.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SEED = 8217492;
const ARCHIVE_COUNT = 96;
const DIRECTIVE_COUNT = 53;
const STATUS_CHAIN_LENGTH = 18;
const LAYOUT_FIELD_COUNT = 4;
const FORMATS = ["csv", "jsonl", "dat"];
const RECORD_COUNT = { csv: [220, 420], jsonl: [100, 190], dat: [150, 280] };
const DEVICE_SLOTS = 6;
const STATUS_UNKNOWN = ["0x55", "0x66", "0x77", "0x88"];

const STATUS_CODES_ALL = [
  "0x01", "0x04", "0x07", "0x0B", "0x0E", "0x12", "0x16", "0x19", "0x1D",
  "0x23", "0x28", "0x2C", "0x31", "0x35", "0x3A", "0x3E", "0x41", "0x47",
];

const STATUS_NAMES_ALL = [
  "OK", "DEGRADED", "OFFLINE", "MAINTENANCE", "CALIBRATING", "FAULT-POWER",
  "FAULT-SENSOR", "FAULT-LINK", "STALE", "TEST-MODE", "LOW-BATTERY",
  "OVERTEMP", "HUMIDITY-ALARM", "VIBRATION-ALARM", "SIGNAL-LOST",
  "REBOOTING", "THROTTLED", "UNRELIABLE",
];

const STATUS = STATUS_CODES_ALL.slice(0, STATUS_CHAIN_LENGTH);
const STATUS_NAMES = STATUS_NAMES_ALL.slice(0, STATUS_CHAIN_LENGTH);

const FAMILIES = [
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

const SITES = [
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

const UNIT_MS = { s: 1000, m: 60000, h: 3600000 };
const UNIT_WORD = { s: "seconds", m: "minutes", h: "hours" };

function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, "0");

function checksum40(text) {
  let sum = 0;
  const head = text.slice(0, 40);
  for (let i = 0; i < head.length; i++) sum += head.charCodeAt(i);
  return hex4(sum);
}

function seg(value, width, pad) {
  return pad === "zero" ? value.padStart(width, "0") : value.padEnd(width);
}

function datLine(site, device, family, counter, status, raw, ck, flag, seq) {
  return (
    seg(site, 12) +
    seg(device, 10) +
    seg(family, 12) +
    seg(String(counter), 12, "zero") +
    seg(status, 6) +
    seg(raw, 10, "zero") +
    seg(ck, 8) +
    seg(flag, 4) +
    seg(String(seq), 6, "zero") +
    seg("0", 8, "zero")
  );
}

function archiveName(archiveNumber) {
  const idx = archiveNumber - 1;
  const site = SITES[idx % SITES.length][0];
  const format = FORMATS[Math.floor(idx / SITES.length) % FORMATS.length];
  return `archive-${String(archiveNumber).padStart(2, "0")}-${site}.${format}`;
}

function buildDirectives() {
  const texts = [];
  for (let j = 0; j < STATUS.length; j++) {
    const nextIdx = (j + 1) % STATUS.length;
    const nextArchive = archiveName(((nextIdx * 37) % ARCHIVE_COUNT) + 1);
    texts.push(
      `status code ${STATUS[j]} maps to canonical name ${STATUS_NAMES[j]}; readings carrying any other status code are discarded; the next band's directive is in ${nextArchive}`,
    );
  }  for (const [family, scale, offset] of FAMILIES) {
    texts.push(
      `family ${family} calibrates as value = round(((raw * ${scale}) + ${offset}) * 100) / 100; unknown families yield no value`,
    );
  }
  for (const [site, anchor, unit] of SITES) {
    texts.push(
      `site ${site} clocks count ${UNIT_WORD[unit]} since ${anchor} (UTC); utcMs = anchor + counter * ${UNIT_MS[unit]}; unknown sites yield no timestamp`,
    );
  }
  texts.push(
    "fixed-width layout: columns 1-12 hold the site id, left-justified",
    "fixed-width layout: columns 13-22 hold the device id, left-justified",
    "fixed-width layout: columns 23-34 hold the family, left-justified; columns 35-46 the zero-padded counter; columns 47-52 the status code; columns 53-62 the zero-padded raw reading",
    "fixed-width layout: columns 63-70 hold the checksum; columns 71-74 the flag; columns 75-80 the zero-padded sequence; columns 81-88 a reserved zero field; the checksum is the uppercase hex of the byte sum of the first 40 characters, mod 65536",
  );
  texts.push(
    "a record with an unknown status code or an unknown family is discarded",
    "a record whose flag is R marks a repeated reading and is discarded",
    "a record with an empty site or an empty device after trimming is malformed and discarded; a fixed-width line shorter than 81 characters is malformed and discarded",
    "canonical order sorts by utcMs, then device, then seq",
    "a reading within 90000 ms of the previous kept reading for the same device is dropped; the window applies per device",
    "a sequence gap is a same-device adjacent pair whose seq difference is greater than 1",
    "csv checksums cover everything from the start of the line through the comma after the sequence number",
  );
  const sEnd = STATUS_CHAIN_LENGTH;
  const cEnd = sEnd + FAMILIES.length;
  const eEnd = cEnd + SITES.length;
  const fEnd = eEnd + LAYOUT_FIELD_COUNT;
  if (texts.length !== DIRECTIVE_COUNT) {
    throw new Error(`directive count drifted: expected ${DIRECTIVE_COUNT}, got ${texts.length}`);
  }
  const bandLetter = (idx) =>
    idx < sEnd ? "S" : idx < cEnd ? "C" : idx < eEnd ? "E" : idx < fEnd ? "F" : "R";
  const bandNumber = (idx) =>
    idx < sEnd
      ? idx + 1
      : idx < cEnd
        ? idx - sEnd + 1
        : idx < eEnd
          ? idx - cEnd + 1
          : idx < fEnd
            ? idx - eEnd + 1
            : idx - fEnd + 1;
  return texts.map((text, idx) => ({
    id: `D-${bandLetter(idx)}${String(bandNumber(idx)).padStart(2, "0")}`,
    archive: ((idx * 37) % ARCHIVE_COUNT) + 1,
    text,
  }));
}

function directiveLine(id, text, format) {
  if (format === "csv") return `# directive [${id}]: ${text}`;
  if (format === "jsonl") return JSON.stringify({ kind: "directive", id, text });
  return `*DIRECTIVE* [${id}]: ${text}`;
}

function generate(targetDir) {
  const prng = mulberry32(SEED);
  const byArchive = new Map();
  for (const directive of buildDirectives()) {
    if (byArchive.has(directive.archive)) {
      throw new Error(`directive collision on archive ${directive.archive}`);
    }
    byArchive.set(directive.archive, directive);
  }
  const dataDir = join(targetDir, "data");
  mkdirSync(dataDir, { recursive: true });

  for (let i = 0; i < ARCHIVE_COUNT; i++) {
    const archiveNumber = i + 1;
    const name = archiveName(archiveNumber);
    const [site, anchor] = SITES[i % SITES.length];
    const format = FORMATS[Math.floor(i / SITES.length) % FORMATS.length];
    const [minCount, maxCount] = RECORD_COUNT[format];
    const count = minCount + Math.floor(prng() * (maxCount - minCount + 1));

    const lines = [];
    if (format === "csv") {
      lines.push(`# archive ${archiveNumber} station ${site} format csv`);
    } else if (format === "jsonl") {
      lines.push(JSON.stringify({ kind: "header", archive: archiveNumber, site }));
    } else {
      lines.push(`ARCHIVE ${String(archiveNumber).padStart(2, "0")} SITE ${site} FMT DAT`);
      lines.push("*HDR* generated telemetry excerpts");
    }

    const directive = byArchive.get(archiveNumber) ?? null;
    const insertAt = lines.length + Math.floor(count * (0.55 + prng() * 0.3));

    let counter = 10000 + i * 37;
    const lastSeq = new Map();
    for (let r = 0; r < count; r++) {
      if (directive && lines.length === insertAt) {
        lines.push(directiveLine(directive.id, directive.text, format));
      }
      const device = `DV-${site.slice(0, 3)}-${String(1 + Math.floor(prng() * DEVICE_SLOTS)).padStart(3, "0")}`;
      const statusRoll = prng();
      const status =
        statusRoll < 0.94
          ? STATUS[Math.floor(prng() * STATUS.length)]
          : STATUS_UNKNOWN[Math.floor(prng() * STATUS_UNKNOWN.length)];
      const rawValue = (prng() * 2500).toFixed(1);
      const flag = prng() < 0.95 ? "A" : "R";
      const seq = (lastSeq.get(device) ?? 0) + 1 + Math.floor(prng() * 3);
      lastSeq.set(device, seq);
      counter += 30 + Math.floor(prng() * 61);
      const family = FAMILIES[Math.floor(prng() * FAMILIES.length)][0];

      if (format === "csv") {
        const head = `${site},${device},${family},${counter},${status},${rawValue},${flag},${seq},`;
        lines.push(head + checksum40(head));
      } else if (format === "jsonl") {
        lines.push(
          JSON.stringify({
            kind: "reading",
            site,
            device,
            family,
            counter,
            status,
            raw: Number(rawValue),
            flag,
            seq,
          }),
        );
      } else {
        const pre =
          seg(site, 12) +
          seg(device, 10) +
          seg(family, 12) +
          seg(String(counter), 12, "zero") +
          seg(status, 6) +
          seg(rawValue, 10, "zero");
        lines.push(
          datLine(site, device, family, counter, status, rawValue, checksum40(pre), flag, seq),
        );
      }
    }
    if (directive && lines.length <= insertAt) {
      lines.push(directiveLine(directive.id, directive.text, format));
    }
    writeFileSync(join(dataDir, name), lines.join("\n") + "\n");
  }
}

const target = process.argv[2];
if (!target) {
  console.error("usage: node tools/generate.mjs <targetDir>");
  process.exit(2);
}
generate(target);
