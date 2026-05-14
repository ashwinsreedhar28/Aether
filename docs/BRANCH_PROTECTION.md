# Branch Protection — main

GitHub branch-protection rules are **not** repo-file configurable. They
have to be set through the GitHub UI (or the REST/GraphQL API). This
doc records the exact settings so anyone — Director, future
collaborator — can reproduce them in one pass.

Once these are on, CLAUDE.md §5's "you never push to `main` directly"
becomes mechanically enforced rather than a convention.

---

## One-time setup (Director action)

1. Go to **Settings → Branches** on the Aether GitHub repo (still at github.com/ashwinsreedhar28/homeOS until the repo rename).
2. Click **Add branch ruleset** (or **Add classic branch protection
   rule** — either works; the steps below match the classic UI, which
   is faster for a single rule).
3. **Branch name pattern:** `main`
4. Enable the following:

   - [x] **Require a pull request before merging**
     - [x] Require approvals → **0** (Architect reviews live on the PR
       comment thread; GitHub doesn't have an "Architect" account, so
       leave required-approvals at 0 and rely on the human merge gate)
     - [x] Dismiss stale pull request approvals when new commits are
       pushed *(optional but recommended)*
     - [ ] Require review from Code Owners *(off — we have no
       CODEOWNERS file)*

   - [x] **Require status checks to pass before merging**
     - [x] Require branches to be up to date before merging
     - **Status checks that are required:** add `checks` *(the job
       name from `.github/workflows/ci.yml`)*
     - Note: GitHub only lists a status check here after it has run at
       least once. If you're setting this up before any PR has
       triggered CI, open a throwaway PR first so `checks` appears in
       the picker, then come back and select it.

   - [x] **Require conversation resolution before merging** *(catches
     unresolved Architect review comments)*

   - [ ] **Require signed commits** *(off — would require GPG setup on
     every contributor's machine; revisit if we ever sign tags)*

   - [x] **Do not allow bypassing the above settings** *(applies the
     rule to admins too — important; otherwise Director can
     accidentally `git push origin main` from the laptop and silently
     bypass everything)*

   - [x] **Restrict deletions**

   - [x] **Do not allow force pushes**

5. Click **Create** / **Save changes**.

---

## What this gives us

- Direct pushes to `main` are rejected at the remote — even from
  Director's local clone. The §5 "you never push to main" convention
  becomes a hard constraint.
- Every change to `main` must go through a PR, and that PR must have
  a green CI run before the merge button enables.
- Force-pushing `main` is impossible. History stays linear and
  auditable.
- Deleting `main` accidentally is impossible.

---

## What it does *not* do

- It does not require Architect approval (GitHub doesn't know who
  Architect is — Architect is a Claude session, not a GitHub user).
  The Architect-signs-off-then-Director-merges flow stays a human
  protocol; branch protection just enforces the mechanical floor.
- It does not auto-merge anything. Director still presses the button.

---

## Verifying it's on

After setup, try the following from a local clone of `main`:

```bash
git commit --allow-empty -m "should be rejected"
git push origin main
```

Expected: GitHub rejects the push with `protected branch hook
declined`. If the push succeeds, the rule is not active — re-check
the settings.

---

## If CI is failing on a PR that needs to merge anyway

Director has admin override. From the PR page, the merge button shows
a warning but remains clickable for admins *unless* "Do not allow
bypassing the above settings" is on (which it is, per step 4 above).
To merge a failing PR in an emergency:

1. Temporarily disable "Do not allow bypassing" in the rule.
2. Merge the PR with the admin override.
3. Re-enable "Do not allow bypassing" immediately after.

This should be vanishingly rare. If you find yourself doing it more
than once, the rule is wrong, not the PR.
