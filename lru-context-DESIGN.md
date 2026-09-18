# LRU Context Plugin Design

The LRU context manager is the opencode plugin at
`.config/opencode/plugin/lru-context.ts`, with the TUI panel in
`lru-context.tui.tsx` and the panel's data layer in `lru-panel-data.ts`.
It hooks the transform opencode runs on the message list before every
model call and trims what the provider is about to receive. This note
documents what the plugin does, how each mechanism works, why the design
pays for itself in tokens, and where it does not. `DESIGN.md` beside
this file records the mechanisms as built and carries the deployment
notes; this note is the end-to-end walkthrough with the economics and
the limits in front. The plugin mechanism claims here are pinned by
`make test-plugin`, which runs 249 tests (218 over the plugin core in
`tests/opencode/lru-context.test.ts`, 31 over the panel data layer in
`tests/opencode/lru-panel-data.test.ts`); the economics and the
observed session below are argument and measurement, not test outputs.
Keeping the two documents in sync is a maintenance rule: a plugin
change updates both this note and DESIGN.md's LRU regions.

## What the plugin does

`opencode.json`'s `plugin` array names `./plugin/lru-context.ts`, so
every session runs the plugin: the manager's session and every
dispatched subagent alike. The surface is three hooks and two tools.
The `chat.params` hook captures the session's context budget when the
model is chosen. The `experimental.chat.messages.transform` hook
rewrites the outgoing message list on every turn. The
`experimental.chat.system.transform` hook delivers a one-line hint into
the system prompt. The `read_evicted` tool reloads evicted content from
the session stash, and `lru_stats` reports the live counters as JSON.
The `/lru` TUI panel is a read-only view over the plugin's metrics log.

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

After the passes, the run counts post-eviction touches, records
counters, stores the hint line for the next system-prompt build, and
appends one metrics-log line when the run did anything at all.

### Budget resolution and token accounting

Token accounting is approximate by design: text parts and completed tool
outputs are sized in characters and divided by four, so the estimate
carries tokenizer error but needs no tokenizer. The context budget
resolves in a fixed order: a `modelContextTokens` option entry keyed
`providerID/modelID` for the session's model, then the model's declared
context limit from `chat.params` (accepted only when finite and
positive), then an explicit `defaultContextTokens` option, then nothing.
With no source the budget is unknown and eviction stands down entirely
rather than inventing one; dedup, purge, expiry, fence eviction, and the
hint still run, and opencode's native auto-compaction remains the
overflow backstop for
those sessions. The watermark is half the budget: the `watermark` ratio
defaults to 0.5 and must lie strictly between 0 and 1, the
`recentWindow` defaults to 4 messages, and `minEvictableBytes` defaults
to 2048.

### The no-loss passes

Tool-output dedup scans the message list newest first. A call's identity
is the tool name plus a key-order-insensitive serialization of its
input, so two calls differing only in JSON key order dedup. An older
identical call's output becomes a `[lru-deduped]` tombstone naming the
message holding the retained copy, and the superseded copy's
`state.attachments` are stripped so the tombstoned part carries no
media. The tombstone forms only when the retained copy itself clears the
2048-byte floor: a trivial newest output never erases a substantial
older one. This pass has no recent-window guard and needs no budget; a
duplicate is redundant wherever it sits. Marker-prefixed outputs are
skipped on every later pass, so repeated transforms are idempotent and a
dedup tombstone is never re-processed.

File-attachment dedup runs beside it. A `file` part (the `@`-reference
surface, carrying `mime`, `url`, and an optional `filename`) whose
`mime` and `url` both match a newer occurrence is replaced by a text
tombstone; the key is content identity, so identical basenames in
different directories never collapse, and the optional `filename` is
display metadata only. The newest occurrence is always retained
verbatim, occurrences inside the recent window are never tombstoned, and
no size floor applies because a `file` part's payload size is not
observable from its `url`.

The errored-input purge keeps a failed call's error output (often the
only record of what went wrong) but replaces its recorded input, which
for a subagent dispatch can be a large prompt, with `[lru-purged-input]`
once the call ages out of the recent window. Reasoning expiry deletes
`reasoning` parts from messages strictly older than the same window.
The design wager is that reasoning from earlier turns has no consumers:
the model that produced it already converted it into visible output,
later turns never reference it, and the signature-carrying blocks an
in-flight tool-use continuation needs sit inside the window by
construction. Expiry is plain deletion with no stash, no tombstone, and
no reload path, and it runs whether or not a budget is known. Both
passes are counted separately from evictions (parts and bytes on
`lru_stats` and in the metrics log) and never added back.

### Watermark eviction

