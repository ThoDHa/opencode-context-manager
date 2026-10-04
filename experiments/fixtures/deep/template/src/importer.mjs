export const STATUS_TABLE = [];

export const CALIBRATION_TABLE = [];

export const SITE_TABLE = [];

export const DAT_LAYOUT = [];

export function mapStatus(code) {
  throw new Error("not implemented");
}

export function applyCalibration(family, raw) {
  throw new Error("not implemented");
}

export function toUtcMs(site, counter) {
  throw new Error("not implemented");
}

export function validateCsvChecksum(line) {
  throw new Error("not implemented");
}

export function validateDatChecksum(line) {
  throw new Error("not implemented");
}

export function parseCsvArchive(text) {
  throw new Error("not implemented");
}

export function parseJsonlArchive(text) {
  throw new Error("not implemented");
}

export function parseFixedWidthArchive(text) {
  throw new Error("not implemented");
}

export function dedupAndSort(records) {
  throw new Error("not implemented");
}

export function findSequenceGaps(records) {
  throw new Error("not implemented");
}

export function importArchive(text, format) {
  throw new Error("not implemented");
}
