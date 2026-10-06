# opencode-context-manager

[![CI](https://github.com/ThoDHa/opencode-context-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/ThoDHa/opencode-context-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [opencode](https://opencode.ai) plugin that manages context windows with least-recently-used eviction: it trims the message list opencode is about to send by deduplicating repeated tool outputs and attachments, purging errored inputs, expiring old reasoning, and evicting the least recently used tool outputs above a watermark, replacing what leaves with tombstones the `recall` tool restores verbatim, while a metrics log, a `describe` tool, and a `/context` panel plus session sidebar report every counter live. This README carries installation and the configuration reference; [DESIGN.md](docs/DESIGN.md) is the architecture specification with the mechanisms, the economics, the measurements, and the credit.

## Contents

- [Installation](#installation)
  - [Requirements](#requirements)
  - [Install](#install)
  - [How it runs](#how-it-runs)
  - [Staying updated](#staying-updated)
  - [Upgrading from the plugin directory](#upgrading-from-the-plugin-directory)
  - [Developer install](#developer-install-make-install)
  - [Uninstall](#uninstall)
- [Configuration](#configuration)
  - [Context limit and eviction](#context-limit-and-eviction)
  - [Exemptions and hints](#exemptions-and-hints)
  - [Advanced configuration](#advanced-configuration)
    - [Token estimate factor](#token-estimate-factor)
    - [Memory bounds](#memory-bounds)
    - [Metrics and live state](#metrics-and-live-state)
  - [Full sample configuration](#full-sample-configuration)
- [What this plugin does](#what-this-plugin-does)
- [Eviction policy](#eviction-policy)
- [Honest limits](#honest-limits)
- [Compatibility](#compatibility)
- [Versioning](#versioning)
- [License](#license)

## Installation

The primary install is a clone of this repository registered through two config entries: opencode loads the plugin files straight out of the clone's `plugin/` directory, so an update is a `git pull` and the code the plugin runs is whatever the pull left in the working tree. The two config entries ([Configuration](#configuration) documents both) are the registration; nothing scans the clone, because the clone's directory name is not `plugin` or `plugins`, and that matters: a scanned copy of an entry's file silently wins and drops the entry's options ([Configuration](#configuration) explains the hazard).

### Requirements

- [opencode](https://opencode.ai) 1.18.29 or later, the host application: its sessions run the plugin, its TUI serves the `/context` panel and the session sidebar, and the version floor comes from the plugin entry's shape (the module-object entrypoint it registers through exists from 1.18.29 on), so an older build rejects the plugin at load. The TUI views additionally need a build carrying the slots API: on one without it the views are absent while the core transform and both tools work unchanged.
- git, to clone this repository and to pull later updates into it
- make and node 24 or later, to run the test suite when you want to verify a checkout: `make test` runs all nine suites under `tests/` via `node --test`, and `npm ci` first installs the dev-only test dependencies from the committed lockfile

### Install

Clone the repository into the opencode config dir so the sample entries' relative paths resolve:

```sh
cd ~/.config/opencode
git clone https://github.com/ThoDHa/opencode-context-manager.git
```

Then register the two entries from [Full sample configuration](#full-sample-configuration): the core entry (`./opencode-context-manager/plugin/context-manager.ts` with its options object) in `opencode.json`'s `plugin` array, and the TUI entry (`./opencode-context-manager/plugin/context-manager.tui.tsx` with its options object) in `tui.json`'s `plugin` array. That is the whole install; the plugin runs in the next session opencode opens.

### How it runs

The clone plus the two config entries are the whole deployment: the `opencode.json` tuple runs the core plugin in every opencode session, interactive and subagent alike, and the `tui.json` tuple serves the `/context` panel and the session sidebar. In a session, the surfaces to check are the ones [What this plugin does](#what-this-plugin-does) lists: `describe` reports the live counters, the panel and sidebar surface the same session data, eventful flushes append to `~/.local/share/opencode/context-metrics.jsonl`, and every run with a last-run record rewrites the session's checkpoint under `~/.local/share/opencode/context-state/`; an install updating from the previous `lru-*` names migrates its stored data automatically.

### Staying updated

The registered entries resolve into the clone, so an update is `git pull` in `~/.config/opencode/opencode-context-manager`: the code the plugin runs is whatever the pull leaves in the working tree. `npm ci` refreshes the test dependencies when the lockfile moved, and `make test` re-runs the nine suites against the pulled tree.

### Upgrading from the plugin directory

An install made under a previous layout may have left the four files in `~/.config/opencode/plugin/`, and they must be removed during an upgrade: opencode's scan still reads that directory, and a scanned copy silently wins the dedup against the `opencode.json` tuple and drops its options. Delete the four files there (`context-manager.ts`, `context-manager.tui.tsx`, `panel-data.ts`, `schema.ts`), then install by the clone model above, or run `make install` for the symlink directory, and add the two config entries from [Configuration](#configuration), since nothing loads the plugin from disk placement alone.

### Developer install (make install)

Contributing to the plugin is easier with `make install`: it symlinks the four plugin files into `~/.config/opencode/context-manager/` (deliberately not named `plugin` or `plugins`, so the scan cannot find them), and `make uninstall` reverses it. On this layout the two config entries point at the symlink directory, so the sample entries' path prefixes become `./context-manager/` where the clone-based [sample configuration](#full-sample-configuration) shows `./opencode-context-manager/plugin/`; every other part of the entries, including the options objects, is identical.

### Uninstall

Remove the two config entries (the `opencode.json` tuple and the `tui.json` entry); the plugin stops loading in the next session. Then delete the clone (`rm -rf ~/.config/opencode/opencode-context-manager`) or, on a `make install` layout, run `make uninstall`, which removes the four symlinks and leaves any regular file at a target path untouched. The stored data under `~/.local/share/opencode/` (the metrics, checkpoint, hygiene, and page-store files) is session history, not plugin code; delete it only when you want the counters and reloadable pages gone.

## Configuration

The plugin reads its options from the second argument opencode passes to the plugin's `server` function: a two-element tuple in a config file's `plugin` array names the plugin plus an options object, and the object is delivered verbatim as that second parameter. Delivery has one precondition, and the install layout is built around it: an entry's options reach the plugin only while the entry's file is not scan-discoverable, meaning it does not sit directly inside a directory named `plugin` or `plugins` under an opencode config dir (the global config dir, a project `.opencode/`, or `~/.opencode`), where opencode scans every `.ts` and `.js` file directly inside either name on top of the config lists; when the scan finds the same file the entry names, the optionless scanned copy silently wins and the options are dropped, with no error on either side ([DESIGN.md](docs/DESIGN.md#2-background-and-related-work) verifies this against the host source). With the clone in `~/.config/opencode/opencode-context-manager/` ([Installation](#installation)), the entries below are the options channel: the clone's own name keeps it outside the scan, and each entry's relative path resolves against the config file declaring it.

Options follow a drop-on-invalid discipline: a value failing the validation below is discarded and the documented default applies, so a mistyped option degrades to default behavior instead of blocking a session.

Two options, `cacheAwareDedup` and `cacheAwareHints`, make the always-on passes prefix-friendly, and both rest on one cache model: providers cache a request's processed prefix and serve a cache hit only while a later request byte-matches that prefix from position zero, so every history mutation invalidates the cached prefix from the cut point forward and re-prices everything after the cut at the uncached rate. The options reshape how the always-on passes rewrite bytes (dedup suppression lands on the newer duplicate seat past the cached prefix, the hint seat rewrites only on a genuine membership change) while keeping their management value: duplicates still collapse to one retained copy, the working set still renders in the hint line. Both ship default off, are measured on a standardized exercise series, and stay off pending that measurement program's conclusion; the rows in the tables below document each option's exact semantics.

### Context limit and eviction

| Option | Type | Default | Validation | Effect |
|---|---|---|---|---|
| `watermark` | `number` | `0.5` | above 0 and below 1 | Fraction of the context limit at which eviction starts |
| `watermarkTokens` | `number` | unset | finite and above 0 | Absolute eviction watermark in tokens; wins over `watermark` when both are set |
| `agedReadEvictionMessages` | `number` | unset | integer above 0; anything else falls back to unset | Aged read tier: evicts read-family outputs whose birth position is older than this many messages from the list tail, regardless of the context limit and watermark |
| `recentWindow` | `number` | `4` | number, 0 or more, floored | Messages treated as hot; shielded from eviction, input purge, and fence eviction, and the floor under reasoning retention |
| `reasoningRetentionMessages` | `number` | unset | integer above 0; anything else falls back to unset; a set value below `recentWindow` clamps up to it | Reasoning retention: `reasoning` parts survive until older than this many messages from the list tail, independent of the hot window's other protections; unset keeps expiry at the `recentWindow` boundary |
| `minEvictableBytes` | `number` | `2048` | 0 or more | Output size floor for evictability and for dedup supersede |
| `cacheAwareDedup` | `boolean` | `false` | boolean; anything else falls back to false | Dedup direction: inverts the walk of all three dedup passes (tool-output dedup, file-attachment dedup, range-read collapse) so the older occurrence is the one retained verbatim (the identical occurrence for tool-output and file dedup, the containing read for range-read collapse) and the newer duplicate seat or contained window carries the tombstone, keeping suppression's rewrites out of the provider-cached prefix |
| `defaultContextTokens` | `number` | unset | finite and above 0 | Fallback context limit when no model limit was captured |
| `modelContextTokens` | `Record<string, number>` | `{}` | per-entry finite and above 0 | Per `providerID/modelID` context-limit override |
| `manualMode` | `boolean` | `false` | boolean; anything else falls back to false | Disables context-limit-driven eviction; measurement-only runs |
| `advisoryBand` | `boolean` | `true` | boolean; anything else falls back to true | Advisory pressure band below the effective watermark; `describe`, the `/context` panel, and the session sidebar surface a band preview when the newest run's estimate reaches the band start |
| `advisoryBandRatio` | `number` | `0.85` | finite and above 0, below 1; anything else falls back to 0.85 | Band start as a fraction of the effective watermark |
| `userFenceEviction` | `object` | `{ enabled: false, minBlockLines: 40 }` | `enabled` boolean; `minBlockLines` integer 0 or more | Evicts large fenced code blocks from old user messages |

The two `*Messages` age options point in opposite directions, and reading either backwards misconfigures the other: `agedReadEvictionMessages` evicts read outputs once they are older than the age, while `reasoningRetentionMessages` retains reasoning until it is older than the age.

`reasoningRetentionMessages` gives reasoning expiry a boundary of its own: set, it widens how long `reasoning` parts survive past the `recentWindow` boundary (the default) while every other protection keyed to the hot window keeps that boundary, and a value below `recentWindow` clamps up to it, so the pending tool-use continuation and its signature-carrying thinking block always stay inside the retained span. The measured per-request cost of widening is in [DESIGN.md](docs/DESIGN.md#12-measured-observations) (ages 12 to 16 recommended for delegation-heavy sessions); retained reasoning rides every request but stays invisible to the eviction estimate, so size the knob against `reasoningInWindowBytes` in the metrics log and checkpoint, which counts exactly this retained set.

### Exemptions and hints

| Option | Type | Default | Validation | Effect |
|---|---|---|---|---|
| `protectedTools` | `string[]` | `["task", "todowrite"]` | array of non-empty strings | Tool names never evicted |
| `protectedPatterns` | `string[]` | `[]` | array of non-empty strings | Glob patterns protecting subjects and bash commands from eviction |
| `hintSubjects` | `number` | `10` | integer, 0 or more (0 disables hints) | Cap on hot subjects in the hint line and the checkpoint |
| `cacheAwareHints` | `boolean` | `false` | boolean; anything else falls back to false | Hint rendering: renders the hot-subjects hint line byte-stable (the subject's path as identifier, members sorted, no range numerals) with entry and exit hysteresis on membership, so the system prompt's hint seat rewrites only on a genuine membership change instead of every run |

### Advanced configuration

These options are the ones whose misuse silently misleads rather than costs tokens: the estimate factor distorts every token figure the plugin reports, and the memory and telemetry bounds change what the plugin keeps and where it writes. The drop-on-invalid discipline applies to all of them unchanged, and each table documents its own validation.

#### Token estimate factor

| Option | Type | Default | Validation | Effect |
|---|---|---|---|---|
| `charsPerToken` | `number` | `4` | finite and above 0, floats allowed | Chars-per-token factor for the token estimate and eviction's reclaim accounting |

`charsPerToken` accepts extreme-but-valid values without rejection: a tenth or a ten-thousand-fold factor is accepted and the estimate degrades gracefully with it (eviction starts implausibly early or late while the zero-loss passes stay correct). Change it only when a tokenizer-informed factor for your models is known.

#### Memory bounds

| Option | Type | Default | Validation | Effect |
|---|---|---|---|---|
| `stashLimit` | `number` | `50` | integer, 0 or more (0 turns page retention off) | Per-session cap on stored evictions; reported as `capacity` by `describe` and the checkpoint |
| `stashSessions` | `number` | `8` | integer, 1 or more | Sessions keeping their reloadable eviction pages, least recently active evicted first |
| `limitSessions` | `number` | `8` | integer, 1 or more | Sessions keeping captured context limits |
| `hintSessions` | `number` | `8` | integer, 1 or more | Sessions keeping hot-subject hint lines |
| `metricsSessions` | `number` | `8` | integer, 1 or more | Sessions keeping live metrics counters |
| `rememberedEvictedSubjects` | `number` | `100` | integer, 0 or more (0 disables post-eviction touch counting) | Evicted subjects remembered per session for touch counting |
| `minSubstringMatchChars` | `number` | `3` | integer, 0 or more | Length a bash command must exceed for substring refresh matching (exact match always wins) |

#### Metrics and live state

| Option | Type | Default | Validation | Effect |
|---|---|---|---|---|
| `metricsLog` | `boolean` | `true` | boolean | Metrics JSONL logging on or off |
| `metricsPath` | `string` | `~/.local/share/opencode/context-metrics.jsonl` | non-empty string | Metrics log location |
| `metricsRotationMaxBytes` | `number` | `20971520` (20 MiB) | finite, 0 or more (0 disables rotation) | Metrics log rotation cap |
| `metricsMinLineIntervalMs` | `number` | `60000` (60 seconds) | finite, 0 or more (0 disables coalescing) | Minimum interval between metrics lines for reasoning-only runs |
| `ingestionHygiene` | `boolean` | `true` | boolean; anything else falls back to true | Strips terminal escape spans, carriage-return progress lines, and trailing runs of spaces and tabs from tool outputs as they complete |
| `ingestionHygieneCopy` | `boolean` | `true` | boolean; anything else falls back to true | Writes the original output to the hygiene log before a rewrite lands |
| `ingestionHygienePath` | `string` | `~/.local/share/opencode/context-hygiene.jsonl` | non-empty string | Hygiene log location |
| `ingestionHygieneRotationMaxBytes` | `number` | `5242880` (5 MiB) | finite, 0 or more (0 disables the copy, not the strip) | Hygiene log rotation cap |
| `pageStore` | `boolean` | `true` | boolean | Persistent page store for stored evictions on or off; `false` removes the cross-session `recall` record entirely |
| `pageStorePath` | `string` | `~/.local/share/opencode/context-pages.jsonl` | non-empty string | Page store location |
| `pageStoreRotationMaxBytes` | `number` | `20971520` (20 MiB) | finite, 0 or more (0 disables writes) | Page store rotation cap |
| `liveStateLog` | `boolean` | `true` | boolean | Session checkpoint writes on or off |
| `liveStatePath` | `string` | `~/.local/share/opencode/context-state` | non-empty string | Snapshot directory |
| `liveStatePruneMaxAgeMs` | `number` | `604800000` (7 days) | finite, 0 or more (0 disables pruning) | Snapshot max age before prune |
| `liveStatePruneMinIntervalMs` | `number` | `60000` (60 seconds) | finite, 0 or more (0 disables the throttle) | Minimum interval between prune directory scans |
| `sidebarEnabled` | `boolean` | `true` | boolean; anything else falls back to true | Registers the session sidebar's `sidebar_content` slot; the `/context` panel stays registered |
| `sidebarSubagents` | `boolean` | `false` | boolean; anything else falls back to false | Appends a Subagents group (every non-archived child session, aggregated by agent type) to the sidebar |
| `sidebarMode` | `string` | `full` | `full` or `context`; anything else falls back to `full` | In `context` the TUI load deactivates four host built-in sidebar sections (`internal:sidebar-mcp`, `-lsp`, `-todo`, `-files`); the host's own Context block stays active |

Updating from the previous `lru-*` data names is self-migrating: the plugin's first load renames the `lru-*` metrics log, snapshot directory, and hygiene log to their `context-*` names (rotated siblings moving with them) before any hook or panel read, never overwriting a name already in place, so the accumulated counters, checkpoints, and hygiene copies survive intact; a configured path option is never touched. [DESIGN.md](docs/DESIGN.md#11-migration-and-reset-semantics) carries the full account.

The 2026-10-02 vocabulary reset is the one non-migrating boundary: the persisted counter keys renamed (five keys including `stashHits` to `recallHits`), and records written before the reset are rejected wholesale rather than half-understood, so a session whose stored history is entirely pre-reset renders no metrics rows and no checkpoint block, and its context limit reads inactive, until its next run writes a current record. [DESIGN.md](docs/DESIGN.md#11-migration-and-reset-semantics) carries the full account.

### Full sample configuration

The two plugin files take separate registrations in separate config files: the core entry (`context-manager.ts`) goes in `opencode.json`'s `plugin` array and takes every option above except `sidebarEnabled` and `sidebarSubagents`, and the TUI entry (`context-manager.tui.tsx`) goes in `tui.json`'s `plugin` array, which is its only load path (the TUI never scans directories). Both config files below are the global ones in `~/.config/opencode/`, and each first element is the plugin file's path relative to the config file declaring it, matching the clone-based install: point it wherever your clone lives.

`opencode.json`:

```json
{
  "plugin": [
    [
      "./opencode-context-manager/plugin/context-manager.ts",
      {
        "manualMode": true,
        "watermarkTokens": 250000,
        "agedReadEvictionMessages": 30,
        "reasoningRetentionMessages": 8
      }
    ]
  ]
}
```

`tui.json`:

```json
{
  "plugin": [
    [
      "./opencode-context-manager/plugin/context-manager.tui.tsx",
      {
        "sidebarSubagents": true,
        "sidebarMode": "context"
      }
    ]
  ]
}
```

The samples show the working staged-manual setup the options tables document: manual mode with an absolute watermark, the aged read tier armed, and widened reasoning retention, and on the TUI side the subagents group with the context-mode sidebar. Every option is optional and defaults as its table row states, so a minimal install registers the entry with an empty options object (`{}`). Two values need care: the path options are home-directory shorthand, and the plugin takes a configured path literally with no tilde expansion, so write `metricsPath`, `ingestionHygienePath`, `pageStorePath`, and `liveStatePath` expanded when you configure them; and `defaultContextTokens` and `reasoningRetentionMessages` default to unset, so they are absent from the samples.

## What this plugin does

Loaded through the install's `opencode.json` entry, the core plugin runs in every session opencode opens, a subagent's included. The surface is three hooks and two tools: `chat.params` captures the session's context limit when the model is chosen, `experimental.chat.messages.transform` rewrites the outgoing message list on every turn, and `experimental.chat.system.transform` delivers a one-line hint of the active subjects into the system prompt; `recall` reloads evicted content, `describe` reports the live counters, and the `/context` panel plus the persistent session sidebar (registered by the TUI file) are read-only views over the metrics log and the per-session checkpoint. One transform run executes, in order:

| Stage | What it does | Fires when |
|---|---|---|
| hint strip | removes stale `[ctx-hot]` text parts left in the message list | such a part is present |
| tool-output dedup | replaces an older identical call's output with a `[ctx-deduped]` tombstone pointing at the newer copy | a later call repeats the same tool with the same input and the retained copy clears the 2048-byte floor |
| file-attachment dedup | replaces an older duplicate `file` part with a text tombstone naming the newest occurrence | an older occurrence with the same `mime` and `url` sits outside the recent window |
| errored-input purge | replaces a failed call's recorded input with `[ctx-purged-input]`, keeping the error output | the errored call sits outside the recent window |
| reasoning expiry | deletes `reasoning` parts outright | the part sits strictly older than the reasoning retention age (`reasoningRetentionMessages`, defaulting to the `recentWindow` boundary) |
| fence eviction (default off) | replaces an over-threshold fenced code block in an old user message with `[ctx-evicted-fence]` | `userFenceEviction.enabled` is true and the block exceeds `minBlockLines` |
| watermark eviction | replaces the coldest completed tool outputs with `[ctx-evicted]` tombstones until the estimate falls under the watermark | a context limit is known, the estimate crosses half of it, and an evictable candidate exists |

The passes in one line each, with the deep dive a click away: the no-loss passes (dedup with range-read collapse and attachment dedup, the errored-input purge, reasoning expiry) run on pattern presence alone and never need a context limit ([DESIGN.md, Mechanisms](docs/DESIGN.md#5-mechanisms)); watermark eviction sorts candidates coldest first by last touch with fault-based deferral and evicts only down to the watermark, writing tombstones whose digests and page-store pointers make the loss reversible ([Watermark eviction](docs/DESIGN.md#52-watermark-eviction)); the session page store and `recall` reload evicted originals verbatim across restarts and sessions ([The session page store and recall](docs/DESIGN.md#53-the-session-page-store-and-recall)); fence eviction, the one default-off pass, restores removed code blocks byte for byte ([User-fence eviction](docs/DESIGN.md#54-user-fence-eviction)); ingestion hygiene strips terminal escape noise once at tool completion ([Ingestion hygiene](docs/DESIGN.md#56-ingestion-hygiene)); and native compaction is enriched so its summary names what can still be reloaded ([Compaction enrichment](docs/DESIGN.md#55-compaction-enrichment)). The observation surface is `describe` (every counter, the resolved options, the newest run's omissions and advisory preview) plus the panel and the sidebar, both fed by the metrics log and the session checkpoint ([Observability](docs/DESIGN.md#6-observability)).

## Eviction policy

Watermark eviction is the one always-on pass that gives up live, unique content for tombstones, and its decisions follow one ordering, documented here exactly as shipped ([DESIGN.md's watermark eviction](docs/DESIGN.md#52-watermark-eviction) carries the deeper account of the same mechanisms). The evictable pool holds exactly one structural kind: completed tool outputs of at least `minEvictableBytes` (2048 by default) that are not already tombstones. User text and reasoning are never candidates (the scan reads tool parts only; reasoning expiry deletes outright, and fence eviction, default off, is a separate pass with its own restore rule), and outputs last touched inside the recent window are shielded wholesale, so current-turn content is structurally out of reach. Re-fetchability is likewise not a scoring input: every eviction stores the original verbatim for `recall` to reload ([The session page store and recall](docs/DESIGN.md#53-the-session-page-store-and-recall)), and each reload or post-eviction re-reference of a subject records a fault the sort key honors.

A candidate that clears the pool definition then passes three filters, and the survivors sort coldest first:

1. **Protected tools:** an output whose tool is listed in `protectedTools` (`["task", "todowrite"]` by default) is never a candidate.
2. **Hot window:** an output last touched within the last `recentWindow` messages (4 by default) stays; any later call against the same subject refreshes the touch, so re-read content keeps moving away from eviction.
3. **Protected patterns:** a subject matched by a `protectedPatterns` glob (`[]` by default) stays; a bash command's subject is the command string, so the same globs guard commands.

The sort key is effective recency, the output's last touch plus five messages of deferral per recorded fault on its subject (a fixed constant, not an option), oldest first, ties broken by size largest first. The fault shift is why reloaded content resists re-eviction under equal pressure while staying evictable when the deficit is real.

One walk then visits the candidates in sorted order and applies one of two dispositions to each: the aged read tier evicts a read-family output (a tool carrying a file path or pattern subject; bash is excluded) whose birth position, its own message rather than its refreshed touch, is older than `agedReadEvictionMessages` from the list tail, budget-independently (unset disables the tier); the watermark tier evicts the remaining candidates only while the reclaim still falls short of the deficit, the token estimate over the effective watermark (`watermarkTokens` when set, otherwise the context limit, captured from the model or set through `modelContextTokens` and `defaultContextTokens`, times `watermark`, 0.5 by default). The walk stands down entirely under `manualMode`, or when no effective watermark exists and the aged read tier is unset; the advisory band (`advisoryBandRatio`, 0.85 by default) previews proximity to the watermark without evicting anything. Every knob named here is documented with its validation in [Context limit and eviction](#context-limit-and-eviction) and [Exemptions and hints](#exemptions-and-hints).

There is no per-kind weight table, and that is the policy rather than an omission: with one structural kind in the pool, a class weight would only reorder tool outputs against each other, and the fault shift already supplies the one evidence-based demotion the ordering needs. If `describe`'s fault and recall figures ever show a class of outputs systematically re-referenced after eviction in a pattern no existing knob can express, a per-class weight is the recorded next step; until such evidence appears, the ordering above is the whole policy.

## Honest limits

What it cannot reduce: input history only. Output tokens (the model's answers), the per-request fixed payload (system prompt and tool definitions, plus the plugin's one hint line), and the number of requests are all invisible to it, and a session's cost floor is fixed overhead times request count.

Approximate accounting: characters over four is a proxy with tokenizer error in both directions, so eviction can start somewhat early or late; the log's numbers are directional, not billing-grade. The caching unknown is the design's largest unquantified risk: a prefix cache invalidates at the first changed message and eviction targets the oldest, deepest-prefix content, so where the cached price sits far below the uncached one, aggressive trimming can forfeit more in lost cache hits than it recovers in bytes; the plugin sees no billing data and models no cache state.

Reclamation is bounded by exemptions: the recent window, protected tools and patterns, the size floor, and already-tombstoned outputs all stay no matter the deficit; a context dominated by protected or sub-floor content cannot be trimmed to size.

Second order under plan caps: where usage is capped at the plan level and dominated by fixed per-request overhead times request count, trimming the variable history share of long sessions is a second-order lever; the plugin earns its keep as cheap insurance for the sessions that do grow long. The full account, including what survives restarts and what can still become unreloadable, is [DESIGN.md's honest limits](docs/DESIGN.md#10-honest-limits).

## Compatibility

The plugin runs inside opencode's own runtime and depends on a small, named slice of its plugin API: the `chat.params` hook (context-limit capture), the `experimental.chat.messages.transform` hook (the per-request eviction pass), the `experimental.chat.system.transform` hook (the hint line), and, for the `/context` panel and the session sidebar, the TUI slots API. Compatibility claims for a given opencode build come in two evidence tiers: wire-verified means the plugin ran end to end on that build and the actual provider payloads were captured and inspected, and source-verified means the build's host source or runtime binary was checked for the control flow the plugin relies on. The versions named below are the ones with archived evidence at each tier, not the full set; [DESIGN.md's staged engagement](docs/DESIGN.md#8-staged-engagement) additionally records source verification of the storage-isolation invariant at 1.1.4, 1.18.5, and 1.18.32 plus current dev.

- **opencode 1.18.29 (wire-verified):** end-to-end runs against a live opencode captured the wire payloads with the plugin loaded, proving the transform's passes, the `recall` tool, and its tombstone-and-reload loop on real sessions; this build is also the documented version floor ([Requirements](#requirements)).
- **opencode 1.18.30 (source-verified):** the hook ordering (`messages.transform` firing before the system prompt is assembled) and the system-transform contract were verified against that build's source.
- **opencode 1.18.31 (source-verified):** the surfaces the later passes rely on were verified against that build's source and runtime binary: tool-part attachment structure, the message serializer's pre-wire filtering, `file` part shape, the TUI slots surface the sidebar registers through, subagent child-session data, and the native compaction prune this plugin treats as its overflow backstop.

The sources ship as plain TypeScript executed with no build step, so any runtime loading them must support native type stripping; the test suite's documented node 24 floor meets that requirement (see Requirements). A build without the TUI slots API loads the core plugin and both tools unchanged and registers no views; a build that drops one of the named hooks breaks the feature that hook carries.

## Versioning

Releases are cut as `v`-prefixed semver tags on this repository, and each tag carries its notes on the [releases page](https://github.com/ThoDHa/opencode-context-manager/releases). There is no npm package and no registry step: a version is the tag, and the git-clone install and update flow of [Installation](#installation) consumes it directly, so pinning a version means checking the tag out in your clone and updating means pulling it. Cutting a release bumps `PLUGIN_VERSION` in `plugin/schema.ts` to the tag's value, so the metrics lines written by that build carry the version they were produced by.

## License

Released under the MIT license; the full text is [LICENSE](LICENSE) at the repository root.
