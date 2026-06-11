## [2026-06-11] ADR: control-bridge errors ride a resolved envelope — a rejection never crosses executeJavaScript (#300)

**Status:** accepted

**Decided by:** Architect (spec on #300, root-cause directive "make every
path resolve"), implemented on `fix/lane-spawn-delivery`.

**Context:** The first live lane spawn (#298, issue 219) hung forever inside
`runLaneRecipe`: the ledger showed `requested` with neither `spawned` nor
`failed`, pinning the in-flight slot until an app restart. The dispatch seam
is `webContents.executeJavaScript('window.__viewerControl.execute(...)')`,
and the renderer bridge **threw** on failure paths (unknown action, handler
errors) — i.e. handed a rejected promise to `executeJavaScript`, whose
transport of rejections is unreliable and can leave the main-side promise
pending forever. A pending promise is not an error: the recipe's try/catch
never fired.

**Decision:** The renderer's `__viewerControl.execute` NEVER rejects. Every
failure — unknown action included — resolves as a serializable
`{ __controlError: string }` envelope; `executeViewerControl` (the single
main-side seam) unwraps it and re-throws, so main-process callers still
observe failures as deterministic rejections. Success payloads are
untouched. Belt-and-braces at the spawn call site: `openLaneTerminal` races
the dispatch against `TERMINAL_TIMEOUT_MS` and degrades to `false` on
silence (covers residual non-settling transports, e.g. a renderer that is
mid-load or throttled).

**Consequences:** `__controlError` is a reserved key on bridge payloads — no
handler may use it for data. Future bridge handlers may throw freely (the
wrapper converts); they must never return a non-serializable value (that
remains a transport-level hazard the timeout, not the envelope, catches).
Anyone adding a second `executeJavaScript` seam must route it through
`executeViewerControl` or replicate the unwrap.

**Alternatives considered:** Timeout-only at call sites (rejected as the fix:
it unpins the recipe but leaves every other dispatch caller exposed, and an
unknown action would surface as a 30s stall instead of an instant named
error — kept only as the backstop). Migrating the bridge to
`ipcRenderer.invoke`/`ipcMain.handle`, whose reply transport is reliable
(deferred: correct long-term, but it moves the registration seam for every
handler — out of scope for #300).
