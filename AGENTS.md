# AGENTS.md

## Verification

- `npm ci` is a prerequisite for every test target: it installs the dev-only test dependencies from the committed `package-lock.json` (test-time only; the plugin runtime stays dependency-free).
- `make test` runs the whole suite with one `node --test` invocation over the nine suite files. It loads the TUI compile hook into the runner through `NODE_OPTIONS`, so the plugin's `.tsx` imports under plain Node. Gate on the runner's own summary block (`tests`, `pass`, `fail`, `cancelled`, `skipped`, `todo`), not on the absence of red output.
- `make ci` is the CI guard and what `.github/workflows/ci.yml` invokes. It runs each suite file in its own `node --test` invocation, requires every invocation to exit 0 and report at least one test, and requires the per-file counts to sum to the aggregate `make test` total.
- `make install` symlinks the four plugin files into `~/.config/opencode/context-manager/`; `make uninstall` removes the symlinks only (a regular file at a target path is left alone).

## Test-count discipline

Run `make test`, then confirm the runner-reported `tests` total matches the expected count for your change. A suite file that fails to load (a syntax error, a duplicate import) drops its tests from the aggregate output while the remaining files still report pass, so a green-looking run can be silently short. Current totals per file:

- `tests/context-manager.test.ts`: 387
- `tests/panel-data.test.ts`: 67
- `tests/panel-rows.test.ts`: 13
- `tests/sidebar-rows.test.ts`: 15
- `tests/sidebar-subagents.test.ts`: 34
- `tests/tui-harness.test.ts`: 5
- `tests/tui-registration.test.ts`: 13
- `tests/tui-panel.test.ts`: 9
- `tests/tui-sidebar.test.ts`: 10
- aggregate: 553

These counts drift as tests are added; `make ci` recomputes and cross-checks them per run, so treat its numbers as current and this list as a sanity reference.

## Suite layout

Nine suite files under `tests/`, all plain TypeScript executed by `node --test` (the directory also holds `tests/panel-fixtures.ts`, shared by the panel, sidebar, and TUI suites but not run directly, and `tests/tui/`, the TUI harness support modules the `.tsx`-loading suites import): `context-manager.test.ts` (the core plugin: hooks, tools, metrics log, live state), `panel-data.test.ts` and `panel-rows.test.ts` (the `/context` panel's data layer and rendered rows), `sidebar-rows.test.ts` and `sidebar-subagents.test.ts` (the session sidebar), `tui-harness.test.ts` (the TUI harness: `.tsx` import through the compile hook, stub-helper coverage, walker and reactivity proofs), `tui-registration.test.ts` (the TUI registration paths: keymap layer and sidebar slot registration, command identity constants, guard gates), `tui-panel.test.ts` (the `/context` panel through the harness: dialog open flow, rendered rows, open-failure and unreadable-log paths), and `tui-sidebar.test.ts` (the session sidebar through the harness: mount, poll-tick refresh, subagents gating, dispose guard). The `tests/tui/` support modules are `hooks.mjs` (the `node:module` `registerHooks` pair: the solid-js client-build redirect and the babel-preset-solid `universal` compile mirroring the host transform), `opentui-stub.ts` (the `solid-js/universal` stub renderer over plain object trees with the walker, text reader, and settle helper), `api-mock.ts` (the `TuiPluginApi` recorder), and `fixtures.ts` (temp-HOME metrics-log and snapshot writers).

## Dependencies

The plugin runtime resolves nothing from `node_modules`: the three node-loaded plugin modules (`context-manager.ts`, `panel-data.ts`, `schema.ts`) import `node:` builtins and sibling plugin files only, their sole non-node import (`@opencode-ai/plugin` in `context-manager.ts`) is a type-only import erased by type stripping, and the TUI file (`context-manager.tui.tsx`) imports host-provided ambient modules (`solid-js`, `@opencode-ai/plugin/tui`) that exist only inside the opencode runtime. The repository carries dev-only test dependencies (`solid-js` and `babel-preset-solid` pinned to the host's own versions, `@babel/core` and `@babel/preset-typescript` at compatible carets) in `package.json` with a committed lockfile, installed by `npm ci` for `make test`/`make ci` and by the CI workflow's `npm ci` step; no runtime `dependencies` field exists and the workflow's actions stay `actions/checkout@v4` and `actions/setup-node@v4`. Plugin sources must never import from `node_modules`.
