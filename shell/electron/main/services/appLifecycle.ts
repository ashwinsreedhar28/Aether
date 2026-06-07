// Single source of truth for "the shell is shutting down."
//
// Daemon managers read isQuitting() before spawning a child so a quit that
// races a slow bootstrap can't launch a process into a dying app and orphan it.
// The motivating incident: raven's ensureRunning() spends ~30s building a venv;
// if the Director quits during that window, the deferred spawnDaemon() still
// fired and a raven daemon (pid=91597 in the log) came up parented to an
// already-quitting shell — an orphan that survived the app and held the port
// against the next boot.
//
// index.ts calls markQuitting() at the very start of EVERY shutdown path
// (before-quit AND the raw SIGINT/SIGTERM/SIGHUP handlers, which never traverse
// before-quit) so the flag is set before stopAllChildren() runs. It is a
// one-way latch — nothing un-sets it; a quit is terminal.
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
