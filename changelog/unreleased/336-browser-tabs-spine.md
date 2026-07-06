### Added
- Browser tabs ARE shell tabs — the tabs spine (#336, first of the browser
  gap's sub-lanes; ADR `decisions/2026-07-06-browser-tabs-are-shell-tabs.md`).
  Page interactions can now CREATE tabs: target=_blank, cmd+click, and
  window.open surface in the main process (Electron ≥22 removed the webview
  `new-window` DOM event the old handler listened for — it was dead code),
  which denies the native popup and forwards `{ url, disposition }` to the
  renderer; a pure, unit-tested router (`windowOpenRouter.ts`) sends the
  foreground-tab / background-tab / new-window dispositions to a NEW shell
  tab running the Browser app at the URL (background tabs don't steal
  focus), keeps the default disposition on the legacy same-webview load, and
  enforces `BLOCKED_PROTOCOLS` on every path exactly as will-navigate does.
  The route rides a minimal `openTab(appId, filePath, {background})` on the
  AppContext open surface (openFile can't target an app, openWindow can't
  target a tab). cmd+t in an active browser tab opens a new one at the home
  page — the shell's Tile Windows accelerator moves to CmdOrCtrl+Shift+T to
  free the key; cmd+w stays shell-owned (viewerMenu → `menu:close-tab`),
  deliberately unbound in the browser. Per-tab url/title persistence and
  suspend/restore are untouched. Closes #336.
