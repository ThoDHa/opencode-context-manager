# opencode-lru-context

An [opencode](https://opencode.ai) plugin that manages context windows with LRU eviction: it transforms chat requests to evict the least recently used tool outputs, reasoning blocks, duplicated attachments, and oversized fenced blocks, replaces evicted content with tombstones that can be restored through the `read_evicted` tool, reports live counters through `lru_stats`, and serves a `/lru` panel plus a persistent session-sidebar summary over the same data. [Installation](#installation) covers setup, updates, and removal; [Configuration](#configuration) covers the option surface.

## Contents

- [Installation](#installation)
  - [Requirements](#requirements)
  - [Install](#install)
  - [How it runs](#how-it-runs)
  - [Staying updated](#staying-updated)
  - [Manual install](#manual-install)
  - [Uninstall](#uninstall)
- [Configuration](#configuration)
  - [Budget and eviction](#budget-and-eviction)
  - [Exemptions and hints](#exemptions-and-hints)
  - [Memory bounds](#memory-bounds)
  - [Metrics and live state](#metrics-and-live-state)
  - [Full sample configuration](#full-sample-configuration)
- [LRU Context Plugin Design](#lru-context-plugin-design)
  - [Why this plugin exists](#why-this-plugin-exists)
  - [The plugin landscape](#the-plugin-landscape)
  - [Why Claude Code does not need this](#why-claude-code-does-not-need-this)
  - [What the plugin does](#what-the-plugin-does)
    - [The no-loss passes](#the-no-loss-passes)
    - [Watermark eviction](#watermark-eviction)
    - [The stash and read_evicted](#the-stash-and-read_evicted)
    - [User-fence eviction](#user-fence-eviction)
    - [Observability](#observability)
  - [Why it works: the token economics](#why-it-works-the-token-economics)
  - [When it fires and when it never does](#when-it-fires-and-when-it-never-does)
  - [Honest limits](#honest-limits)

## Installation

Installing the plugin means placing its four source files (`lru-context.ts`, `lru-context.tui.tsx`, `lru-panel-data.ts`, `lru-schema.ts`) in `~/.config/opencode/plugin/`, the directory the `Makefile` calls opencode's plugin directory. The `Makefile` automates the placement with symlinks and reverses it cleanly.

### Requirements

- [opencode](https://opencode.ai), the host application: its sessions run the plugin, and its TUI serves the `/lru` panel and the session sidebar. The two TUI views additionally need a current opencode build carrying the slots API, since the TUI module calls `api.slots.register` unconditionally; on builds without it the views are absent while the core transform and both tools work unchanged.
- git, to clone this repository and to pull later updates into it
- make, to run the `test`, `install`, and `uninstall` targets the `Makefile` defines
- node, to run the test suite, since `make test` invokes `node --test` over the core suite (`tests/lru-context.test.ts`) and the panel suites (`tests/lru-panel-data.test.ts`, `tests/lru-panel-rows.test.ts`, `tests/lru-sidebar-rows.test.ts`, `tests/lru-sidebar-subagents.test.ts`)

### Install

```sh
git clone https://github.com/ThoDHa/opencode-lru-context.git
cd opencode-lru-context
make test
make install
```

`make install` creates `~/.config/opencode/plugin/` when it is missing and symlinks the four plugin files into it. The install is idempotent: a rerun replaces existing symlinks in place. It never overwrites anything else: when a regular file or directory occupies a target path, the install aborts with an error naming the path, and the file must be removed by hand before the install can succeed.

### How it runs

The install is the whole deployment: the four symlinked files sit in opencode's plugin directory, so every opencode session, interactive and subagent alike, runs the plugin with no config file entry required; [Configuration](#configuration) documents the option surface and the wiring that delivers it. In a session, the surfaces to check are the ones [What the plugin does](#what-the-plugin-does) documents: `lru_stats` reports the live counters, the `/lru` panel and the session sidebar surface the same session data over the live-state snapshot and metrics log, eventful flushes append one line each to `~/.local/share/opencode/lru-metrics.jsonl` (reasoning-only runs coalesce within `metricsMinLineIntervalMs`), and every run with a last-run record rewrites the session's snapshot under `~/.local/share/opencode/lru-state/`.

### Staying updated

The installed entries are symlinks into the clone, so an update is `git pull` in the repository: the links resolve into the working tree, and the code the plugin runs is whatever the pull left there. `make test` re-runs the five suites against the pulled tree.

### Manual install

On a machine without make, the same layout is a handful of commands from the repository root:

```sh
mkdir -p ~/.config/opencode/plugin
ln -sfn "$PWD/plugin/lru-context.ts" ~/.config/opencode/plugin/lru-context.ts
ln -sfn "$PWD/plugin/lru-context.tui.tsx" ~/.config/opencode/plugin/lru-context.tui.tsx
ln -sfn "$PWD/plugin/lru-panel-data.ts" ~/.config/opencode/plugin/lru-panel-data.ts
```

Copying the files instead of linking them works too. Unlike `make install`, these commands carry no non-symlink guard: `ln -sfn` silently replaces whatever regular file sits at a target path where the install target would abort with an error naming it.

### Uninstall

`make uninstall` removes the four plugin symlinks from `~/.config/opencode/plugin/`. Only symlinks are removed: a regular file left at a target path by a manual copy is untouched and must be removed by hand, and the repository checkout is unaffected.

## Configuration

The plugin reads its options from the second argument opencode passes to a plugin function. In `opencode.json`'s `plugin` array an entry may be a plain string or a two-element tuple naming the plugin plus an options object; the tuple form is confirmed against the `@opencode-ai/plugin` type surface (version 1.18.5: `plugin?: Array<string | [string, PluginOptions]>`, with the object delivered as the plugin function's second parameter), while the official plugin and config pages document string entries only and are silent on options, so the tuple form is a type-surface fact, not a documented one. Two adjacent gaps are stated rather than papered over: the docs do not say how or whether options reach a plugin loaded from the plugin directory that `make install` populates, and they do not say what a plain string entry passes as options; the tuple entry is the only options channel verifiable today.

However they arrive, options follow a drop-on-invalid discipline: a value failing the validation below is discarded and the documented default applies, so a mistyped option degrades to default behavior instead of blocking a session. One consequence is worth naming: `charsPerToken` accepts any finite number above zero, so extreme-but-valid values are not rejected either; a tenth or a ten-thousand-fold factor is accepted and the token estimate degrades gracefully with it (eviction starts implausibly early or late while the zero-loss passes and the budget resolution stay correct).

### Budget and eviction

| Option | Type | Default | Validation | Effect |
|---|---|---|---|---|
| `watermark` | `number` | `0.5` | above 0 and below 1 | Fraction of the context budget at which eviction starts |
| `recentWindow` | `number` | `4` | number, 0 or more, floored | Messages treated as hot; shielded from eviction, reasoning expiry, input purge, and fence eviction |
| `minEvictableBytes` | `number` | `2048` | 0 or more | Output size floor for evictability and for dedup supersede |
| `defaultContextTokens` | `number` | unset | finite and above 0 | Fallback budget when no model limit was captured |
| `modelContextTokens` | `Record<string, number>` | `{}` | per-entry finite and above 0 | Per `providerID/modelID` budget override |
| `charsPerToken` | `number` | `4` | finite and above 0, floats allowed | Chars-per-token factor for the token estimate and eviction's reclaim accounting |
| `manualMode` | `boolean` | `false` | boolean; anything else falls back to false | Disables budget-driven eviction; measurement-only runs |
| `userFenceEviction` | `object` | `{ enabled: false, minBlockLines: 40 }` | `enabled` boolean; `minBlockLines` integer 0 or more | Evicts large fenced code blocks from old user messages |

### Exemptions and hints

| Option | Type | Default | Validation | Effect |
|---|---|---|---|---|
| `protectedTools` | `string[]` | `["task", "todowrite"]` | array of non-empty strings | Tool names never evicted |
| `protectedPatterns` | `string[]` | `[]` | array of non-empty strings | Glob patterns protecting subjects and bash commands from eviction |
| `hintSubjects` | `number` | `10` | integer, 0 or more (0 disables hints) | Cap on hot subjects in the hint line and the snapshot |

### Memory bounds

| Option | Type | Default | Validation | Effect |
|---|---|---|---|---|
| `stashLimit` | `number` | `50` | integer, 0 or more (0 turns stash retention off) | Per-session cap on stashed evictions; reported as `capacity` by `lru_stats` and the snapshot |
| `stashSessions` | `number` | `8` | integer, 1 or more | Sessions keeping reloadable eviction stashes, least recently active evicted first |
| `limitSessions` | `number` | `8` | integer, 1 or more | Sessions keeping captured context budgets |
| `hintSessions` | `number` | `8` | integer, 1 or more | Sessions keeping hot-subject hint lines |
| `metricsSessions` | `number` | `8` | integer, 1 or more | Sessions keeping live metrics counters |
| `rememberedEvictedSubjects` | `number` | `100` | integer, 0 or more (0 disables post-eviction touch counting) | Evicted subjects remembered per session for touch counting |
| `minSubstringMatchChars` | `number` | `3` | integer, 0 or more | Length a bash command must exceed for substring refresh matching (exact match always wins) |

### Metrics and live state

| Option | Type | Default | Validation | Effect |
|---|---|---|---|---|
| `metricsLog` | `boolean` | `true` | boolean | Metrics JSONL logging on or off |
| `metricsPath` | `string` | `~/.local/share/opencode/lru-metrics.jsonl` | non-empty string | Metrics log location |
| `metricsRotationMaxBytes` | `number` | `20971520` (20 MiB) | finite, 0 or more (0 disables rotation) | Metrics log rotation cap |
| `metricsMinLineIntervalMs` | `number` | `60000` (60 seconds) | finite, 0 or more (0 disables coalescing) | Minimum interval between metrics lines for reasoning-only runs |
| `liveStateLog` | `boolean` | `true` | boolean | Live snapshot writes on or off |
| `liveStatePath` | `string` | `~/.local/share/opencode/lru-state` | non-empty string | Snapshot directory |
| `liveStatePruneMaxAgeMs` | `number` | `604800000` (7 days) | finite, 0 or more (0 disables pruning) | Snapshot max age before prune |
| `liveStatePruneMinIntervalMs` | `number` | `60000` (60 seconds) | finite, 0 or more (0 disables the throttle) | Minimum interval between prune directory scans |
| `sidebarEnabled` | `boolean` | `true` | boolean; anything else falls back to true | Registers the session sidebar's `sidebar_content` slot; the `/lru` panel stays registered |
| `sidebarSubagents` | `boolean` | `false` | boolean; anything else falls back to false | Appends a Subagents group (every non-archived child session, aggregated by agent type) to the sidebar |

### Full sample configuration

The two plugin files take separate registrations: the core entry (`lru-context.ts`) takes every option above except `sidebarEnabled` and `sidebarSubagents`, and the TUI entry (`lru-context.tui.tsx`) reads only `sidebarEnabled` and `sidebarSubagents` through its own registration. Each first element below is the installed plugin file's path, so point it wherever your copies live.

```json
{
  "plugin": [
    [
      "~/.config/opencode/plugin/lru-context.ts",
      {
        "watermark": 0.5,
        "recentWindow": 4,
        "minEvictableBytes": 2048,
        "modelContextTokens": {},
        "charsPerToken": 4,
        "manualMode": false,
        "userFenceEviction": { "enabled": false, "minBlockLines": 40 },
        "protectedTools": ["task", "todowrite"],
        "protectedPatterns": [],
        "hintSubjects": 10,
        "stashLimit": 50,
        "stashSessions": 8,
        "limitSessions": 8,
        "hintSessions": 8,
        "metricsSessions": 8,
        "rememberedEvictedSubjects": 100,
        "minSubstringMatchChars": 3,
        "metricsLog": true,
        "metricsPath": "~/.local/share/opencode/lru-metrics.jsonl",
        "metricsRotationMaxBytes": 20971520,
        "metricsMinLineIntervalMs": 60000,
        "liveStateLog": true,
        "liveStatePath": "~/.local/share/opencode/lru-state",
        "liveStatePruneMaxAgeMs": 604800000,
        "liveStatePruneMinIntervalMs": 60000
      }
    ],
    [
      "~/.config/opencode/plugin/lru-context.tui.tsx",
      {
        "sidebarEnabled": true,
        "sidebarSubagents": false
      }
    ]
  ]
}
```

Every value shown is that option's default, so omitting any key yields the same behavior, with one exception: the two path values are home-directory shorthand, and the plugin takes a configured path literally with no tilde expansion, so write `metricsPath` and `liveStatePath` expanded when you configure them; omitted, the plugin derives the real paths under your home directory. `defaultContextTokens` is absent because its default is unset, and adding it sets the fallback budget that applies when no model limit was captured.

## LRU Context Plugin Design

The LRU Context Manager is the plugin at `plugin/lru-context.ts`, with the TUI panel and sidebar in `lru-context.tui.tsx`, their shared data layer in `lru-panel-data.ts`, and the shared totals schema both data sides consume in `lru-schema.ts`. It hooks the transform opencode runs on the message list before every model call and trims what the provider is about to receive. `make test` pins the mechanism claims (core suite `tests/lru-context.test.ts`, panel suites `tests/lru-panel-data.test.ts`, `tests/lru-panel-rows.test.ts`, `tests/lru-sidebar-rows.test.ts`, `tests/lru-sidebar-subagents.test.ts`); the comparisons, the economics, and the observed session below are argument and measurement, not test outputs.

### Why this plugin exists

Chat APIs are stateless: every request re-sends the conversation so far, so per-request input grows monotonically and a session of N turns bills about c times N squared over 2 input tokens for content that grew only linearly (derived below). In the normal path nothing trims per turn; growth continues until something reacts.

opencode's config schema (https://opencode.ai/config.json) ships adjacent mechanisms: `tool_output.max_lines` and `tool_output.max_bytes` (defaults 2000 and 51200) truncate oversized tool output at ingestion, full text saved to disk and a preview returned, bounding what enters rather than what accumulates; `compaction.auto` (default true) fires, in the schema's words, "when context is full", with retention knobs (`tail_turns`, `preserve_recent_tokens`, `reserved`) and a manual on-demand form; `compaction.prune` (default false) clears old tool outputs into markers; per-model `cache_read` and `cache_write` pricing makes re-sent history cheaper rather than smaller. Each leaves the gap this plugin targets: compaction is reactive at the ceiling, one large lossy event whose summaries have no recovery path; the prune is positional, unaware of what the model still touches, its markers naming no subject, size, or way back; caching leaves the model attending over the full context with unknown quota effects.

This plugin maintains per turn under a chosen watermark, tiers by information value (zero-loss dedup and expiry every turn; eviction last, only above the watermark, against candidates ordered by recency), makes eviction reversible through the stash and `read_evicted`, is observable end to end (metrics log, live-state snapshot, `lru_stats`, the `/lru` panel, the session sidebar), and keeps native auto compaction as the overflow backstop. Two admissions bound it: on sessions that never grow it is inert, and where a provider discounts cached prefixes heavily its trimming can forfeit more in lost cache hits than it recovers in bytes; it does not model cache state and does not claim to.

### The plugin landscape

The third-party field (public descriptions and repository metadata as of 2026-09-18, the Sleev site as captured 2026-09-07) confirms the gap rather than filling it. DCP (`Opencode-DCP/opencode-dynamic-context-pruning`, about 4.2k stars, AGPL-3.0) is the strongest entry: a model-invoked `compress` tool replaces stale conversation spans with LLM-written summaries, and its deduplication and errored-input-purge strategies are adopted deliberately here as two of this plugin's passes; beyond that shared layer it fails every design commitment (model tokens spent per pass, the model deciding when and what to compress, the summary the only carrier of a replaced span with no reload path, recency gating a fixed turn window instead of refreshing on use), and its README measures the cache trade-off flagged below as this design's largest risk (roughly 85 percent hit rate with pruning against 90 without). Sleev, DCP's commercial successor proxying Claude Code, Codex, and OpenCode, shares the summary cost model and adds an infrastructure dependency every request routes through, where this design's problem is one opencode install kept deterministic and dependency-free. The observability projects (`IgorWarzocha/Opencode-Context-Analysis-Plugin`, about 180 stars, stale since 2025-10, no license, which alone bars code reuse; `ttalkkak-lab/opencode-contexty`, AGPL-3.0) analyze rather than trim, contexty's one trimming path being an embedded DCP configuration. `viiqswim/opencode-compaction-guard` repairs the native collapse's `tool_use without tool_result` failure, which this design's passes never cause; the better lever is shrinking how often the collapse fires. Upstream was asked for both halves of this design (issue #22407: pointer-based retrieval for compacted tool results; issue #32189: context-aware pruning) and closed both without maintainer engagement.

### Why Claude Code does not need this

Claude Code, Anthropic's agent harness for the same model family, ships this job natively. Its documentation describes the progression directly: as context fills, Claude Code "clears older tool outputs first, then summarizes the conversation if needed"; auto-compaction summarizes history as the session approaches the auto-compact window, `/compact` is the on-demand form (focus instructions inline, or a "Compact Instructions" section in CLAUDE.md), and `/context` shows what is consuming space. Around the trimmers sit prompt caching managed automatically, MCP tool definitions deferred until tool search loads them, subagents working in their own context windows, and `/clear` between unrelated tasks. The plugin cannot run there anyway: it hooks opencode's message transform, a surface Claude Code does not have.

The honest nuance is that the native mechanisms are lossy too: the documentation describes no recovery for cleared tool outputs, removed images must be re-shared, compaction keeps a structured summary in place of the verbatim history, and compaction invalidates the prompt cache by design, the same trade flagged below as this design's largest unquantified risk. The stash, `read_evicted`, and touch-based ordering are absent there, and fine to leave absent because the native stack covers the need by default; this plugin exists for the harness whose maintenance of accumulated history stops at a reactive collapse and a default-off prune.

### What the plugin does

Loaded from opencode's plugin directory (the install's symlink target), the plugin runs in every session opencode opens, a subagent's included. The surface is three hooks and two tools: `chat.params` captures the session's context budget when the model is chosen, `experimental.chat.messages.transform` rewrites the outgoing message list on every turn, and `experimental.chat.system.transform` delivers a one-line hint into the system prompt; `read_evicted` reloads evicted content from the session stash, and `lru_stats` reports the live counters as JSON. The `/lru` TUI panel (the `lru.panel` command, registered by `lru-context.tui.tsx`) and the same file's persistent session-sidebar entry are read-only views over the plugin's metrics log and the per-session live-state snapshot.

One transform run executes, in order:

| Stage | What it does | Fires when |
|---|---|---|
| hint strip | removes stale `[lru-hot]` text parts left in the message list | such a part is present |
| tool-output dedup | replaces an older identical call's output with a `[lru-deduped]` tombstone pointing at the newer copy | a later call repeats the same tool with the same input and the retained copy clears the 2048-byte floor |
| file-attachment dedup | replaces an older duplicate `file` part with a text tombstone naming the newest occurrence | an older occurrence with the same `mime` and `url` sits outside the recent window |
| errored-input purge | replaces a failed call's recorded input with `[lru-purged-input]`, keeping the error output | the errored call sits outside the recent window |
| reasoning expiry | deletes `reasoning` parts outright | the part sits strictly outside the recent window |
| fence eviction (default off) | replaces an over-threshold fenced code block in an old user message with `[lru-evicted-fence]` | `userFenceEviction.enabled` is true and the block exceeds `minBlockLines` |
| watermark eviction | replaces the coldest completed tool outputs with `[lru-evicted]` tombstones until the estimate falls under the watermark | a budget is known, the estimate crosses half of it, and an evictable candidate exists |

After the passes, the run counts post-eviction touches, records counters, stores the hint line for the next system-prompt build, appends one metrics-log line when the run did anything at all, and rewrites the session's live-state snapshot.

Token accounting is approximate by design: text parts and completed tool outputs are sized in characters divided by the `charsPerToken` factor (four by default), carrying tokenizer error without needing a tokenizer. The context budget resolves in a fixed order: a `modelContextTokens` entry keyed `providerID/modelID`, then the model's declared context limit from `chat.params` (accepted only when finite and positive), then an explicit `defaultContextTokens`, then nothing; unknown means eviction stands down rather than inventing a budget, while dedup, purge, expiry, fence eviction, and the hint still run and native auto-compaction remains the overflow backstop. The watermark is half the budget (the `watermark` ratio defaults to 0.5 and must lie strictly between 0 and 1), `recentWindow` defaults to 4 messages, `minEvictableBytes` to 2048.

#### The no-loss passes

Tool-output dedup scans the message list newest first. A call's identity is the tool name plus a key-order-insensitive serialization of its input, so two calls differing only in JSON key order dedup; an older identical call's output becomes a `[lru-deduped]` tombstone naming the message holding the retained copy, with the superseded copy's `state.attachments` stripped. The tombstone forms only when the retained copy itself clears the 2048-byte floor, the pass has no recent-window guard and needs no budget (a duplicate is redundant wherever it sits), and marker-prefixed outputs are skipped on every later pass, so repeated transforms are idempotent. File-attachment dedup runs beside it: a `file` part (the `@`-reference surface, carrying `mime`, `url`, an optional `filename`) whose `mime` and `url` both match a newer occurrence becomes a text tombstone naming it; identity is content (identical basenames in different directories never collapse), the newest occurrence is always retained verbatim, occurrences inside the recent window are never tombstoned, and no size floor applies because a `file` part's payload size is not observable from its `url`.

The errored-input purge keeps a failed call's error output (often the only record of what went wrong) but replaces its recorded input, which can be large, with `[lru-purged-input]` once the call ages out of the recent window. Reasoning expiry deletes `reasoning` parts strictly older than the same window, wagering that reasoning from earlier turns has no consumers: the producing model already converted it into visible output, and the signature-carrying blocks an in-flight tool-use continuation needs sit inside the window by construction. Expiry is plain deletion with no stash and no reload path; it runs whether or not a budget is known and is counted separately from evictions (parts and bytes on `lru_stats` and in the metrics log), never added back.

#### Watermark eviction

Every completed tool output of at least `minEvictableBytes` that is not already a tombstone is an evictable candidate, with subjects extracted: file paths (with `offset`/`limit` ranges when present), grep and glob `pattern` strings, bash command strings. A candidate's `lastTouch` starts at its own message index and refreshes forward on any later call against the same subject: exact match for paths, substring containment for bash commands whose length exceeds `minSubstringMatchChars` (three by default), ranged and whole-path calls refreshing each other. Exemptions: outputs last touched inside the recent window, the `task` and `todowrite` tools (the `protectedTools` default, overridable), subjects matched by the `protectedPatterns` glob list (a bash command's path is the command, so the same globs guard commands), outputs under the floor, and anything already tombstoned.

Candidates sort coldest first (ascending `lastTouch`, ties by descending size); above the watermark the plugin computes the token deficit and walks the list until the reclaim covers it, so a one-token overshoot evicts exactly one output, and only the evicted output's own bytes earn credit (tombstone and digest bytes stay in context), so `bytesReclaimed` never overstates what left. A tombstone reads, in one line: `[lru-evicted] <tool> <subject> (<bytes> bytes[, attachments dropped], ~<age> messages ago) was evicted to reclaim context; re-run the tool to reload its output. Output digest: <digest>. Evicted output stashed; reload it with read_evicted (subject "<subject>").` The subject caps at 160 characters. The digest is deterministic string work, so identical content always yields an identical digest: `read` outputs contribute the subject plus previews of the first and last lines, `bash` outputs the command plus head and tail lines, every other tool a bounded excerpt of the output head; newlines collapse and the whole digest caps at 200 characters. Attachments leave with the output: the evicted part loses its `state.attachments` array entirely and the tombstone gains the `attachments dropped` clause.

#### The stash and read_evicted

Eviction does not destroy: each evicted output enters a per-session in-memory stash, 50 (`stashLimit`) entries per session with the oldest dropped, 8 (`stashSessions`) sessions retained with the least recently active session evicted first. `read_evicted` returns the stashed original named by subject, passed exactly as the tombstone names it: the newest match in full, one-line pointers to any older matches; a subject with nothing stashed returns a miss message stating that only outputs evicted during this session are stashed. A hit refreshes the session's stash against the 8-session bound; a miss probe and an `lru_stats` call do not, so idle sessions' stashes age out first. Fence evictions share the same stash and bound. Reload cannot re-serve binary attachments (the tool returns a string, and re-serving megabyte data URIs would re-inflate the context eviction just reclaimed): it appends a manifest naming each attachment's mime and data-URI length and advises re-running the original tool to regenerate them.

#### User-fence eviction

Fence eviction is the one pass that edits user prose, so it ships default-off behind `userFenceEviction` (`{ enabled: false, minBlockLines: 40 }` when unset). When enabled, it scans the text parts of user messages outside the recent window for fenced code blocks under CommonMark fence rules: an opener is at least three backticks after at most three spaces of indent (four or more spaces is indented code, never a fence, and an info string holding a backtick never opens a block), the closer needs at least as many backticks as the opener, an unterminated block is never touched, an all-blank block is never evicted since it names nothing. A closed block whose content spans strictly more than `minBlockLines` lines becomes an `[lru-evicted-fence]` tombstone naming the language tag (the first word of the info string when present), the content line count, and the first non-empty content line as the reload subject; the prose before, between, and after the fences is preserved byte for byte, the exact removed span enters the session stash for verbatim `read_evicted` restore, and the pass runs before the budget decision, so fence bytes lower the estimate and can spare tool outputs an eviction.

#### Observability

After each run the plugin stores a `[lru-hot] recently active: ...` line naming up to ten (`hintSubjects`) most recently touched live subjects, newest first; the system-prompt hook appends it or replaces the previous one in place, making the working set visible so tombstones stay navigable.

The metrics log is on by default and appends to `~/.local/share/opencode/lru-metrics.jsonl` (`metricsPath` relocates it). Every eventful run appends one JSON line; eventful means at least one eviction, dedup tombstone, expired reasoning part, fence eviction, or post-eviction touch, or any stash read since the previous line, so quiet runs write nothing. A reasoning-only eventful run (expiry is the only eventfulness) inside `metricsMinLineIntervalMs` (default 60000, `0` disables coalescing) of the session's previous line writes nothing instead, because expiry re-reports the session's standing aged set every run and those re-reports carry no new information between lines; the window is measured from the session's previous flushed line and a suppressed run does not move it, so sustained reasoning-only traffic settles at one line per interval, and any eviction, dedup, touch, fence event, or stash read flushes immediately regardless of the window, as does a change in the budget source against the last flushed line. The interval bookkeeping is per-process memory: a restart forgets it and the next eventful run writes, so coalescing never loses the first line of a sitting. Under coalescing, a line count therefore means eventful flushes rather than eventful runs (the panel's `runs` figure and the log-tail rehydration seed inherit this; the snapshot still covers quiet runs and stays run-faithful), a degree change, not a kind change: the count already excluded quiet runs and now also folds coalesced reasoning-only runs into their nearest preceding or following flush. Each line carries a timestamp, the session id, the budget with its source (`override`, `model`, `default`, or `unknown`; resolved from a live `chat.params` capture, the explicit `defaultContextTokens` option, or the budget persisted with the session's newest record in the snapshot or the metrics log tail, whichever is fresher; the persisted value is suppressed, and eviction stands down, when the session has since changed models or when the config no longer carries the override entry or default option the persisted budget came from), the estimate against watermark and deficit, per-entry eviction records (tool, subject, bytes, attachment bytes, age in messages), dedup, expiry, fence, and touch counts, stash reads since the previous line, and running totals that cover the session's lifetime and are restored across process restarts from the session's snapshot or log tail: the raw counters, the unique-event counts (`dedupedUnique` first tombstones per content-identical duplicate pair, `reasoningExpiredUnique` content-identical reasoning parts counted the first run each crosses the recent window), the superseded-duplicate byte total (`dedupedBytes`), and the three token-savings estimates (`evictionTokensSaved`, `dedupTokensSaved`, `reasoningTokensSaved`). `bytesReclaimed` counts evicted output and attachment data-URI characters plus fence-block bytes, and dedup records the byte size of each superseded duplicate it tombstones (a superseded `file` part records none, since its payload size is not observable from its `url`); expiry bytes go to `reasoningBytesExpired`, purged inputs count nowhere. The count and savings semantics differ deliberately, and reading one as the other misstates the session by orders of magnitude: the dedup and reasoning counts are unique events, identified by content, so a duplicate pair counts when its tombstone is first created and a reasoning part when it first crosses the recent window, and identical-content occurrences count once, while `reasoningBytesExpired`, `dedupedBytes`, and the token estimates over them are cumulative per-request savings, all three estimates over the resolved `charsPerToken` factor, not billed-token measurements: eviction divides its reclaimed bytes, dedup divides the superseded copies' output and attachment bytes, and reasoning expiry divides the expired blocks' bytes. That is why the sidebar renders, say, `Reasoning expired: 321, ~53.2M tokens`: the count is unique parts, the savings is the cumulative estimate, and neither number subsumes the other. The unique counts are per-entry lifetime figures: their seen-content memory lives on the session's entry in the metrics LRU, so an entry evicted from the LRU (past the `metricsSessions` bound) and later reseeded re-counts that session's standing set once more; the counters are monotone nonetheless, unique can never exceed cumulative. `metricsRotationMaxBytes` (default 20 MiB, `0` disables) renames the file to `<metricsPath>.1` before an append that would exceed the cap, so only the current and previous generations exist; a failed stat, rename, or append surfaces as `logWriteError` through `lru_stats` without interrupting the session. The cap sizes the retained history: at the roughly 1.45 MB/day observed before coalescing, the old 5 MiB default held about 7 days across its two generations and 2.6 days had already rotated out permanently on that workload, while 20 MiB holds roughly three weeks at that rate and several weeks beyond it at the post-coalescing rate, which line coalescing cuts by an estimated 70 to 85 percent. A post-eviction touch, a later call re-referencing an evicted subject, is the feedback signal that makes eviction's error rate measurable rather than assumed.

The live-state snapshot is the second data source for both TUI views, on by default (`liveStateLog`; `liveStatePath` relocates the directory, `~/.local/share/opencode/lru-state/`). Every transform run with a last-run record rewrites `<session id>.json` there: a timestamp, the session id, manual mode, the resolved budget and its source (persisted with an optional model identity, in the snapshot and each metrics line, so a restart resumes the session's budget instead of flickering it to unknown; a live `chat.params` capture always wins over the persisted value, a change of model or the removal of the config override or default the persisted budget came from suppresses it so eviction stands down rather than refilling a stale budget, and an absent or null pair in an old record rehydrates to unknown, the pre-persistence behavior), the last run against watermark and deficit, the session's lifetime running totals (restored across restarts), stash occupancy and capacity, and the hot subjects. The write is atomic (a sibling temp file renamed into place, never a torn read), a failure surfaces as `stateWriteError` through `lru_stats`, and files older than `liveStatePruneMaxAgeMs` (default seven days, `0` disables pruning) are removed on a directory scan throttled to one per `liveStatePruneMinIntervalMs` (default 60 seconds, `0` disables the throttle). Because the snapshot covers quiet runs, live state exists even when the log is silent.

The metrics totals schema is declared once, in `plugin/lru-schema.ts`: the producer's counter seeding and totals emission and the panel parser's required-key checks all derive from the same key list, so a counter addition is one edit instead of a six-file lockstep. The panel's log reader tolerates pre-upgrade lines: a record whose totals predate a schema key is skipped per session (only sessions carrying such lines collapse to their newest parseable line; sessions whose every line parses strict keep their full run history and eviction footer), so the global block degrades gracefully across schema growth instead of blanking until old lines rotate out; the strict parser itself is unchanged, and a session whose every line is pre-upgrade shows no data until its next run writes a current record. One transitional exception keeps recent history readable: `dedupedBytes` postdates the other raw counters, so an absent `dedupedBytes` in a persisted record totals is read as `0` rather than rejected (mirroring the producer's own seeding tolerance for the same gap) while every other missing or non-finite key still rejects the record.

`lru_stats` returns an echo of the resolved options (a fixed subset covering the budget, logging, and mode settings, not the full [Configuration](#configuration) surface), the effective budget with its source, stash occupancy and capacity, every counter, and the last run's estimate, watermark, and deficit; it stays the full-detail surface. The rows the two views no longer spend stay reachable elsewhere: session id, stash occupancy, and the stash hit, miss, and drop counters through `lru_stats`, hot subjects through the hint line and the session snapshot, and the unfiltered run history only in the metrics log itself. Each view reads the log anew at open or poll, filters to the session it serves, and prefers the live snapshot for the session block: a session log line newer than the snapshot wins the fields it carries, and a missing or malformed snapshot falls back to the log. What renders differs by view: both read the same two data sources, and each draws from its own row builder in `lru-panel-data.ts`, so the exact text of both is unit-tested without a terminal. The `/lru` dialog renders `panelRows`, the compact form: a header row (`LRU Context Manager`, suffixed `(manual)` only in manual mode), the budget with its source, the last run against the watermark with the deficit, one compact counters line (evictions with reclaimed bytes and its token-savings estimate, dedup count with its estimate, stash reads with hit count), and, once the metrics log carries an eviction for the session, the newest one as a single muted line naming tool, subject, size, and age. The sidebar renders `sidebarRows`, spaced for its narrow column (about 42 characters) as three blank-line-separated groups: the header, one stat block, and, once the metrics log carries an eviction for the session, the newest one as a muted two-line footer naming tool, subject, size, and age. The stat block lines read `Budget: <compact tokens>`, `Watermark: <compact tokens>`, `Over by: <compact deficit>` (present only when the last run's deficit is non-null and above zero), `Evictions: <count>, ~<savings estimate> tokens`, `Deduped: <count>, ~<savings estimate> tokens`, `Reasoning expired: <count>, ~<savings estimate> tokens`, and `Stash reads: <count>, <hits> hits`; a null budget renders as `Budget: inactive (no budget)` and a missing watermark as `Watermark: none`, and the sidebar carries no budget source label (the panel keeps its label).

With `sidebarSubagents` enabled the sidebar appends one last blank-line-separated group for the session's subagent children (sessions carrying this one as their parent, fetched through the TUI API each tick): every non-archived child is within scope regardless of how old its last update is or whether it is still running, and archived ones never render. A muted lead row `Subagents: <count>` is followed by one muted row per agent type carrying just its agent count, `explore: 2 agents` for a multi-child type and `explore: 1 agent` for a single-child one; each landed type adds four indented rows beneath its type row, `  Evictions: <count>, ~<compact tokens> tokens`, `  Deduped: <count>, ~<compact tokens> tokens`, `  Reasoning expired: <count>, ~<compact tokens> tokens`, and `  Stash reads: <reads>, <hits> hits` (reads are hits plus misses), every figure summed over the type's children whose data landed and the rows mirroring the session stat block's own counter rows; a type whose children have no recorded data yet renders `<type>: no data yet`, type rows sort by the type's most recent child update with the most recent first, and every row truncates with an ellipsis against the sidebar's column limit. The group degrades silently: a tick whose children fetch fails or that finds no non-archived children renders the sidebar exactly as with the option off.

The sidebar entry registers through the TUI plugin API's `sidebar_content` slot when `sidebarEnabled` is true (the default; a non-boolean value falls back to true, and `false` skips only that slot registration while the `/lru` command stays registered; the same registration reads `sidebarSubagents`, default false, which adds nothing on its own while the slot itself is off) and re-renders on a five-second poll of the same two files, visible only while the session has recorded data: a tick whose log read fails with no snapshot to fall back on hides it for that tick (startup and log rotation produce such transient failures), and the next poll repaints. The poll's timer and its post-await writes are dispose-guarded, so a route change or plugin shutdown cannot write through a disposed component.

Degradation is explicit and identical in both builders: "no active session" outside a session, "no metrics recorded for this session yet" for a session with no runs, malformed lines skipped at parse, and an unreadable log leaving the snapshot-fed session block under a warning row when a snapshot serves the session, header and warning row alone otherwise.

### Why it works: the token economics

Suppose a session adds roughly c tokens of new content per turn. Request n then carries about n times c input tokens, and a session of N turns bills about c times N squared over 2 input tokens in total: quadratic in session length, for content that grew only linearly. The overhead multiple is about N over 2: a 60-turn session bills roughly thirty times the content's worth, almost all of it settled history the model will not touch again.

The passes form three tiers of increasing aggression, each with an explicit information trade. Tier zero removes dead weight at no loss: reasoning expiry and the errored-input purge delete content whose consumers are gone (expired reasoning was already converted into the visible output that replaced it; a purged failed-call input sits beside the error text that matters), firing every turn regardless of budget, which is why a long session's metrics show most reclamation happening before any eviction. Tier one removes pure redundancy at no loss: a dedup tombstone only replaces an output fully duplicated by the retained newest copy, and the floor keeps trivial outputs from erasing substantial ones. Tier two trades old tool outputs for small references above the watermark: the tombstone answers "was this file read, and what did its first line say" without a reload but does not substitute for the content; the original reloads verbatim from the stash (binary attachments the exception), and the recent window, the protected tools (`task` outputs carry a subagent session's report, `todowrite` outputs carry plan state, both expensive to reconstruct), and the pattern exemptions bound what may leave.

In aggregate: under the watermark only the no-loss tiers apply and per-request cost still grows with history; above it, eviction pins per-request input near the watermark (each run trims just far enough to fall back under), and cumulative input falls from quadratic in N toward linear in N. That conversion, on top of the zero-loss tiers, is the entire economic argument.

### When it fires and when it never does

The zero-loss passes fire on pattern presence alone (a reasoning part aging past the recent window, an identical call repeating, a failed call aging out); no budget is needed. Eviction needs all three of a known budget, an estimate above half of it, and an evictable candidate outside the exemptions; missing any one yields zero evictions by design. `lru_stats` distinguishes the stand-downs: unknown budget leaves the budget itself null, and the `manualMode` option (default false, a non-boolean value falls back to false) nulls the last run's watermark and deficit by choice, suspending only budget-driven eviction while dedup, purge, expiry, fence eviction, the hint, the stash, and both tools keep running. One observed long session (a single final metrics line, not a benchmark) expired 954 reasoning parts, about 3.18 MB reclaimed, with zero evictions and the estimate near 52k against a 500k-token watermark: every turn delegating to a subagent leaves a reasoning block, and the blocks age out of the four-message window long before the watermark engages. The short-lived session is the complement: a handful of turns, nothing past the recent window, often no logged line at all.

### Honest limits

What it cannot reduce: input history only. Output tokens (the model's answers), the per-request fixed payload (system prompt and tool definitions, plus the plugin's one hint line), and the number of requests are all invisible to it, and a session's cost floor is fixed overhead times request count.

Approximate accounting: characters over four is a proxy with tokenizer error in both directions, so eviction can start somewhat early or late; attachment payload characters count toward `bytesReclaimed` but not toward the estimate; tombstone and digest bytes add back weight the reclaim credit ignores. The log's numbers are directional, not billing-grade.

Reclamation is bounded by exemptions: the recent window, protected tools and patterns, the size floor, and already-tombstoned outputs all stay no matter the deficit. When the deficit exceeds what candidates can cover, eviction empties its list and stops short of the watermark: a context dominated by protected or sub-floor content cannot be trimmed to size.

The caching unknown: a prefix cache invalidates at the first changed message, every pass here mutates history, and eviction's coldest-first ordering targets the oldest messages, which is the deepest prefix. If the cached price sits far below the uncached one, both the dedup and eviction savings shrink, and aggressive trimming can forfeit more in lost cache hits than it recovers in bytes; the plugin sees no billing data and models no cache state. This is the design's largest unquantified risk.

Volatile state: the stash lives in the plugin's memory for the server process. A restart orphans stashed originals (`read_evicted` then returns the miss text), but the counters are not lost: the session's first transform or `read_evicted` hit after a restart rehydrates them from the session's live-state snapshot, or the newest metrics-log line for the session when no snapshot serves it (a miss cannot initiate hydration, it only awaits one already in flight; `lru_stats` alone neither creates nor rehydrates), so totals keep running across restarts. Three bounds remain: records written before `dedupedBytes` entered the totals seed zero for that one counter, a session with no surviving snapshot (`liveStateLog` off) whose log line has rotated out of the current generation, the `.1` sibling the seeder never reads, restarts its counters, and two processes resuming the same session each seed from the same base and count independently on top of it. A restart whose snapshot and line writes both failed resumes from the last record that did land. The metrics log survives restarts but keeps only the current and previous rotation generation. The memory bounds are deliberate, 50 (`stashLimit`) stash entries per session, 8 (`stashSessions`) sessions, 100 (`rememberedEvictedSubjects`) remembered evicted subjects, but real ceilings: the 51st eviction in one run drops the oldest stash entry, and that original becomes unrecoverable.

Second order under plan caps: where usage is capped at the plan level and dominated by fixed per-request overhead times request count, trimming the variable history share of long sessions is a second-order lever. The plugin earns its keep as cheap insurance for the sessions that do grow long (an extended session coordinating subagents, a long interactive run): one plugin, four source files, default-on, doing nothing at all to sessions that stay small. It is not a rate-limit fix; the first-order levers, fewer requests and shorter fixed payloads, live outside it.
