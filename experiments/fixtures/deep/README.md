# Deep exercise fixtures

The deep exercise (LRU-82) as committed fixtures: `template/` is the tree a solve session receives and `reference/` is the passing solution the verify gate checks against. The three shared spec files (`tests/importer.test.mjs`, `README.md`, `package.json`) must stay byte-identical between the two trees, and the apparatus suite proves that on every run.

The corpus is generated, not committed. `template/tools/generate.mjs` rebuilds `template/data/` deterministically from a fixed seed (96 archives across the csv, jsonl, and dat formats), and `corpus-manifest.txt` pins the sha256 of every generated archive. The apparatus suite regenerates the corpus into a temp directory and fails on any manifest drift; to re-check by hand, run `node template/tools/generate.mjs <target>` and compare a sorted `sha256sum` listing of `<target>/data` against `corpus-manifest.txt`. The generator ships comment-neutral because the template is solver-visible, so its maintenance guidance lives here instead.

## Calibration knobs

The knobs are the pre-registered bounded adjustment (task LRU-82-3): DIRECTIVE_COUNT and STATUS_CHAIN_LENGTH move the solver's harvest work, so they are the knobs that move the turn count; RECORD_COUNT ranges and ARCHIVE_COUNT move corpus bytes only. Changing any knob requires the full mechanical follow-through: regenerate `data/`, recompute the four table digests pinned in `tests/importer.test.mjs` (`STATUS_TABLE_DIGEST`, `CALIBRATION_TABLE_DIGEST`, `SITE_TABLE_DIGEST`, `DAT_LAYOUT_DIGEST`) whenever the change alters the directive texts of the pinned tables, refresh the reference tree's spec-file copies, and re-run the proof in both PATH modes (normal PATH and `env -i PATH=/usr/bin:/bin`; repo-side, `make test` and `make ci` cover the generator determinism, manifest byte-identity, and spec-match proofs).

If a knob round ever adds a new table-bearing directive band (a fifth pinned table), the harvest case that mechanically rebuilds the pinned tables from the corpus (proof harness case 9b in the LRU-82 apparatus) must be extended to rebuild and pin that band too, or the new table passes the existing pins unverified.

The eight-needle fence in `template/.opencode/opencode.json` denies read, glob, grep, list, edit, bash, and external-directory access for each of the eight apparatus path patterns (work trees, the reference, the run logs, and the redcheck scratch prefixes among them), so a solve session cannot reach the reference solution, the experiment records, or the proof scratch from inside its own run.
