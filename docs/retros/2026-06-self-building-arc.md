ARCHITECT DISTILLATE — the v0.11.0 arc: shakedown cruise of the spawn rail
(Posted for the #297 retro to carry verbatim. Corpus-facing; written to be retrieved.)

THE ARC. At 07:31 the first voice-spawned lane (#298's rail, issue 219) wedged silently: session created, pane virgin, ledger frozen at requested, the in-flight slot pinned forever. By end of day the same utterance class had staffed three concurrent lanes overnight, every one of which hit its gate, took a human clean-proceed inside its own pane, and shipped a reviewed PR (#306, #307, #308). In between: nine named defects, six merges (#301, #302, #303, #306, #307, #308), and the first PR in the repo's history produced end-to-end by the system itself (#303 — board issue, voice, card, detached lane, gate, merge).

DEFECT LEDGER (each unmasked by fixing the one before it):
1. Kickoff payload lost in three quoting layers (sq inside sq inside zsh -lic) → file-based delivery (.lane-kickoff.md) + a pane-command oracle; a lost kickoff is now a named markFailed, never a ghost.
2. Recipe could await a renderer dispatch forever → bridge envelope contract (a rejection never crosses executeJavaScript) + timeout race. Shipped as hardening; the field hang proved to live one layer down:
3. The first tmux new-session of a boot starts the SERVER, which inherits stdio; execFile resolves on stream CLOSE, not child exit; per-fd redirects are unwinnable (the shell leaks descriptors above fd 2). Law: pipes are forbidden across a server boot — runTmux is spawn(stdio:'ignore'), settle on exit.
4. '=' exact-match is session-typed only; send-keys rejected it. Law: pane-target commands address a resolved #{pane_id}.
5. Requested records were invisible while a recipe ran. Law: the card contract is additive — busy gates buttons, never visibility.
6. Apple Terminal's restored-session banner poisoned the tmuxBin capture. Law: -l/-lic stdout is never trim()-trusted — pickBinaryLine + existsSync; the audit found and fixed the same shape in three more resolvers, including nodeRegistry's python pick.
7. Orphan reattach existed main-side, shadowed renderer-side → inline REATTACH plus an OrphanStrip that survives any candidate the chain picks.
8. (#304) The orphan matcher was innocent; complete() closed live-session records silently — the lane-232 incident. Law: terminal writes on live records are warn-and-force, never silent; cleanup blocks lead with kill-session.
9. (open, morning board) The orphaned-spawned card lost its complete affordance in state-gating, and the boot-time orphan list goes stale when sessions die mid-app-life.

PROCESS LAWS EARNED:
- The live smoke is the merge gate, and the repo's own ruleset independently enforced it — a required check in "expected" state blocked a pre-smoke merge attempt. Ritual: gh pr checks → (if main moved) gh pr update-branch → WAIT for CI → merge. Paste blocks do not sleep.
- One setStep per await: label granularity bought every diagnosis after run 2.
- Anti-drift tests pin hand lists to their source (#307's APP_HINTS gate) — they delete whole defect classes.
- The CHANGELOG-per-lane tension fired three times in one day; #222 (fragments) is no longer optional.
- Relay pattern: rebase instructions pasted into lane panes worked flawlessly twice — the manual prototype of Rung 2.5.

ROLE NOTES. The merge button never moved. What moved: the gate traveled into the pane (clean, proceed), review compressed to verification plus rulings, and the Director ran a workforce by voice while asleep. The next organs — report ingestion, a reviewer cell on the PR path, spec composition from the corpus — are themselves board issues that this rail will build.