Every completed tool output of at least `minEvictableBytes` that is not
already a tombstone is an evictable candidate with extracted subjects:
file paths (with `offset`/`limit` ranges when present), grep and glob
`pattern` strings, and bash command strings. A candidate's `lastTouch`
starts at its own message index and refreshes forward to the index of
any later call against the same subject: exact match for path subjects,
substring containment for bash commands when the stored command exceeds
three characters, and ranged and whole-path calls refresh each other.
Eviction exempts outputs last touched inside the most recent
`recentWindow` messages, the `task` and `todowrite` tools (the
`protectedTools` default, overridable), subjects matched by the
`protectedPatterns` glob list (a bash command is a subject whose path is
the command, so the same globs guard commands), outputs under the floor,
and anything already tombstoned.

Candidates sort coldest first: ascending `lastTouch`, ties broken by
descending size. When the estimate exceeds the watermark, the plugin
computes the deficit in tokens and walks the sorted list, replacing each
output with a tombstone until the reclaimed estimate covers the deficit,
then stops. A one-token overshoot therefore evicts exactly one output;
wholesale clearing is not the shape. Only the evicted output's own bytes
count toward the reclaim; tombstone and digest bytes stay in context and
earn no credit, so the log's `bytesReclaimed` never overstates what left.

A tombstone reads, in one line: `[lru-evicted] <tool> <subject> (<bytes>
bytes[, attachments dropped], ~<age> messages ago) was evicted to
reclaim context; re-run the tool to reload its output. Output digest:
<digest>. Evicted output stashed; reload it with read_evicted (subject
"<subject>").` The subject renders to a single line capped at 160
characters. The digest is derived at eviction time from the stashed
content with no LLM involvement: `read` outputs contribute the subject
plus previews of the first and last lines, `bash` outputs the command
plus head and tail lines, every other tool a bounded excerpt of the
output head; newlines collapse and the whole digest caps at 200
characters. The derivation is pure string work, so identical content
always yields an identical digest. Attachments leave with the output: a
completed tool part can carry a `state.attachments` array (observed with
`read` returning images), and an evicted part loses that array entirely,
its tombstone gaining an `attachments dropped` clause.

### The stash and read_evicted

Eviction does not destroy. Each evicted output enters a per-session
in-memory stash: 50 entries per session with the oldest dropped, 8
sessions retained with the least recently active session evicted first.
`read_evicted` returns the stashed original named by subject, passed
exactly as the tombstone names it: the newest match in full, with
one-line pointers to any older matches of the same subject. A subject
with nothing stashed returns a miss message stating that only outputs
evicted during this session are stashed. A hit refreshes the session's
stash against the 8-session bound; a miss probe and an `lru_stats` call
do not, so idle sessions' stashes age out first. Fence evictions share
the same stash and bound. Reload cannot re-serve binary attachments: the
tool returns a string, and re-serving megabyte data URIs would re-inflate
the context eviction just reclaimed, so the stash keeps the originals
but the reload appends a manifest line naming each attachment's mime and
data-URI length and advises re-running the original tool to regenerate
them.

### User-fence eviction

Fence eviction is the one pass that edits user prose, so it ships
default-off behind `userFenceEviction` (`{ enabled: false,
minBlockLines: 40 }` when unset). When enabled, it scans the text parts
of user messages outside the recent window for fenced code blocks under
CommonMark fence rules: an opener is at least three backticks after at
most three spaces of indent (four or more spaces is indented code,
never a fence), the closer needs at least as many backticks as the
opener, an unterminated block is never touched however large it has
grown, and an all-blank block is never evicted since it names nothing
and reclaims almost nothing. A closed block whose content spans strictly
more than `minBlockLines` lines becomes a `[lru-evicted-fence]`
tombstone naming the language tag (the first word of the info string
when present), the content line count, and the first non-empty content
line as the reload subject; the prose before, between, and after the
fences is preserved byte for byte. The exact removed span enters the
session stash, so `read_evicted` restores it verbatim. The pass runs
before the budget decision, so fence bytes lower the estimate and can
spare tool outputs an eviction.

### Manual mode

The `manualMode` option (default false) suspends only budget-driven
eviction, turning the unknown-budget stand-down into a choice: with it
set, the transform measures and reports (the estimate appears in
`lru_stats` and the metrics log with null watermark and deficit) but
writes no `[lru-evicted]` tombstones even under pressure. Dedup, purge,
expiry, fence eviction, the hint, the stash, and both tools keep
running. A non-boolean value falls back to false, keeping eviction
active. The purpose is isolation: debugging or demonstrating the
eviction effect without changing anything else.

### Observability: the hint line, the metrics log, lru_stats, the panel

