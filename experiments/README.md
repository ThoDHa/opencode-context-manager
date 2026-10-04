# experiments

The standardized-experiment framework for the context-manager A/B protocol
(tasks LRU-81 and LRU-82 commissioned it; LRU-83 commits it). One experiment
flips the plugin between arms, runs the same frozen coding exercise in a
fresh spawned solve session per arm, joins the flip/spawn/work/metrics logs
to the opencode DB, and reads out credits-per-turn under the frozen formula
and exclusion classes. From LRU-84 onward this framework drives the
experiments; parameter-sweep arms are exactly the arbitrary-config arm
control in `arms.ts`.

## Modules

- `arms.ts`: the arm set, the frozen plugin config seeds, the park-aware
  flip-log deep-era reader, the mirrored-rotation schedule with its
  full-history validator, and the post-flip config assertion.
- `spawn.ts`: the frozen solve spawn geometry (`opencode run --format json
  -m <model> --title "ab-solve block <n>" --dir <work> <prompt>`), the
  boundary-anchored quota gate with its tail-only scan, session-id
  extraction, and the spawn-log line format.
- `census.ts`: the flip/spawn/work/metrics log joins, both metrics-log
  generations (generation 2 is the presence of `wouldEvictThisRun`), the
  frozen exclusion classes (`calibration`, `incomplete-run`, `spanning`),
  and the read-only `node:sqlite` turn source. This module is the
  framework's single DB-access surface.
- `endpoints.ts`: the credits-per-turn formula (GLM-5.3 at 6.9 input / 1.7
  output / 24 cache-write credits per 10k tokens, flash-family models at
  one third, promotion factor 0.5), depth buckets (shallow below 40 turns,
  mid at 40-79, deep at 80 and above), covariate gates, and the per-arm
  contrast summaries.
- `report.ts`: the readout writer emitting the Report File Template shape.
- `cli.ts`: the operational entry point (`calibrate`, `chain`, `readout`,
  and the default single-block run), deployed as `opencode-abx` by
  `make ab-install`.
- `fixtures/`: both standardized exercises as committed fixtures. Each
  exercise carries `template/` (what the solver receives: stub module,
  frozen spec suite, README, package.json) and `reference/` (the passing
  solution). The rotator exercise (LRU-81) is a 26-test JSONL metrics-log
  rotator; the deep exercise (LRU-82) is a 57-test telemetry importer whose
  processing rules are scattered as directive records across a 96-archive
  corpus that `tools/generate.mjs` regenerates deterministically from a
  fixed seed. The template's `.opencode/opencode.json` carries the
  qhaway/playwright/context7 deny guard into every solve tree.
- `legacy/`: the bash apparatus (`opencode-ab`, `opencode-ab-block`,
  `opencode-ab-work`, `opencode-ab-work-deep`) as the committed reference
  implementation.

## Legacy note

The bash scripts stay operational for LRU-82 (freeze discipline: the running
experiment does not swap its apparatus mid-chain) and remain installed at
`~/.local/bin/`. They are the reference for the TS modules' log contracts.
From LRU-84 onward the framework drives; its first in-vivo act replays the
bash-produced logs through `census.ts` and requires identical labels before
any framework-collected data counts.

## Operational-only surface

The hermetic suite `tests/integration/ab/ab-apparatus.test.ts` proves the
deterministic core: generators, spec red/green, the tamper gate, arm
derivation, census joins, endpoint arithmetic, and the runner shell against
doubles. Everything that spends credits or touches live state stays
operational-only: real `opencode run` spawns, real config flips, live DB
reads, cron wiring, and anything touching the live experiment logs under
`~/.local/share/opencode/`. Calibration proves those in vivo.

## Deploying

`make ab-install` symlinks the operational entry points into the user paths
(the `make install` precedent): `experiments/cli.ts` as
`~/.local/bin/opencode-abx` plus the reset/verify/redcheck tools
`opencode-abx-work-rotator` and `opencode-abx-work-deep`, and the fixture
template/reference trees into `~/.local/share/opencode/` as
`abx-work-rotator-template` and friends. `make ab-uninstall` removes the
symlinks only; a regular file at a target path aborts the install instead of
being overwritten. Re-running `make ab-install` is the drift remedy.
