# opencode-lru-context

An [opencode](https://opencode.ai) plugin that manages context windows with
LRU eviction: it transforms chat requests to evict the least recently used
tool outputs, reasoning blocks, duplicated attachments, and oversized fenced
blocks, replaces evicted content with tombstones that can be restored through
the `read_evicted` tool, reports live counters through `lru_stats`, and serves
a `/lru` sidebar panel over the same data. The full architecture, protocol,
and operational notes live in [DESIGN.md](DESIGN.md); run `make test` for the
test suite and `make install` to symlink the plugin files into
`~/.config/opencode/plugin/`.