After each run the plugin stores a `[lru-hot] recently active: ...`
line naming up to ten (`hintSubjects`) most recently touched live
subjects, newest first; the system-prompt hook appends it or replaces
the previous one in place. The hint is the working-set summary that
makes tombstones navigable: after eviction the model can see which files
and commands are warm without re-reading them.

The metrics log is on by default and appends to
`~/.local/share/opencode/lru-metrics.jsonl` (`metricsPath` relocates
it). Every eventful run appends one JSON line: eventful means at least
one eviction, dedup tombstone, expired reasoning part, fence eviction,
or post-eviction touch in the run, or any stash read since the previous
line. Quiet runs write nothing, so the log's silence is the record of a
session that needed nothing. Each line carries a timestamp, the session
id, the budget in effect with its source (`override`, `model`,
`default`, or `unknown`), the run's estimate against watermark and
deficit, per-entry eviction records (tool, subject, bytes, attachment
bytes, age in messages), the run's dedup, expiry, fence, and
post-eviction-touch counts, stash reads since the previous line, and the
session's running totals. `bytesReclaimed` counts evicted output and
attachment data-URI characters plus fence-block bytes; dedup and expiry
removals are excluded (dedup is count-only, expiry bytes go to
`reasoningBytesExpired`, and purged inputs count nowhere). Size is
bounded by the `metricsRotationMaxBytes` option
(default 5 MiB, `0` disables): before each append the plugin stats the
file, and when the line would push it past the cap the current file is
renamed to `<metricsPath>.1`, replacing any prior `.1`, and the append
starts a fresh file, so only the current and previous generations exist
and anything older is gone for good. Below the cap nothing changes: the
same bytes are appended. A failed stat, rename, or append never
interrupts the session; the error surfaces through `lru_stats` as
`logWriteError`.

A post-eviction touch is the design's feedback signal: when a later call
re-references a subject the plugin evicted, the run counts one touch, so
the rate at which eviction guesses wrong is measurable rather than
assumed.

`lru_stats` returns the resolved options, the effective budget with its
source, stash occupancy and capacity, every counter, and the last run's
estimate, watermark, and deficit. It is the surface that answers "what
did the plugin do to this session". The `/lru` panel (registered by
`lru-context.tui.tsx` as the `lru.panel` command) renders the same story
from the metrics log: every line comes from `panelRows` in
`lru-panel-data.ts`, so the exact text is unit-tested without a
terminal. Opening the panel reads the log anew each time, filters to the
TUI route's session, and shows the budget with its source, the last run
against the watermark, the session's cumulative counters, the newest
evictions capped at eight, and a history line: sessions and runs count
every parsed line in the whole log, which spans the log's entire
lifetime with rotation disabled and only the current rotation generation
with rotation enabled, since pre-rotation lines leave panel history
permanently when their file rotates away.
Degradation is explicit: opening outside a session renders "no active
session", a session with no runs renders "no metrics recorded for this
session yet", malformed lines are skipped at parse, and an unreadable
log collapses the panel to a header and a warning row.

## Why it works: the token economics

### The re-send tax

Chat APIs are stateless: the provider keeps nothing between requests, so
every request re-sends the conversation so far. Per-request input
therefore grows monotonically through a session: each turn appends
messages, and in the normal path nothing removes them; opencode's
auto-compaction is the overflow backstop, not a per-turn trimmer.
Suppose a
session adds roughly c tokens of new content per turn. Request n then
carries about n times c input tokens, and a session of N turns bills
about c times N squared over 2 input tokens in total: quadratic in
session length, for content that grew only linearly. The overhead
multiple (billed input over content) is about N over 2: a 60-turn
session bills roughly thirty times the content's worth, almost all of it
repeated history. Nothing about the model's answers requires this
re-payment:
most of the re-sent history is settled context the model will not touch
again.

### Tier by tier

The passes form three tiers of increasing aggression, each with an
explicit information trade.

Tier zero removes dead weight at no loss. Reasoning expiry and the
errored-input purge delete content with no remaining consumer: expired
reasoning was already converted into the visible output that replaced
it, and a purged failed-call input sits beside the error text that
actually matters. No recovery path exists because nothing of value is
lost. These passes fire every turn regardless of budget, and they are
why a long session's metrics show most of its reclamation happening
before any eviction.

Tier one removes pure redundancy at no loss. Dedup tombstones an older
output fully duplicated by the retained newest copy of an identical call
or identical attachment. The information survives verbatim in the
retained copy, so the trade is exactly zero-loss; the floor (the
retained copy must clear 2048 bytes) keeps trivial outputs from erasing
substantial ones.

