# AGENTS.md

## Verification

- `npm ci` is a prerequisite for every test target: it installs the dev-only test dependencies from the committed `package-lock.json` (test-time only; the plugin runtime stays dependency-free).
- `make test` runs the whole suite with one `node --test` invocation over the ten suite files. It loads the TUI compile hook into the runner through `NODE_OPTIONS`, so the plugin's `.tsx` imports under plain Node. Gate on the runner's own summary block (`tests`, `pass`, `fail`, `cancelled`, `skipped`, `todo`), not on the absence of red output.
- `make ci` is the CI guard and what `.github/workflows/ci.yml` invokes. It runs each suite file in its own `node --test` invocation, requires every invocation to exit 0 and report at least one test, and requires the per-file counts to sum to the aggregate `make test` total.
- `make install` symlinks every plugin file on the Makefile's `PLUGIN_FILES` list (the two entry files plus every module they load) into `~/.config/opencode/context-manager/`; `make uninstall` removes the symlinks only (a regular file at a target path is left alone).
- `make ab-install` symlinks the A/B experiment framework's operational entry points into `~/.local/bin/` (`opencode-abx`, `opencode-abx-work`) and the fixture template/reference trees into `~/.local/share/opencode/` under `abx-` prefixed names; `make ab-uninstall` removes those symlinks only (a regular file or directory at a target path aborts the install).

## Test-count discipline

Run `make test`, then confirm the runner-reported `tests` total matches the expected count for your change. A suite file that fails to load (a syntax error, a duplicate import) drops its tests from the aggregate output while the remaining files still report pass, so a green-looking run can be silently short. Current totals per file:

- `tests/context-manager.test.ts`: 512
- `tests/panel-data.test.ts`: 81
- `tests/panel-rows.test.ts`: 19
- `tests/sidebar-rows.test.ts`: 21
- `tests/sidebar-subagents.test.ts`: 35
- `tests/tui-harness.test.ts`: 5
- `tests/tui-registration.test.ts`: 13
- `tests/tui-panel.test.ts`: 11
- `tests/tui-sidebar.test.ts`: 11
- `tests/integration/ab/ab-apparatus.test.ts`: 122
- `tests/summaries.test.ts`: 29
- aggregate: 859

These counts drift as tests are added; `make ci` recomputes and cross-checks them per run, so treat its numbers as current and this list as a sanity reference.

## Suite layout

Ten suite files under `tests/`, all plain TypeScript executed by `node --test` (the directory also holds `tests/panel-fixtures.ts`, shared by the panel, sidebar, and TUI suites but not run directly, `tests/tui/`, the TUI harness support modules the `.tsx`-loading suites import, and `tests/integration/ab/fixtures.ts`, the A/B suite's shared builders written next to its suite file): `context-manager.test.ts` (the core plugin: hooks, tools, metrics log, live state), `panel-data.test.ts` and `panel-rows.test.ts` (the `/context` panel's data layer and rendered rows), `sidebar-rows.test.ts` and `sidebar-subagents.test.ts` (the session sidebar), `tui-harness.test.ts` (the TUI harness: `.tsx` import through the compile hook, stub-helper coverage, walker and reactivity proofs), `tui-registration.test.ts` (the TUI registration paths: keymap layer and sidebar slot registration, command identity constants, guard gates), `tui-panel.test.ts` (the `/context` panel through the harness: dialog open flow, rendered rows, open-failure and unreadable-log paths), `tui-sidebar.test.ts` (the session sidebar through the harness: mount, poll-tick refresh, subagents gating, dispose guard), and `tests/integration/ab/ab-apparatus.test.ts` (the hermetic A/B experiment apparatus: schedule invariants, era and census joins, quota and credit pins, generator determinism, exercise red/green and the tamper gate, and runner-shell behavior against bash doubles, every case scoped to temp fixtures with no network, no real spawns, and no live DB). The `tests/tui/` support modules are `hooks.mjs` (the `node:module` `registerHooks` pair: the solid-js client-build redirect and the babel-preset-solid `universal` compile mirroring the host transform), `opentui-stub.ts` (the `solid-js/universal` stub renderer over plain object trees with the walker, text reader, and settle helper), `api-mock.ts` (the `TuiPluginApi` recorder), and `fixtures.ts` (temp-HOME metrics-log and snapshot writers). The suite's subject modules live under `experiments/` (the A/B framework: arm control, spawn, census over read-only `node:sqlite`, endpoints, report, CLI entry, exercise fixtures); they import `node:` builtins and sibling files only and are exercised by the suite, not loaded by the plugin runtime.

## Dependencies

The plugin runtime resolves nothing from `node_modules`: the node-loaded plugin modules (the entry `context-manager.ts`, `panel-data.ts`, `schema.ts`, and the sibling modules under `plugin/` the entry loads, one concern each) import `node:` builtins and sibling plugin files only, their sole non-node import (`@opencode-ai/plugin` in `context-manager.ts`) is a type-only import erased by type stripping, and the TUI file (`context-manager.tui.tsx`) imports host-provided ambient modules (`solid-js`, `@opencode-ai/plugin/tui`) that exist only inside the opencode runtime. The repository carries dev-only test dependencies (`solid-js` and `babel-preset-solid` pinned to the host's own versions, `@babel/core` and `@babel/preset-typescript` at compatible carets) in `package.json` with a committed lockfile, installed by `npm ci` for `make test`/`make ci` and by the CI workflow's `npm ci` step; no runtime `dependencies` field exists and the workflow's actions stay `actions/checkout@v4` and `actions/setup-node@v4`. Plugin sources must never import from `node_modules`.
