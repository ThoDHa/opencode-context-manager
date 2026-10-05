# ab-work-deep

Implement `src/importer.mjs` so the test suite passes.

- The domain: a multi-format telemetry archive importer. Each file under
  `data/` is one station archive in one of three formats (`csv`, `jsonl`,
  `dat` fixed-width). The archives hold the raw readings your importer must
  understand.
- FIRST, before reading any test: collect the processing rules. They are NOT
  collected in one place and are NOT stated in the tests. They are stated as
  directive records embedded in the archives, scattered across the whole
  corpus: status-code mappings, per-family calibrations, per-site epoch
  anchors, the fixed-width field layout, and the validation rules. No single
  archive suffices; several rules are stated only once in the entire corpus.
- Search the corpus for `directive` (case-insensitively), read every hit
  together with its surrounding records, and reconcile the complete rule set
  across archives into your own tables before writing any code. The suite
  checks your reconciled tables against digests of the corpus-stated rules,
  so the corpus is the only rule source.
- Only then read `tests/importer.test.mjs`: it is the verification suite, not
  the spec. It pins checksums of the reconciled tables and a handful of
  sample conversions; it does not enumerate the rules. Its header states the
  complete serialization contract for those checksums, including every
  table's row schema; read that header before reconciling so the conventions
  cost you nothing. Transcribing the suite cannot substitute for the harvest.
- `src/importer.mjs` currently contains stubs that throw; replace them with
  real implementations.
- Do not modify anything under `tests/`; `tests/importer.test.mjs`,
  `README.md`, `package.json`, and `.opencode/opencode.json` are frozen spec
  files and verification fails if any of them drifts from the frozen copy.
- Zero dependencies: use Node built-ins only.
- Run the suite with `npm test` (or `node --test tests/*.test.mjs`).
- Work until the suite is fully green, then summarize what you built,
  including the reconciled directive table.