Tier two trades old tool outputs for small references. Above the
watermark, a tombstone carries the tool, subject, size, age, a
200-character digest, and a reload pointer: enough to answer "was this
file read, and what did its first line say" without a reload, not enough
to substitute for the content. The full original moves to the stash, one
`read_evicted` call away, so the loss is a latency and round-trip cost,
not deletion; recovery is exact for tool outputs, with binary
attachments the exception (a manifest advises a re-run). LRU ordering
with touch refresh approximates what the model still needs: a later call
against the same subject makes the older output hot again, and the
recent window, the protected tools (`task` outputs are subagent reports
and `todowrite` outputs are plan state, both expensive to reconstruct),
and the pattern exemptions bound what may leave.

In aggregate: under the watermark the plugin applies only the no-loss
tiers and per-request cost still grows with history. Above the
watermark, eviction pins per-request input near the watermark (each run
trims just far enough to fall back under) instead of letting it grow
with history, and the session's cumulative input falls from quadratic in
N toward linear in N. That conversion, on top of the zero-loss tiers, is
the entire economic argument.

## When it fires and when it never does

The zero-loss passes fire on pattern presence alone: a reasoning part
aging past message index length minus `recentWindow`, an identical call
repeating, a failed call aging out. No budget is needed. Budget-driven
eviction needs all three of a known budget, an estimate above half of
it, and an evictable candidate outside the exemptions; missing any one
yields zero evictions by design, and `lru_stats` distinguishes the
stand-downs (unknown budget: the budget itself is null; manual mode: the
budget is populated while the last run's watermark and deficit are null
by choice).

A single observed manager session illustrates the intended shape (one
session's final metrics line, not a benchmark): 954 reasoning parts
expired, about 3.18 MB of reasoning text reclaimed, zero evictions, zero
dedup tombstones, with the token estimate near 52k against a 500k-token
watermark. Expiry had carried the session entirely, which is what a long
orchestration session looks like from the inside: every dispatched
subagent turn leaves a reasoning block, the blocks accumulate into
hundreds, and they all age out of the four-message window long before
the estimate approaches the watermark. The complementary shape is the
short-lived dispatch session: a handful of turns, nothing past the
recent window, no duplicates, often no logged line at all. Long sessions
trigger expiry first; the watermark engages only at scale.

## Honest limits

What it cannot reduce. The plugin trims input history only. Output
tokens (the model's answers), the per-request fixed payload (system
prompt and tool definitions, to which the plugin's own hint adds its one
line), and the number of requests are all invisible to it. A session's
cost floor is fixed overhead times request count, and the plugin touches
neither factor.

Approximate accounting. Characters over four is a proxy with tokenizer
error in both directions, so eviction can start somewhat early or late
against a real tokenizer. Attachment payload characters count toward
`bytesReclaimed` but not toward the estimate, so a heavy attachment
over-delivers its share of the deficit. Tombstone and digest bytes add
back weight the reclaim credit ignores. The log's numbers are
directional, not billing-grade.

Reclamation is bounded by exemptions. The recent window, protected tools
and patterns, the size floor, and already-tombstoned outputs all stay no
matter the deficit. When the deficit exceeds what candidates can cover,
eviction empties its list and stops short of the watermark: a context
dominated by protected or sub-floor content cannot be trimmed to size.

The caching unknown. Providers increasingly discount cached prefix
tokens, and a prefix cache invalidates at the first changed message.
Every pass here mutates history: tombstone substitutions and part
deletions land in old messages, and eviction's coldest-first ordering
targets the oldest messages, which is the deepest prefix. If the
provider's cached price sits far below the uncached one, both the dedup
and eviction savings shrink, and aggressive trimming can forfeit more in
lost cache hits than it recovers in bytes. The plugin sees no billing
data and makes no attempt to model cache state, so whether pruning nets
positive depends on prices the operator knows and the plugin does not.
This is the design's largest unquantified risk.

Volatile state. The stash and every counter live in the plugin's memory
for the server process. A restart orphans stashed originals
(`read_evicted` then returns the miss text) and resets in-memory totals;
the metrics log survives but keeps only the current and previous
rotation generation, so pre-rotation lines are gone for good. The memory
bounds are
deliberate (50 stash entries per session, 8 sessions, 100 remembered
evicted subjects) so the plugin cannot grow unbounded, but they are real
ceilings: the 51st eviction in one run drops the oldest stash entry, and
that original becomes unrecoverable.

Second order under plan caps. Where usage is capped at the plan level
and dominated by fixed per-request overhead times dispatch count,
trimming the variable history share of long sessions is a second-order
lever. The plugin earns its keep as insurance for the sessions that do
grow long (a manager session orchestrating a fleet, an extended
interactive run), and as cheap insurance: one plugin file, default-on,
doing nothing at all to sessions that stay small. It is not a rate-limit
fix; the first-order levers, fewer dispatches and shorter fixed
payloads, live outside it.
