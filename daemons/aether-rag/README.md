# aether-rag — retrieval over Aether's own corpus

A standalone spike that proves **retrieval quality** over Aether's own
documentation *before* any MCP wrapping. No mesh, no MCP, no imports from
repo code — just `corpus → chunks → embeddings → KNN`, with a human-judged
eval harness on top. If retrieval over our own docs is good here, the same
core is worth wrapping as a mesh node later. If it isn't, we learn that
cheaply now.

## Stack (locked)

- **[fastembed](https://github.com/qdrant/fastembed)** for embeddings —
  ONNX runtime, **no torch**. Model: `BAAI/bge-small-en-v1.5` (384-dim).
  The ONNX weights (~130 MB) download into the fastembed cache on the first
  index; they are not vendored.
- **[sqlite-vec](https://github.com/asg017/sqlite-vec)** for the store — a
  loadable SQLite extension (`vec0` virtual table, cosine distance). No
  server, no separate vector database.

Both are pinned in [`requirements.txt`](./requirements.txt).

## Corpus

Indexed globs (resolved against the repo root):

| Glob | What it is |
|---|---|
| `docs/governance-log.md` | Hard-won gotchas + sprint lessons (`###`-structured) |
| `docs/rebase-playbook.md` | The rebase oral law (`##`-per-rule) |
| `DECISIONS.md` | Append-only ADRs (`##`-dated entries) |
| `CHANGELOG.md` | Keep-a-Changelog history |
| `CLAUDE.md` | Operating manual (note: a copy lives at repo root too) |
| `docs/scene-protocol.md` | Scene panel contract |
| `docs/releases/*.md` | Per-release narratives |
| `docs/README.md` | Documentation index |
| `README.md` | Repo front page |
| `nodes/*/README.md` | Per-node docs |
| `manifest.yaml` | Mesh manifest (chunked **per node**) |

The exact list lives in `CORPUS_GLOBS` in [`rag_lib.py`](./rag_lib.py); edit
it there.

## Chunking

Heading-aware, so a retrieved passage maps back to a real section:

- **Markdown** splits at every `##` and `###` boundary. Content before the
  first heading is an `(intro)` chunk. Each chunk carries a breadcrumb anchor
  (`Hard Gotchas > Electron / macOS`) that is also prepended to the embedded
  text, so even the inner window of a split section keeps its heading context.
  Headings inside fenced code blocks are ignored.
- **`manifest.yaml`** splits **per node** (one chunk per `- id:` block under
  `nodes:`), plus a `manifest header` chunk and a `relationships` chunk.
- **Oversize sections** (> ~512 tokens, the model's hard max) are windowed
  with overlap rather than silently truncated. Token count is a word-based
  heuristic — no tokenizer dependency.

Every chunk stores its `source` path, `anchor` (heading breadcrumb), and
`start_line`–`end_line` span so results are traceable to the source.

## Setup

```bash
cd daemons/aether-rag
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Reindex

Wipe and rebuild (idempotent — safe to re-run):

```bash
./reindex.sh
```

Prints per-file chunk counts and the doc/chunk totals. The first run also
downloads the embedding model.

## Query

```bash
.venv/bin/python query.py "How do we resolve CHANGELOG conflicts?" -k 5
```

Returns the top-k passages with a **cosine-similarity score** (higher =
closer), the `source:start-end` location, the heading breadcrumb, and a
snippet. Scores are reported verbatim — a weak match shows a low number, not
a padded one, so "confident answer" and "shrug" look different.

## MCP server

`server.py` wraps the same `rag_lib.search` primitive as a **stdio MCP
server**, so every Claude Code session opened in this repo inherits the corpus
as a tool — the query step above, but always-on and callable mid-task. It
exposes one read-only tool:

- **`search_corpus(query, k=5, source_filter=None)`** → up to `k` passages,
  each with its cosine-similarity score, `source:start-end` location, heading
  breadcrumb, and text. `source_filter` is an optional case-insensitive
  substring matched against the source path (`"DECISIONS"`, `"nodes/"`,
  `"governance-log"`) to scope results to one file or tree.

There is **no** reindex tool and no write surface by design — building the
index stays the human-run `reindex.sh`. If the index is missing the tool
returns an instructive error naming `reindex.sh` rather than building one on
first call (predictable startup over magic).

### Registration

Registration is committed at the repo root in [`.mcp.json`](../../.mcp.json)
(project-scoped). It launches this venv's Python on `server.py`, with paths
resolved via `${CLAUDE_PROJECT_DIR:-.}` so the server works from a git worktree
as well as the main checkout. Because the config travels with the repo, you do
**not** run `claude mcp add`. Two prerequisites must be satisfied first (both
human-run, once) — the [Setup](#setup) venv and the [Reindex](#reindex) index:

```bash
cd daemons/aether-rag
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # venv
./reindex.sh                                                          # index
```

### Approval & verification

Project-scoped servers from `.mcp.json` require **explicit approval** the first
time — Claude Code does not auto-run a server a repo ships. In a session opened
at the repo root:

1. Run `/mcp` and approve the `aether-rag` server when prompted (a one-time
   trust step for this project's `.mcp.json`).
2. Verify it's connected:

   ```bash
   claude mcp list
   ```

   `aether-rag` should appear with a connected status.
3. The tool is then available as `search_corpus` (namespaced
   `mcp__aether-rag__search_corpus`).

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `claude mcp list` shows `aether-rag` disconnected / failed | venv missing or deps not installed | `cd daemons/aether-rag && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` |
| `search_corpus` returns an error naming `reindex.sh` | index not built (or wiped) | run `daemons/aether-rag/reindex.sh` |
| `search_corpus` results are prefixed with a `STALE INDEX` banner | index older than the corpus (docs edited since the last reindex) | run `reindex.sh` — or just restart the shell, which heals a stale index at boot |
| Server never offered for approval | session not opened at the repo root, so `.mcp.json` was not found | reopen Claude Code at the repo root |
| First `search_corpus` call is slow | embedding model populates the fastembed cache on first use | one-time; `./reindex.sh` warms the cache, after which calls are fast |

## Freshness model

The index is a **derived, gitignored artifact** rebuilt by `reindex.sh`, so it
drifts behind the corpus whenever a tracked doc is edited without a reindex.
`server.py` catches that at startup with an mtime-only comparison (newest
corpus file vs. the index): if the index is older it still serves, but prepends
a loud `STALE INDEX — index older than corpus — run reindex.sh` banner to every
`search_corpus` result and to stderr — it never rebuilds inside a stdio session
(predictable startup over magic, the same stance as the missing-index path).
The Electron shell closes the loop at boot: if the committed index **exists and
is stale** it runs `reindex.sh` as a background child (a *missing* index or venv
is warn-only — boot never bootstraps the corpus from nothing), so a normal
restart is enough to heal drift without a manual reindex.

## Eval

```bash
.venv/bin/python eval.py
```

Runs the six canned gate questions and prints each query with its retrieved
passages. **No auto-grading** — judgment is human. Q1–Q5 should surface the
obviously-correct section near the top; Q6 ("Kubernetes deployment strategy")
is a negative probe — Aether has none, so honest behaviour is low scores /
weak passages, not a confident-looking wrong answer.

## Note on storage location (toward v1.1)

For this spike the index lives at `daemons/aether-rag/.rag/index.db`
(gitignored — it is a derived artifact, rebuilt by `reindex.sh`). When this
core graduates to a real mesh node, the index should move under the repo's
`data/` runtime directory (CLAUDE.md §4: `data/` is gitignored runtime
state), keyed off the same env-driven data-dir contract the other daemons
use. The `.rag/` location is a spike convention, not the eventual home.
