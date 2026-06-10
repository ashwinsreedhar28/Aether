# Retrospective: the Viewer × Aether Capability Merge
**2026-06-09 → 06-10 · Arc promoted to main as #238 (merge commit, per-lane history preserved)**

## What this arc was
ADR #203 ruled the plan: one window manager — the absorbed Viewer renderer, with its workspace store as the sole layout authority — Aether's surfaces re-homed as ordinary apps (Mesh, Lanes, Gaps), raven as the only assistant, and the scene-server/Leap/dashboard stack retired in place for the AVP track rather than maintained in parallel. Six sequenced lanes executed the merge; a hardening wave followed when live usage broke things the plan could not have predicted; the whole arc was promoted to main in a single merge commit so every lane remains legible in history.

## Ledger
#205 command-palette removal · #209 mesh-SDK collapse · #211 render fix + mute button · #213 CI policy on integration branches · #215 scene-server/Leap/dashboard retirement · #216 model migration · #228 visualizer despawn (+ADR) · #229 lanes payload-drift fix · process-diet (lane-done + §7-lite) · #236 session resumption + reconnect · #238 capstone · #242 barge-in port · #245 voice-viewer awareness, tiling, terminal. Plus: the issue board rebuilt as self-describing contracts.

## What broke live, and what each failure taught
**Google retired our voice model server-side, mid-session.** #216 swapped to the 12-2025 preview. Law: pin models, never -latest; a deliberate eval lane (#233) gates upgrades; boot provenance + a deprecation watchdog (#223) make the next retirement a warning, not a 30-minute mystery.
**The Live API killed sessions with 1008 after tool responses.** A known, unfixed upstream bug. #236 made raven survive it: resumption handles, an in-process reconnect loop, backoff with a give-up budget. The Architect's initial theory (SDK thought-signatures) was wrong; the implementer's upstream research was right. Research beats hypothesis, and the correction lives in the record on purpose.
**The Lanes app crashed in an error/reload loop.** Payload-vs-interface drift from a re-home (#229) — the node had served an object since #143; the re-homed app still expected a string. Pattern extracted: audit sibling re-homes; spawn gates exist for the bugs that are not derivable from code alone.
**Raven swore the browser did not exist.** Two causes (#245): the system prompt listed app-opening as a capability-gap example while open_app existed — the model was obeying contradictory instructions — and a hardcoded list named 6 of ~25 registry apps. Law: recovery beats foreknowledge. Validate against live registries; on a miss, return the valid options as data the model can act on in the same turn; never bake an inventory into a prompt.
**Every terminal was secretly dead.** node-pty's prebuilds lose their exec bit under pnpm extraction; a postinstall guard now restores it. Live testing finds what static verification cannot.

## Process law minted this arc
- **Issue-is-contract.** No lane spawns without an ARCHITECT SPEC comment on its issue; implementers start from the issue and nothing else; PRs close their issue. Merges into non-default branches never auto-close — close manually.
- **Verify before merge.** The Architect confirms number, title, and base branch by fetching the PR before the Director presses anything. The single skip of this arc merged a PR into a ghost branch; the law exists for exactly that.
- **Wait for checks to schedule.** gh reports "no checks" in the seconds before a run is scheduled; a merge attempted in that window fails on a pending required context. Strict up-to-date policy is on: rebase open PRs when main moves.
- **Trunk changes are broadcast, never assumed.** When the trunk moves, every collaborator gets an explicit comment on their active issues.
- **No stderr suppression on consequential commands.** A 2>/dev/null hid a rejected branch deletion for two hours and a false narrative was built on the gap. Failures must be visible.
- **Staged blocks.** Command sequences with a merge gate in the middle run in stages; destructive cleanup never trails an unverified merge.
- **The auto-review bot is advisory.** The Architect reads its output at verification; it never blocks the Director. Known carve-out: the GitHub App refuses tokens to PRs editing their own triggering workflows.
- **Admin bypass is for deliberate owner acts** — arc-end branch deletes, capstone merges — never for impatience.
- **Rulesets are create/delete, not edit** — the API GET payload does not round-trip through PUT. Recreate integration-branch protection when minting the next arc branch; it guards the trunk while the arc lives and is deleted with it.
- **Lanes sharing files run strictly serial.** The Architect sequences the queue and the merge order; parallelism is earned by disjoint surfaces.

## Standing rulings carried forward
Fold visualize into open_app once live smoke proves open_app solid. Reconcile ~/.raven/config.json with the Aether data-dir convention, and surface reconnect counts — both #223. AEC-grade barge-in banked as a follow-up. The autonomy dial is unchanged: every merge in this arc was pressed by a human, and that is not a limitation of the system — it is the system.

## By the numbers
~16 merges · 53,561 insertions in the capstone · 47 voice functions across 22 tool groups · 2 humans + up to 4 parallel Claude Code implementers · 0 file collisions.

## What the arc proved
The factory works. A bug noticed by voice at midnight was root-caused, specced, built by an agent, gated, and merged before sunrise. The operating theater the self-building rungs need — one trunk, one contract format, one gate, machine-readable judgment — now exists. Next: the music vertical, built end-to-end by the pipeline, with the Director's touchpoints counted.
