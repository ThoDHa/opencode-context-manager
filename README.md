# opencode-lru-context

An [opencode](https://opencode.ai) plugin that manages context windows with LRU eviction: it transforms chat requests to evict the least recently used tool outputs, reasoning blocks, duplicated attachments, and oversized fenced blocks, replaces evicted content with tombstones that can be restored through the `read_evicted` tool, reports live counters through `lru_stats`, and serves a `/lru` sidebar panel over the same data. [Installation](#installation) covers setup, updates, and removal.

## Contents

- [Installation](#installation)
  - [Requirements](#requirements)
  - [Install](#install)
  - [How it runs](#how-it-runs)
  - [Staying updated](#staying-updated)
  - [Manual install](#manual-install)
  - [Uninstall](#uninstall)
- [LRU Context Plugin Design](#lru-context-plugin-design)
  - [Why this plugin exists](#why-this-plugin-exists)
    - [Why it is needed](#why-it-is-needed)
    - [What exists today](#what-exists-today)
    - [Why the alternatives are not good enough](#why-the-alternatives-are-not-good-enough)
    - [Where this design is better, and where it is not](#where-this-design-is-better-and-where-it-is-not)
    - [The plugin landscape](#the-plugin-landscape)
  - [What the plugin does](#what-the-plugin-does)
    - [Budget resolution and token accounting](#budget-resolution-and-token-accounting)
    - [The no-loss passes](#the-no-loss-passes)
    - [Watermark eviction](#watermark-eviction)
    - [The stash and read_evicted](#the-stash-and-read_evicted)
    - [User-fence eviction](#user-fence-eviction)
    - [Manual mode](#manual-mode)
    - [Observability: the hint line, the metrics log, lru_stats, the panel](#observability-the-hint-line-the-metrics-log-lru_stats-the-panel)
  - [Why it works: the token economics](#why-it-works-the-token-economics)
    - [The re-send tax](#the-re-send-tax)
    - [Tier by tier](#tier-by-tier)
  - [When it fires and when it never does](#when-it-fires-and-when-it-never-does)
  - [Honest limits](#honest-limits)

## Installation

Installing the plugin means placing its three source files (`lru-context.ts`, `lru-context.tui.tsx`, `lru-panel-data.ts`) in `~/.config/opencode/plugin/`, the directory the `Makefile` calls opencode's plugin directory. The `Makefile` automates the placement with symlinks and reverses it cleanly.

### Requirements

- [opencode](https://opencode.ai), the host application: its sessions run the plugin, and its TUI serves the `/lru` panel
- git, to clone this repository and to pull later updates into it
- make, to run the `test`, `install`, and `uninstall` targets the `Makefile` defines
- node, to run the test suite, since `make test` invokes `node --test` over the plugin core suite (`tests/lru-context.test.ts`) and the panel data suite (`tests/lru-panel-data.test.ts`)

### Install

```sh
git clone https://github.com/ThoDHa/opencode-lru-context.git
cd opencode-lru-context
make test
make install
```

`make install` creates `~/.config/opencode/plugin/` when it is missing and symlinks the three plugin files into it. The install is idempotent: a rerun replaces existing symlinks in place. It never overwrites anything else: when a regular file or directory occupies a target path, the install aborts with an error naming the path, and the file must be removed by hand before the install can succeed.

### How it runs

The design section documents the loading in deployment terms: `opencode.json`'s `plugin` array names `./plugin/lru-context.ts`, and every opencode session, interactive and subagent alike, then runs the plugin; the three files that mechanism names are the same three the install links into place. In a session, the surfaces to check are the ones [What the plugin does](#what-the-plugin-does) documents: `lru_stats` reports the live counters, the `/lru` panel (the `lru.panel` command) renders the metrics log as a read-only view, and eventful runs append one line each to `~/.local/share/opencode/lru-metrics.jsonl`.

### Staying updated

The installed entries are symlinks into the clone, so an update is `git pull` in the repository: the links resolve into the working tree, and the code the plugin runs is whatever the pull left there. `make test` re-runs the two suites against the pulled tree.

### Manual install

On a machine without make, the same layout is a handful of commands from the repository root:

```sh
mkdir -p ~/.config/opencode/plugin
ln -sfn "$PWD/plugin/lru-context.ts" ~/.config/opencode/plugin/lru-context.ts
ln -sfn "$PWD/plugin/lru-context.tui.tsx" ~/.config/opencode/plugin/lru-context.tui.tsx
ln -sfn "$PWD/plugin/lru-panel-data.ts" ~/.config/opencode/plugin/lru-panel-data.ts
```

Copying the files instead of linking them works too, with one asymmetry: `make uninstall` removes only symlinks, so copies must be removed by hand as well.

### Uninstall

`make uninstall` removes the three plugin symlinks from `~/.config/opencode/plugin/`. Only symlinks are removed: a regular file left at a target path by a manual copy is untouched, and the repository checkout is unaffected.

## LRU Context Plugin Design

The LRU context manager is the plugin at `plugin/lru-context.ts`, with the TUI panel in `lru-context.tui.tsx` and the panel's data layer in `lru-panel-data.ts`. It hooks the transform opencode runs on the message list before every model call and trims what the provider is about to receive. This section argues for the plugin before documenting it: why it is needed, what the alternatives leave uncovered (built-ins and the third-party field alike), and where this design is better, then the mechanisms, the economics behind them, when each pass fires, and where the design does not hold. It is the end-to-end walkthrough with the alternatives, the economics, and the limits, in that order. The plugin mechanism claims here are pinned by `make test`, which runs the plugin core suite (`tests/lru-context.test.ts`) and the panel data suite (`tests/lru-panel-data.test.ts`); the comparison with the native alternatives, the economics, and the observed session below are argument and measurement, not test outputs.

### Why this plugin exists

#### Why it is needed

The stateless API re-sends the whole history on every request, per-request input grows monotonically, and cumulative consumption grows near-quadratically while the underlying content grows linearly. In the normal path nothing trims per turn, so growth continues until something reacts. The question a long session faces is not whether to pay for history, since that bill is unavoidable, but whether anything intervenes between steady accumulation and the context ceiling, and at what information cost. The economics section below puts numbers on this need.

#### What exists today

The entries below are opencode's built-in per-turn history mechanisms, grounded in opencode's config schema (https://opencode.ai/config.json); the schema also holds a same-family mechanism that acts earlier, at ingestion: `tool_output.max_lines` (default 2000) and `tool_output.max_bytes` (default 51200) truncate oversized tool output with the full text saved to disk and a preview returned, bounding what enters rather than acting on accumulated history. Doing nothing: the baseline the others are measured against, and the near-quadratic growth just described. Native compaction: the `compaction.auto` option defaults to true and fires, in the schema's words, "when context is full"; its retention knobs (`tail_turns`, `preserve_recent_tokens`, `reserved`) control how much recent conversation survives verbatim and how much window headroom the collapse reserves, and manual compaction is the on-demand form of the same mechanism (the one product-behavior clause here, grounded in the product's compaction command surface rather than the schema). A native prune: the `compaction.prune` option enables pruning of old tool outputs and defaults to false. Provider prompt caching: the schema's per-model cost model carries separate `cache_read` and `cache_write` prices, the industry's mechanism for making re-sent history cheaper rather than smaller. The third-party plugin field around these built-ins is the landscape section's subject at the end of the "Why this plugin exists" section.

#### Why the alternatives are not good enough

Each leaves the gap this plugin targets. Auto compaction is reactive at the ceiling: it fires only when context is full, so every token of the quadratic re-send has already been spent on the way up, and the intervention arrives as one large lossy event rather than continuous maintenance. Its retention knobs keep a recent slice verbatim; everything older is summarized, and summarization is lossy and irreversible, with no recovery path for dropped tool output. The prune toggle addresses old tool outputs directly but defaults to false, and its schema description mentions none of what this plugin builds around the same idea: no tiering by information value, no stash, no way back. Prompt caching is pricing relief, not trimming: the model still attends over the full context, and what a cache discount does to a plan-level usage quota is unknown; the honest-limits section returns to this as the design's largest unquantified risk. Doing nothing is the near-quadratic growth itself.

#### Where this design is better, and where it is not

The claims are proportional to the gap. This plugin maintains per turn, under a chosen watermark, instead of reacting once at full. It tiers by information value: zero-loss expiry and dedup run first on every turn, and the lossy step, eviction, runs last, only above the watermark, against candidates ordered by recency. What eviction removes is reversible through the stash and `read_evicted`, which neither compaction's summaries nor a flat prune offers. It is observable: the metrics log, the `/lru` panel, and `lru_stats` record what left and when; the schema's compaction options define no comparable surface. It is also complementary by construction: native auto compaction remains the overflow backstop the mechanisms below keep in place, so the plugin shrinks the sessions that would otherwise need frequent collapses rather than replacing the mechanism. Two admissions bound all of it. For sessions that never grow, the plugin is inert: the passes find nothing, and doing nothing is then the correct behavior. Against a provider that discounts cached prefixes heavily, trimming's benefit shrinks and can forfeit more in lost cache hits than it recovers in bytes, as the honest-limits section argues; the plugin does not model cache state and does not claim to. The sections that follow deliver the detail: the mechanisms, then the economics behind these claims, then when each pass fires, then the honest limits.

#### The plugin landscape

The built-ins above are half the field; this section surveys the other half (the third-party plugins and the upstream feature tracker) and records why none of it replaced this plugin, each rejection anchored to the design's commitments: deterministic (no LLM in the loop), lossless (stash and reload, nothing reduced to a summary), zero marginal token cost, and touch-based eviction rather than positional or model-chosen. It is dated evidence, checked against each project's public descriptions and repository metadata as of 2026-09-18 (the Sleev site facts as captured 2026-09-07), not a live benchmark, and one convergence is conceded before the rejections begin: the dedup and errored-input passes documented below were adopted from DCP's strategy set deliberately, so what follows is about everything beyond that shared layer.

Opencode's own levers were weighed above, and the prune deserves the fuller reading its binary allows since it is the closest cousin. Auto-compact and the manual `/compact` command collapse history through a summarization pass when context fills or the operator asks: reactive, one-shot, lossy, the exact shape the earlier sections argue against. The prune (`compaction.prune`, default false) swaps old tool outputs for `[Old tool result content cleared]` markers, and the 1.18.31 binary makes its positionality inspectable: the `SessionCompaction` module carries the positional heuristic's constants, `PRUNE_PROTECT` (40000) and `PRUNE_MINIMUM` (20000), with `skill` the lone protected tool and `OPENCODE_DISABLE_PRUNE` as the environment kill switch, while the config surface adds nothing beyond the toggle. Nothing in it asks whether the model still touches a subject, the marker names no subject, size, or recovery path, and the cleared original persists only in the local database with no tool the model could call to reach it, so the model cannot tell what it lost let alone reload it. This plugin targets the same content but decides by touch refresh, and its tombstone names the subject, the bytes, the digest, and the `read_evicted` pointer.

The strongest third-party entry is DCP (`Opencode-DCP/opencode-dynamic-context-pruning`, about 4.2k stars, AGPL-3.0): its core is a model-invoked `compress` tool that replaces closed, stale conversation spans with LLM-written technical summaries (`range` mode for contiguous spans, experimental `message` mode for single messages, earlier summaries nested inside newer ones rather than diluted), activated at the model's discretion under context-threshold nudges; around it run automatic strategies (deduplication keeping the newest output of repeated identical calls, errored-input purging after a configurable number of turns with the error text kept), protection surfaces (protected tool lists, `protectedFilePatterns` globs, optional fixed turn protection), and a `/dcp` TUI panel, and the README is explicit that session history is never modified, placeholders only stand in before requests. The strategies are the ancestors of two passes here, adopted on purpose; the host role fails on the commitments: each compress pass spends model tokens writing the summaries that replace the content, the model is the decision-maker for when and what to compress, the summary is the only carrier of a replaced span with no reload path back to the original (losslessness here means stash plus verbatim reload), and recency at most gates an optional fixed turn window rather than refreshing on use. DCP's own README also measures the cache trade-off this document flags as its largest unquantified risk (roughly 85 percent hit rate with pruning against 90 without), corroboration from the field, not comfort.

DCP's README states where its maintenance went: Sleev, a local proxy for Claude Code, Codex, and OpenCode that builds on DCP's core ideas; Sleev's own site describes compressing stale history through model-written summaries, claims about 65 percent average session reduction, and ships the product commercially with a free personal tier. Not adopted for the same cost model (summarization spends model tokens) and a different shape: an infrastructure dependency every request routes through, with an account surface, solving the cross-harness problem (one gateway, many harnesses) where this design's problem is one opencode install kept deterministic and dependency-free.

Two visible projects observe rather than trim. `IgorWarzocha/Opencode-Context-Analysis-Plugin` (about 180 stars, stale since 2025-10, no license, which alone bars code reuse) breaks token usage down across system prompts, user messages, assistant responses, tool outputs, and reasoning traces; `ttalkkak-lab/opencode-contexty` (AGPL-3.0) is a context-engineering suite built around visibility and supervision (a context explorer in a VSCode extension, prompt-stage architecture guidance, path-based permission management, terminal-log summarization) whose one trimming path is an embedded DCP configuration. Neither competes for this plugin's job: analysis without actuation duplicates from the outside what the metrics log and `/lru` panel already show from the inside, and contexty's actual pruning inherits DCP's model-in-the-loop cost while its supervision and permission surfaces answer questions this plugin does not ask.

The recovery family repairs compaction's failure modes instead of trimming: `viiqswim/opencode-compaction-guard` prevents and auto-recovers from the `tool_use without tool_result` error after a compaction or an interrupted tool call. It is not adopted because it guards the collapse path this design works to make rare: this plugin keeps native auto-compaction as the backstop precisely so the lossy collapse fires less often, and its own passes never sever a tool call from its result (dedup, purge, and eviction rewrite the inside of an existing tool part, never the pairing), so the guard's failure mode belongs to the built-in path, not this one; a second plugin to patch the fallback's error shape is weight this setup declines when the better lever is shrinking how often the fallback fires.

Upstream has been asked for both halves of this design and has shipped neither: issue #22407 requested pointer-based retrieval for compacted tool results, correctly noting the cleared output persists in the database with no way back, and the tracker's inactivity bot closed it as not planned with no maintainer response; issue #32189 requested context-aware, tool-type-aware pruning and truncation, drew a bot comment flagging possible duplicates, received the author's clarification, and closed without a maintainer reply. The requests describe this plugin's features nearly verbatim, a way back to cleared content being the stash and `read_evicted`, smarter-than-positional pruning being touch-based eviction, so the tracker is external evidence the gap is real and unfilled, recorded and closed rather than built.

The section closes on the honest ledger. Convergences: dedup of repeated identical calls and errored-input purging mirror DCP's deduplication and purge-errors strategies, adopted deliberately, implemented deterministically, and running every turn here rather than alongside a compress pass, and protection by tool name and glob exists in DCP too. Divergences, everywhere it matters: no pass here calls a model (ordering, digests, and tombstones are pure string work), nothing reduced to a summary is unrecoverable because nothing is reduced to a summary (evicted originals reload verbatim), trimming adds zero marginal token cost, and eviction follows touches rather than position or model judgment. The field's own trajectory (DCP slowing into a proxy successor, analysis tools observing rather than acting, recovery tools patching the native collapse, upstream requests closed without engagement) is this document's argument in evidence: the mechanisms exist here because nothing in the field ships them in this shape.

### What the plugin does

`opencode.json`'s `plugin` array names `./plugin/lru-context.ts`, so every opencode session runs the plugin: interactive sessions and subagent sessions alike. The surface is three hooks and two tools. The `chat.params` hook captures the session's context budget when the model is chosen. The `experimental.chat.messages.transform` hook rewrites the outgoing message list on every turn. The `experimental.chat.system.transform` hook delivers a one-line hint into the system prompt. The `read_evicted` tool reloads evicted content from the session stash, and `lru_stats` reports the live counters as JSON. The `/lru` TUI panel is a read-only view over the plugin's metrics log.

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

After the passes, the run counts post-eviction touches, records counters, stores the hint line for the next system-prompt build, and appends one metrics-log line when the run did anything at all.

#### Budget resolution and token accounting

Token accounting is approximate by design: text parts and completed tool outputs are sized in characters and divided by four, so the estimate carries tokenizer error but needs no tokenizer. The context budget resolves in a fixed order: a `modelContextTokens` option entry keyed `providerID/modelID` for the session's model, then the model's declared context limit from `chat.params` (accepted only when finite and positive), then an explicit `defaultContextTokens` option, then nothing. With no source the budget is unknown and eviction stands down entirely rather than inventing one; dedup, purge, expiry, fence eviction, and the hint still run, and opencode's native auto-compaction remains the overflow backstop for those sessions. The watermark is half the budget: the `watermark` ratio defaults to 0.5 and must lie strictly between 0 and 1, the `recentWindow` defaults to 4 messages, and `minEvictableBytes` defaults to 2048.

#### The no-loss passes

Tool-output dedup scans the message list newest first. A call's identity is the tool name plus a key-order-insensitive serialization of its input, so two calls differing only in JSON key order dedup. An older identical call's output becomes a `[lru-deduped]` tombstone naming the message holding the retained copy, and the superseded copy's `state.attachments` are stripped so the tombstoned part carries no media. The tombstone forms only when the retained copy itself clears the 2048-byte floor: a trivial newest output never erases a substantial older one. This pass has no recent-window guard and needs no budget; a duplicate is redundant wherever it sits. Marker-prefixed outputs are skipped on every later pass, so repeated transforms are idempotent and a dedup tombstone is never re-processed.

File-attachment dedup runs beside it. A `file` part (the `@`-reference surface, carrying `mime`, `url`, and an optional `filename`) whose `mime` and `url` both match a newer occurrence is replaced by a text tombstone; the key is content identity, so identical basenames in different directories never collapse, and the optional `filename` is display metadata only. The newest occurrence is always retained verbatim, occurrences inside the recent window are never tombstoned, and no size floor applies because a `file` part's payload size is not observable from its `url`.

The errored-input purge keeps a failed call's error output (often the only record of what went wrong) but replaces its recorded input, which can be large (a subagent session's initial prompt is one such shape), with `[lru-purged-input]` once the call ages out of the recent window. Reasoning expiry deletes `reasoning` parts from messages strictly older than the same window. The design wager is that reasoning from earlier turns has no consumers: the model that produced it already converted it into visible output, later turns never reference it, and the signature-carrying blocks an in-flight tool-use continuation needs sit inside the window by construction. Expiry is plain deletion with no stash, no tombstone, and no reload path, and it runs whether or not a budget is known. Both passes are counted separately from evictions (parts and bytes on `lru_stats` and in the metrics log) and never added back.

#### Watermark eviction

Every completed tool output of at least `minEvictableBytes` that is not already a tombstone is an evictable candidate with extracted subjects: file paths (with `offset`/`limit` ranges when present), grep and glob `pattern` strings, and bash command strings. A candidate's `lastTouch` starts at its own message index and refreshes forward to the index of any later call against the same subject: exact match for path subjects, substring containment for bash commands when the stored command exceeds three characters, and ranged and whole-path calls refresh each other. Eviction exempts outputs last touched inside the most recent `recentWindow` messages, the `task` and `todowrite` tools (the `protectedTools` default, overridable), subjects matched by the `protectedPatterns` glob list (a bash command is a subject whose path is the command, so the same globs guard commands), outputs under the floor, and anything already tombstoned.

Candidates sort coldest first: ascending `lastTouch`, ties broken by descending size. When the estimate exceeds the watermark, the plugin computes the deficit in tokens and walks the sorted list, replacing each output with a tombstone until the reclaimed estimate covers the deficit, then stops. A one-token overshoot therefore evicts exactly one output; wholesale clearing is not the shape. Only the evicted output's own bytes count toward the reclaim; tombstone and digest bytes stay in context and earn no credit, so the log's `bytesReclaimed` never overstates what left.

A tombstone reads, in one line: `[lru-evicted] <tool> <subject> (<bytes> bytes[, attachments dropped], ~<age> messages ago) was evicted to reclaim context; re-run the tool to reload its output. Output digest: <digest>. Evicted output stashed; reload it with read_evicted (subject "<subject>").` The subject renders to a single line capped at 160 characters. The digest is derived at eviction time from the stashed content with no LLM involvement: `read` outputs contribute the subject plus previews of the first and last lines, `bash` outputs the command plus head and tail lines, every other tool a bounded excerpt of the output head; newlines collapse and the whole digest caps at 200 characters. The derivation is pure string work, so identical content always yields an identical digest. Attachments leave with the output: a completed tool part can carry a `state.attachments` array (observed with `read` returning images), and an evicted part loses that array entirely, its tombstone gaining an `attachments dropped` clause.

#### The stash and read_evicted

Eviction does not destroy. Each evicted output enters a per-session in-memory stash: 50 entries per session with the oldest dropped, 8 sessions retained with the least recently active session evicted first. `read_evicted` returns the stashed original named by subject, passed exactly as the tombstone names it: the newest match in full, with one-line pointers to any older matches of the same subject. A subject with nothing stashed returns a miss message stating that only outputs evicted during this session are stashed. A hit refreshes the session's stash against the 8-session bound; a miss probe and an `lru_stats` call do not, so idle sessions' stashes age out first. Fence evictions share the same stash and bound. Reload cannot re-serve binary attachments: the tool returns a string, and re-serving megabyte data URIs would re-inflate the context eviction just reclaimed, so the stash keeps the originals but the reload appends a manifest line naming each attachment's mime and data-URI length and advises re-running the original tool to regenerate them.

#### User-fence eviction

Fence eviction is the one pass that edits user prose, so it ships default-off behind `userFenceEviction` (`{ enabled: false, minBlockLines: 40 }` when unset). When enabled, it scans the text parts of user messages outside the recent window for fenced code blocks under CommonMark fence rules: an opener is at least three backticks after at most three spaces of indent (four or more spaces is indented code, never a fence, and a line whose info string holds a backtick is content that never opens a block), the closer needs at least as many backticks as the opener, an unterminated block is never touched however large it has grown, and an all-blank block is never evicted since it names nothing and reclaims almost nothing. A closed block whose content spans strictly more than `minBlockLines` lines becomes a `[lru-evicted-fence]` tombstone naming the language tag (the first word of the info string when present), the content line count, and the first non-empty content line as the reload subject; the prose before, between, and after the fences is preserved byte for byte. The exact removed span enters the session stash, so `read_evicted` restores it verbatim. The pass runs before the budget decision, so fence bytes lower the estimate and can spare tool outputs an eviction.

#### Manual mode

The `manualMode` option (default false) suspends only budget-driven eviction, turning the unknown-budget stand-down into a choice: with it set, the transform measures and reports (the estimate appears in `lru_stats` and the metrics log with null watermark and deficit) but writes no `[lru-evicted]` tombstones even under pressure. Dedup, purge, expiry, fence eviction, the hint, the stash, and both tools keep running. A non-boolean value falls back to false, keeping eviction active. The purpose is isolation: debugging or demonstrating the eviction effect without changing anything else.

#### Observability: the hint line, the metrics log, lru_stats, the panel

After each run the plugin stores a `[lru-hot] recently active: ...` line naming up to ten (`hintSubjects`) most recently touched live subjects, newest first; the system-prompt hook appends it or replaces the previous one in place. The hint is the working-set summary that makes tombstones navigable: after eviction the model can see which files and commands are warm without re-reading them.

The metrics log is on by default and appends to `~/.local/share/opencode/lru-metrics.jsonl` (`metricsPath` relocates it). Every eventful run appends one JSON line: eventful means at least one eviction, dedup tombstone, expired reasoning part, fence eviction, or post-eviction touch in the run, or any stash read since the previous line. Quiet runs write nothing, so the log's silence is the record of a session that needed nothing. Each line carries a timestamp, the session id, the budget in effect with its source (`override`, `model`, `default`, or `unknown`), the run's estimate against watermark and deficit, per-entry eviction records (tool, subject, bytes, attachment bytes, age in messages), the run's dedup, expiry, fence, and post-eviction-touch counts, stash reads since the previous line, and the session's running totals. `bytesReclaimed` counts evicted output and attachment data-URI characters plus fence-block bytes; dedup and expiry removals are excluded (dedup is count-only, expiry bytes go to `reasoningBytesExpired`, and purged inputs count nowhere). Size is bounded by the `metricsRotationMaxBytes` option (default 5 MiB, `0` disables): before each append the plugin stats the file, and when the line would push it past the cap the current file is renamed to `<metricsPath>.1`, replacing any prior `.1`, and the append starts a fresh file, so only the current and previous generations exist and anything older is gone for good. Below the cap nothing changes: the same bytes are appended. A failed stat, rename, or append never interrupts the session; the error surfaces through `lru_stats` as `logWriteError`.

A post-eviction touch is the design's feedback signal: when a later call re-references a subject the plugin evicted, the run counts one touch, so the rate at which eviction guesses wrong is measurable rather than assumed.

`lru_stats` returns the resolved options, the effective budget with its source, stash occupancy and capacity, every counter, and the last run's estimate, watermark, and deficit. It is the surface that answers "what did the plugin do to this session". The `/lru` panel (registered by `lru-context.tui.tsx` as the `lru.panel` command) renders the same story from the metrics log: every line comes from `panelRows` in `lru-panel-data.ts`, so the exact text is unit-tested without a terminal. Opening the panel reads the log anew each time, filters to the TUI route's session, and shows the budget with its source, the last run against the watermark, the session's cumulative counters, the newest evictions capped at eight, and a history line: sessions and runs count every parsed line in the whole log, which spans the log's entire lifetime with rotation disabled and only the current rotation generation with rotation enabled, since pre-rotation lines leave panel history permanently when their file rotates away. Degradation is explicit: opening outside a session renders "no active session", a session with no runs renders "no metrics recorded for this session yet", malformed lines are skipped at parse, and an unreadable log collapses the panel to a header and a warning row.

### Why it works: the token economics

#### The re-send tax

Chat APIs are stateless: the provider keeps nothing between requests, so every request re-sends the conversation so far. Per-request input therefore grows monotonically through a session: each turn appends messages, and in the normal path nothing removes them; opencode's auto-compaction is the overflow backstop, not a per-turn trimmer. Suppose a session adds roughly c tokens of new content per turn. Request n then carries about n times c input tokens, and a session of N turns bills about c times N squared over 2 input tokens in total: quadratic in session length, for content that grew only linearly. The overhead multiple (billed input over content) is about N over 2: a 60-turn session bills roughly thirty times the content's worth, almost all of it repeated history. Nothing about the model's answers requires this re-payment: most of the re-sent history is settled context the model will not touch again.

#### Tier by tier

The passes form three tiers of increasing aggression, each with an explicit information trade.

Tier zero removes dead weight at no loss. Reasoning expiry and the errored-input purge delete content with no remaining consumer: expired reasoning was already converted into the visible output that replaced it, and a purged failed-call input sits beside the error text that actually matters. No recovery path exists because nothing of value is lost. These passes fire every turn regardless of budget, and they are why a long session's metrics show most of its reclamation happening before any eviction.

Tier one removes pure redundancy at no loss. Dedup tombstones an older output fully duplicated by the retained newest copy of an identical call or identical attachment. The information survives verbatim in the retained copy, so the trade is exactly zero-loss; the floor (the retained copy must clear 2048 bytes) keeps trivial outputs from erasing substantial ones.

Tier two trades old tool outputs for small references. Above the watermark, a tombstone carries the tool, subject, size, age, a 200-character digest, and a reload pointer: enough to answer "was this file read, and what did its first line say" without a reload, not enough to substitute for the content. The full original moves to the stash, one `read_evicted` call away, so the loss is a latency and round-trip cost, not deletion; recovery is exact for tool outputs, with binary attachments the exception (a manifest advises a re-run). LRU ordering with touch refresh approximates what the model still needs: a later call against the same subject makes the older output hot again, and the recent window, the protected tools (`task` outputs carry a subagent session's report and `todowrite` outputs carry plan state, both expensive to reconstruct), and the pattern exemptions bound what may leave.

In aggregate: under the watermark the plugin applies only the no-loss tiers and per-request cost still grows with history. Above the watermark, eviction pins per-request input near the watermark (each run trims just far enough to fall back under) instead of letting it grow with history, and the session's cumulative input falls from quadratic in N toward linear in N. That conversion, on top of the zero-loss tiers, is the entire economic argument.

### When it fires and when it never does

The zero-loss passes fire on pattern presence alone: a reasoning part aging past message index length minus `recentWindow`, an identical call repeating, a failed call aging out. No budget is needed. Budget-driven eviction needs all three of a known budget, an estimate above half of it, and an evictable candidate outside the exemptions; missing any one yields zero evictions by design, and `lru_stats` distinguishes the stand-downs (unknown budget: the budget itself is null; manual mode: the budget is populated while the last run's watermark and deficit are null by choice).

A single observed long-running session illustrates the intended shape (one session's final metrics line, not a benchmark): 954 reasoning parts expired, about 3.18 MB of reasoning text reclaimed, zero evictions, zero dedup tombstones, with the token estimate near 52k against a 500k-token watermark. Expiry had carried the session entirely, which is what a long tool-heavy session looks like from the inside: every turn that delegates work to a subagent leaves a reasoning block, the blocks accumulate into hundreds, and they all age out of the four-message window long before the estimate approaches the watermark. The complementary shape is the short-lived session: a handful of turns, nothing past the recent window, no duplicates, often no logged line at all. Long sessions trigger expiry first; the watermark engages only at scale.

### Honest limits

What it cannot reduce. The plugin trims input history only. Output tokens (the model's answers), the per-request fixed payload (system prompt and tool definitions, to which the plugin's own hint adds its one line), and the number of requests are all invisible to it. A session's cost floor is fixed overhead times request count, and the plugin touches neither factor.

Approximate accounting. Characters over four is a proxy with tokenizer error in both directions, so eviction can start somewhat early or late against a real tokenizer. Attachment payload characters count toward `bytesReclaimed` but not toward the estimate, so a heavy attachment over-delivers its share of the deficit. Tombstone and digest bytes add back weight the reclaim credit ignores. The log's numbers are directional, not billing-grade.

Reclamation is bounded by exemptions. The recent window, protected tools and patterns, the size floor, and already-tombstoned outputs all stay no matter the deficit. When the deficit exceeds what candidates can cover, eviction empties its list and stops short of the watermark: a context dominated by protected or sub-floor content cannot be trimmed to size.

The caching unknown. Providers increasingly discount cached prefix tokens, and a prefix cache invalidates at the first changed message. Every pass here mutates history: tombstone substitutions and part deletions land in old messages, and eviction's coldest-first ordering targets the oldest messages, which is the deepest prefix. If the provider's cached price sits far below the uncached one, both the dedup and eviction savings shrink, and aggressive trimming can forfeit more in lost cache hits than it recovers in bytes. The plugin sees no billing data and makes no attempt to model cache state, so whether pruning nets positive depends on prices the operator knows and the plugin does not. This is the design's largest unquantified risk.

Volatile state. The stash and every counter live in the plugin's memory for the server process. A restart orphans stashed originals (`read_evicted` then returns the miss text) and resets in-memory totals; the metrics log survives but keeps only the current and previous rotation generation, so pre-rotation lines are gone for good. The memory bounds are deliberate (50 stash entries per session, 8 sessions, 100 remembered evicted subjects) so the plugin cannot grow unbounded, but they are real ceilings: the 51st eviction in one run drops the oldest stash entry, and that original becomes unrecoverable.

Second order under plan caps. Where usage is capped at the plan level and dominated by fixed per-request overhead times request count, trimming the variable history share of long sessions is a second-order lever. The plugin earns its keep as insurance for the sessions that do grow long (an extended session coordinating subagents, a long interactive run), and as cheap insurance: one plugin, three source files, default-on, doing nothing at all to sessions that stay small. It is not a rate-limit fix; the first-order levers, fewer requests and shorter fixed payloads, live outside it.
