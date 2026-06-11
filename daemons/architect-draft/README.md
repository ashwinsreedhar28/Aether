# architect-draft — machine-composed draft specs (Rung 1.5)

Turns a **gap issue** into a **draft spec comment** on that issue's thread:
fetch the gap record, retrieve precedent from the local `aether-rag` corpus,
prompt the Director-configured draft model, and post the result as an
**unratified** comment. The failure-driven pattern (gap → proposal) gets a
machine path; ratification stays human.

```
gap issue #N ──fetch──▶ compose_spec.py ──post──▶ "DRAFT SPEC (machine-composed, unratified) — …"
                            │      ▲
                  rag_lib KNN      │ model id from config
              (aether-rag corpus)  │ (never from code)
```

## The guard interaction (the load-bearing clause)

The spawn path (`work_on_issue`) treats an issue as a contract only when a
line opens with the all-caps ratification marker. A machine draft **must
never** satisfy that guard:

- the comment opens with the literal prefix
  `DRAFT SPEC (machine-composed, unratified) — `;
- `defang()` blockquotes any draft line that would anchor the guard regex
  (content preserved for the reader, anchor broken for the machine);
- `_assert_unguarded()` hard-refuses to post a body that still matches —
  whatever produced it.

The guard regex here is a **parity copy** of
`raven_core/tools/work_on_issue_tool.py:_SPEC_MARKER_RE`; the parity is
pinned by `daemons/raven-core/tests/test_draft_spec_gate.py`. If the guard
changes shape, change both and keep that test green.

Ratification = the Director re-posting agreed content under the real marker.
Until then, `work_on_issue` still warns the issue is spec-less. This script
cannot ratify, by construction.

## Setup

```bash
cd daemons/architect-draft
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

**Interpreter gotcha:** the base `python3` must have sqlite3 loadable-extension
support (`sqlite-vec` needs `enable_load_extension`). python.org macOS builds
ship WITHOUT it and fail only at query time
(`'sqlite3.Connection' object has no attribute 'enable_load_extension'`);
Homebrew and Anaconda pythons are fine. Build this venv from the same python
that built `daemons/aether-rag/.venv` (see its `pyvenv.cfg`) and both daemons
agree by construction.

The corpus index must exist (it is read, never built, from here):
`daemons/aether-rag/reindex.sh`.

## Config

| Knob | Where | Meaning |
|---|---|---|
| `AETHER_DRAFT_MODEL` | env (`.env.local`) | the draft model id; wins over the config file |
| `draft_model` | `<data-root>/architect/config.json` | same knob for standalone runs |

`<data-root>` resolves `AETHER_DATA_DIR` → `RAVEN_USER_DIR` → `~/.raven`
(the `draft_lane` precedence). **There is no default model in code** — an
unconfigured model is an instructive refusal, per the #312 spec ("model
choice is config, never hardcoded").

Also required in env: `AETHER_GITHUB_TOKEN` (the github node's PAT
contract — REST, never `gh`, per the #256 pre-decision) and
`GEMINI_API_KEY` for the model call. `AETHER_GITHUB_REPO` overrides the
canonical default repo (parity with `nodes/github`'s `DEFAULT_REPO`).

## Usage

```bash
# compose + post on issue 311
.venv/bin/python compose_spec.py 311

# compose only — body printed to stderr, nothing posted
.venv/bin/python compose_spec.py 311 --dry-run
```

stdout carries exactly one JSON result line (`{ ok, number, url, … }` or
`{ ok: false, error }`) — that line is the contract the raven voice tool
(`draft_spec`, confirm-gated) parses when it runs this script. Progress and
warnings go to stderr.

Refusals: unknown/closed issue, PR numbers, an issue that **already carries
a ratified spec** (a machine draft under it would only add noise), missing
token/key/model/index.

## Tests

```bash
python3 -m pytest daemons/architect-draft/test_compose_spec.py
```

Stdlib-only (heavy imports are lazy), so any pytest runs them — they pin the
guard interaction: composed output can never match the spec guard.
