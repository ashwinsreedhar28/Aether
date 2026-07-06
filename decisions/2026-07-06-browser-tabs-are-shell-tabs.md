## [2026-07-06] ADR: Browser tabs are shell tabs — one tab system, no in-app strip (#336)

**Status:** accepted

**Decided by:** Architect (ratified spec on #336), implementation on `lane/issue-336`.

**Context:** The `gap(browser)` record (#336) asked for "tabs" among the
missing browser features, and the machine draft answered it literally: an
in-app tab strip inside the Browser app, with its own create/switch/close UI.
But the shell already IS a tab system: Browser instances ride AppContext
(`updateTab`, `closeTab`, `setSuspended`), persist their url/title onto their
shell tab (`TabState.filePath` carries the URL, which is exactly how a
suspended browser tab restores), and suspend/restore through the same
machinery as every other app. The real gap was one-directional: no page
interaction could ever CREATE a tab. WebViewContainer's `new-window` handler
forced every popup into the same webview — and on Electron ≥22 (we ship
33.4.11) that handler is dead code outright, because the webview `new-window`
DOM event was removed; a guest's window-open requests exist only in the main
process, via `setWindowOpenHandler` on the guest webContents, and without
`allowpopups` on the webview tag they are dropped before even that.

**Decision:** There is ONE tab system. A "browser tab" is a shell tab running
the Browser app; the Browser never grows an in-app tab strip. Concretely:

- Window-open requests from the browser's webview guest are captured in main
  (`did-attach-webview` → `setWindowOpenHandler`), denied as native popups,
  and forwarded to the renderer as `browser:window-open` with
  `{ url, disposition, sourceWebContentsId }`. The webview tag carries
  `allowpopups` so the guest can raise the request; the deny-all handler
  guarantees no native window ever results.
- Routing is a pure renderer function (`shell/src/apps/browser/
  windowOpenRouter.ts`): dispositions `foreground-tab`, `background-tab`,
  `new-window` open a NEW shell tab running the Browser app at the URL
  (background tabs don't take focus); the `default` disposition keeps the
  legacy same-webview load; `BLOCKED_PROTOCOLS` is enforced before either
  path, exactly as on will-navigate.
- The route into the shell is a minimal extension of the AppContext open
  surface: `openTab(appId, filePath?, { background? })` — `openFile` can't
  target an app type, `openWindow` can't target a tab. It lands in the
  originating instance's own window via the existing `addTab` (extended with
  an `activate` opt).
- Keyboard: cmd+t (browser-active, renderer keydown) opens a new browser tab
  at the home page. cmd+w is the shell's (viewerMenu `CmdOrCtrl+W` →
  `menu:close-tab` → Desktop `closeFocusedWindowOrTab`) and stays unbound in
  the Browser — never double-bind a key the shell owns.

Follow-on sub-lanes (history, private browsing, extensions) layer
**per-instance**, never per-strip: history records each instance's
did-navigate events; private browsing is an ephemeral webview partition per
instance (vs `persist:browser`); extensions attach per-webview. This ADR is
the contract those three build against.

**Consequences:**
- Everything the shell gives tabs, browser tabs get for free — suspend/
  restore, persistence across restarts, cmd+w / prev-next-tab menu
  accelerators, workspace membership — and every future shell-tab feature
  accrues to the browser without browser work.
- Sub-lanes get a stable seam: "per Browser instance" == "per shell tab" ==
  one webview, so per-tab history/partition/extension state has an obvious
  owner and no strip-index bookkeeping to invent.
- The shell's Tile Windows accelerator moved CmdOrCtrl+T →
  CmdOrCtrl+Shift+T; cmd+t now belongs to "new tab" (which the
  keyboard-shortcuts catalog had already documented as its meaning). Menu
  accelerators preempt renderer keydowns, so the two could not coexist.
- Renderer keydown shortcuts (cmd+t included) don't fire while focus is
  INSIDE the guest page — keys go to the guest webContents. Same standing
  limitation as the browser's existing cmd+r/[/] bindings; a follow-on could
  forward guest `before-input-event`s from the did-attach-webview hook if it
  bites.

**Alternatives considered:**
- *In-app tab strip inside the Browser app* (the machine draft's shape):
  duplicates create/switch/close/persist/suspend against the shell's
  versions, and every follow-on (history, private, extensions) would need
  strip-aware bookkeeping. Rejected — two tab systems is the defect, not the
  feature.
- *Routing dispositions in the main process* (main calls `addTab`-equivalent
  directly): puts tab policy and BLOCKED_PROTOCOLS in main, splitting the
  browser's navigation law across processes; the renderer owns tabs, so main
  stays a dumb deny-and-forward. Rejected.
- *`webContents.id`-less broadcast* (any Browser instance handles any
  window-open): simpler, but with two browser tabs open the request would
  route to an arbitrary instance's window. `sourceWebContentsId` filtering
  keeps the new tab beside its opener. Rejected.
- *Binding cmd+w in the Browser as well as the menu*: double-close on every
  cmd+w. Rejected per the spec's "never double-bind".
