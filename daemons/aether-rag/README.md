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
