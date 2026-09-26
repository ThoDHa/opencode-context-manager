# AGENTS.md

## Verification

- `make test` runs the whole suite with one `node --test` invocation over the five suite files. Gate on the runner's own summary block (`tests`, `pass`, `fail`, `cancelled`, `skipped`, `todo`), not on the absence of red output.
- `make ci` is the CI guard and what `.github/workflows/ci.yml` invokes. It runs each suite file in its own `node --test` invocation, requires every invocation to exit 0 and report at least one test, and requires the per-file counts to sum to the aggregate `make test` total.
- `make install` symlinks the four plugin files into `~/.config/opencode/plugin/`; `make uninstall` removes the symlinks only (a regular file at a target path is left alone).

## Test-count discipline

Run `make test`, then confirm the runner-reported `tests` total matches the expected count for your change. A suite file that fails to load (a syntax error, a duplicate import) drops its tests from the aggregate output while the remaining files still report pass, so a green-looking run can be silently short. Current totals per file:

- `tests/lru-context.test.ts`: 295
- `tests/lru-panel-data.test.ts`: 55
- `tests/lru-panel-rows.test.ts`: 7
- `tests/lru-sidebar-rows.test.ts`: 14
- `tests/lru-sidebar-subagents.test.ts`: 26
- aggregate: 397

These counts drift as tests are added; `make ci` recomputes and cross-checks them per run, so treat its numbers as current and this list as a sanity reference.

## Suite layout

Five suite files under `tests/`, all plain TypeScript executed by `node --test` (the directory also holds `tests/lru-panel-fixtures.ts`, shared by the panel suites but not run directly): `lru-context.test.ts` (the core plugin: hooks, tools, metrics log, live state), `lru-panel-data.test.ts` and `lru-panel-rows.test.ts` (the `/lru` panel's data layer and rendered rows), `lru-sidebar-rows.test.ts` and `lru-sidebar-subagents.test.ts` (the session sidebar).

## Zero dependencies

The repository has no `package.json` and installs nothing. Plugin and test sources are plain `.ts` executed through Node.js native type stripping (`node --test` on Node 24). External imports in the test sources and the three node-loaded plugin modules (`lru-context.ts`, `lru-panel-data.ts`, `lru-schema.ts`) resolve to `node:` builtins and sibling plugin files only at runtime; their sole non-node import, `@opencode-ai/plugin` written as a type-only import in `lru-context.ts`, is erased by type stripping. The TUI file (`lru-context.tui.tsx`) additionally imports host-provided ambient modules (`solid-js`, `@opencode-ai/plugin/tui`) that exist only inside the opencode runtime and are never installed. Do not add npm steps, a lockfile, or third-party actions beyond `actions/checkout@v4` and `actions/setup-node@v4` in the workflow.
