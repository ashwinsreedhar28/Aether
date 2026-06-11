# github — the GitHub Actor node

The one-rail arc (#255/#256): gaps are GitHub issues, not a local ledger.
This node is the only thing in the mesh that talks to GitHub's API. raven
files gaps through it (Lane C), the Gaps panel reads the board through it
(Lane B), and the backfill script drives the same `create_issue` path. **This
README is the surface contract those lanes build against.**

- Category: **Actor** · runtime: `local-process` (TS, lanes/intents pattern)
- Surfaces: `create_issue` · `list_issues` · `comment_issue`
- No outbound edges (invokes nothing).

## Environment

| Var | Required | Meaning |
|---|---|---|
| `MESH_GITHUB_SECRET` | yes | Mesh identity; injected by the shell's nodeManager. |
| `AETHER_DATA_DIR` | yes | Writable root for the `github/running` liveness marker. |
| `AETHER_GITHUB_TOKEN` | no | Fine-grained PAT, **Issues RW only**. Absent ⇒ degraded mode (below). Read once at boot. **Never logged — presence only.** |
| `AETHER_GITHUB_REPO` | no | `owner/name` to operate on. Default `ashwinsreedhar28/Aether`. Repo is config, never constant (#255 ruling 5). Malformed ⇒ refuse to start (exit 2). |

`AETHER_GITHUB_TOKEN` / `AETHER_GITHUB_REPO` ride the inherited process env —
set them in the shell rc or repo-root `.env.local` (env-loader). Both are
recorded for #223's env-contract blessing.

One-time repo setup: the target repo needs a **`gap` label** (the node files
with it and dedup searches by it): `gh label create gap`.

## Degraded mode (token absent)

The node still boots, registers, and serves. Per surface:

| Surface | Without token |
|---|---|
| `list_issues` | `{ issues: [], fetched_at_ms: 0, stale: false, token_available: false }` — the panel's clean no-token state. Never a deny. |
| `create_issue` | `MeshDeny('github_no_token')` — the capability error. |
| `comment_issue` | `MeshDeny('github_no_token')`. |

## `create_issue` — file a gap (dedup inside)

Params (schema `schemas/create_issue.json`):

| Field | Req | Bounds | Meaning |
|---|---|---|---|
| `area` | yes | 1–60 | Capability area for the title, e.g. `email`, `timers`. |
| `summary` | yes | 1–180 | Short summary for the title. |
| `utterance` | yes | 1–2000 | The **verbatim** triggering utterance. |
| `failure` | no | ≤2000 | Attempted tool path / failure reason. |
| `session_id` | no | ≤100 | raven session id. |
| `capability_key` | no | ≤120 | Explicit dedup key; derived from `area + summary` when absent. Pass one when raven can name the capability more stably than the summary wording. |

Behavior:

1. Normalize the key (lowercase, NFKD, non-alphanumeric runs → single `-`,
   trimmed, ≤80 chars). Empty result ⇒ `MeshDeny('github_bad_capability_key')`.
2. **Dedup, memo first:** the node memoizes every key it has filed (or
   dedup-matched) this process lifetime. GitHub's filtered list endpoint is
   *eventually consistent* — an issue filed moments ago may be absent from the
   next `labels=gap` scan — and back-to-back re-asks (the voice "ask again"
   flow) must still dedup. A memo hit is re-verified **open** via a direct
   by-number read (strongly consistent); a gap the Director closed re-files
   fresh instead of bumping a closed record.
3. **Dedup, scan:** on memo miss, fetch open `gap`-labeled issues fresh (one
   page, 100 — never the list cache) and exact-match each body's
   `<!-- aether:gap-key:<key> -->` marker. On either dedup hit: comment the
   new utterance on the existing issue ("asked again: …" — the +1 demand
   signal) and return
   `{ ok, deduped: true, number, url, comment_id, capability_key }`.
4. No match anywhere: create the issue and return
   `{ ok, deduped: false, number, url, capability_key }`.

Issue format (#255 item 3 — gap issues are **RECORDS, not contracts**):

- Title: `gap(<area>): <summary>` · Label: `gap`
- Body: verbatim utterance (blockquoted), attempted path/failure, session id,
  filed-at ISO timestamp, a "RECORD, not a contract" footer, and the
  machine-readable key marker. **No spec content** — work starts only when an
  ARCHITECT SPEC comment lands on the issue.

Denies: `github_no_token`, `github_bad_capability_key`, `github_bad_<field>`,
`github_api_error { status, reason }`, `github_unreachable { reason }`.

## `list_issues` — the open board

Params: `{ labels?: string, limit?: number }` — `labels` is GitHub's
comma-separated filter (issues must carry **all** listed labels; the node's
affordance — Lane B's panel filters client-side over one stream by Architect
ruling), `limit` defaults 50, max 100. Always open issues, newest-first, PRs
filtered out.

Returns `{ issues, fetched_at_ms, stale, token_available }` where each issue is
`{ number, title, labels, state, created_at, updated_at, comments, url, author }`
(`labels` is a plain `string[]` of label **names** — GitHub's REST label
objects are flattened; `created_at` ISO 8601 → age; `comments` → the +1
signal; `url` → click-through).

Caching: serve-from-cache for 30s per `(labels, limit)` pair — pollers hit the
cache, not GitHub (worst case ~120 reads/hr vs the 5000/hr PAT budget). When
GitHub errors and a cache exists, the last good fetch is served with
`stale: true` (the offline render). Errors with nothing cached deny
(`github_api_error` / `github_unreachable`).

## `comment_issue` — add detail by number

Params: `{ number: integer ≥1, body: string 1–4000 }`. Returns
`{ ok, number, comment_id, url }`. A 404 surfaces as
`github_api_error { status: 404 }` — no such issue.

## Edges (manifest.yaml)

- `raven → github.create_issue` — the voice filing path (Lane C).
- `raven → github.comment_issue` — add detail to a gap by number.
- `shell → github.list_issues` — the Gaps panel read path (Lane B); mirrors
  `shell → lanes.status`.

There is deliberately **no `close_issue` surface** (#255 ruling 3): gaps close
through the merge rail (`Closes #n` in PR bodies); non-PR closes are Director
board actions.

## Tests & smoke

- `pnpm --filter @aether/github test` — unit tests: pure gap format/key logic
  and all three handlers against a fake client (dedup branches, degraded mode,
  stale-cache serve).
- `pnpm --filter @aether/github build && pnpm --filter @aether/github smoke` —
  live smoke against the real API (needs the token): create → list → comment →
  dedup-on-repeat → degraded checks; closes its test issue afterwards.
