import { useCallback, useEffect, useState } from 'react'
import type { SpawnSnapshot, SpawnView } from '../../electron/preload'
import { useSpawnUi } from '../stores/spawnUi'

// The spawn actor's window — a global modal raised by the shell's SpawnService
// when a spawn request lands in the ledger (raven's request_spawn tool wrote it
// after a correct passphrase). The Director approves or dismisses here; nothing
// spawns until Approve is pressed. Concurrency is capped at one live spawn.
//
// Lifecycle vs. window. Mark-complete is a LIFECYCLE action (it closes the
// spawn) — it is no longer the only way to dismiss the window. Every card can be
// MINIMIZED (hidden without any ledger change) and reopened from the Spawns
// strip. After a spawn closes, the window surfaces the copyable teardown block
// built from the recorded worktree/branch (no auto-run — the Director runs it).
//
// The passphrase never reaches this layer: it was verified server-side before
// the request was recorded.

// ---- styled atoms ----------------------------------------------------------

function Btn({
  label,
  onClick,
  variant = 'ghost',
  disabled,
  title,
}: {
  label: string
  onClick: () => void
  variant?: 'accent' | 'ghost' | 'danger'
  disabled?: boolean
  title?: string
}): React.ReactElement {
  const color =
    variant === 'accent'
      ? 'var(--holo-accent)'
      : variant === 'danger'
        ? 'var(--holo-muted)'
        : 'var(--holo-text)'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="text-[10px] tracking-[0.2em] px-3 py-1.5 rounded font-mono"
      style={{
        WebkitAppRegion: 'no-drag',
        color,
        background: 'transparent',
        border: `1px solid ${variant === 'accent' ? 'var(--holo-accent)' : 'var(--holo-border)'}`,
        boxShadow: variant === 'accent' && !disabled ? '0 0 8px var(--holo-glow)' : 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  )
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex gap-3 text-[11px] font-mono">
      <span className="w-20 shrink-0 tracking-[0.15em]" style={{ color: 'var(--holo-muted)' }}>
        {label}
      </span>
      <span className="break-all" style={{ color: 'var(--holo-text)' }}>
        {value}
      </span>
    </div>
  )
}

function Frame({
  heading,
  onMinimize,
  children,
}: {
  heading: string
  // Hide the window without a lifecycle change. Reopen from the Spawns strip.
  onMinimize?: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(2, 4, 10, 0.72)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="w-[min(640px,92vw)] max-h-[82vh] flex flex-col rounded-lg overflow-hidden"
        style={{
          WebkitAppRegion: 'no-drag',
          background: 'var(--holo-panel)',
          border: '1px solid var(--holo-accent)',
          boxShadow: '0 0 40px var(--holo-glow)',
        }}
      >
        <div
          className="shrink-0 flex items-center justify-between px-5 py-3 text-[11px] tracking-[0.3em] border-b"
          style={{ color: 'var(--holo-accent)', borderColor: 'var(--holo-border)' }}
        >
          <span>{heading}</span>
          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              title="Minimize — reopen from the Spawns strip"
              aria-label="Minimize"
              className="text-[16px] leading-none px-2 -my-1"
              style={{
                WebkitAppRegion: 'no-drag',
                color: 'var(--holo-muted)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ⎯
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

// ---- helpers ---------------------------------------------------------------

// The RAG bootstrap line for the active/complete card. 'ok' → the spawned
// session's /mcp is warm from birth; 'failed' → it still launched, the Director
// can warm it by hand. Absent on older records (pre-v1.1 spawns).
function ragLabel(v: SpawnView): string {
  if (v.ragBootstrap === 'ok') return 'indexed — /mcp green from birth'
  if (v.ragBootstrap === 'failed') {
    return `bootstrap failed${v.ragStep ? ` (${v.ragStep})` : ''} — run reindex.sh in the worktree`
  }
  return '—'
}

// ---- the card --------------------------------------------------------------

export function SpawnApproval(): React.ReactElement | null {
  const [snap, setSnap] = useState<SpawnSnapshot | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // The id of a spawn the Director JUST marked complete this session — raises
  // the cleanup card for it. Session-local on purpose: a long-closed spawn must
  // not re-haunt the window on every boot (reopen it from the strip instead).
  const [justClosedId, setJustClosedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const openedId = useSpawnUi((s) => s.openedId)
  const minimizedKey = useSpawnUi((s) => s.minimizedKey)
  const minimize = useSpawnUi((s) => s.minimize)

  useEffect(() => {
    let alive = true
    void window.aether.spawn.list().then((s) => {
      if (alive) setSnap(s)
    })
    const unsub = window.aether.spawn.onChanged((s) => setSnap(s))
    return () => {
      alive = false
      unsub()
    }
  }, [])

  const act = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setActionError(null)
      const res = await fn()
      if (!res.ok) setActionError(res.error ?? 'action failed')
    },
    [],
  )

  const onComplete = useCallback(async (id: string) => {
    setActionError(null)
    const res = await window.aether.spawn.complete(id)
    if (!res.ok) {
      setActionError(res.error ?? 'action failed')
      return
    }
    // Surface the teardown block for the spawn we just closed.
    setJustClosedId(id)
  }, [])

  const onCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setActionError('clipboard unavailable — select the block and copy manually')
    }
  }, [])

  if (!snap) return null
  const spawns = snap.spawns

  // Candidate: the highest-priority record worth surfacing. A recipe in flight,
  // then a pending request, then a live spawn, then a just-closed spawn's
  // cleanup, then a failure to acknowledge.
  const runningRec = snap.running ? (spawns.find((s) => s.id === snap.running) ?? null) : null
  const requested = spawns.find((s) => s.status === 'requested') ?? null
  const active = spawns.find((s) => s.status === 'spawned') ?? null
  const failed = spawns.find((s) => s.status === 'failed') ?? null
  const justClosed = justClosedId
    ? (spawns.find((s) => s.id === justClosedId && s.status === 'closed') ?? null)
    : null
  const candidate = runningRec ?? requested ?? active ?? justClosed ?? failed ?? null

  // A strip click reopens a specific spawn's card, overriding the candidate and
  // any minimize (open() clears minimizedKey, so an opened card never matches it).
  const openedRec = openedId ? (spawns.find((s) => s.id === openedId) ?? null) : null
  const display = openedRec ?? candidate
  if (!display) return null

  const cardKey = `${display.id}:${display.status}`
  if (minimizedKey === cardKey) return null
  const onMinimize = (): void => {
    setActionError(null)
    setCopied(false)
    minimize(cardKey)
  }

  const isRunning = display.id === snap.running

  // ---- SPAWNING (recipe in flight) ----
  if (isRunning) {
    return (
      <Frame heading="SPAWNING" onMinimize={onMinimize}>
        <div className="px-5 py-5 space-y-3">
          <Row label="LANE" value={display.draftName} />
          <Row label="STEP" value={snap.runningStep ?? 'starting'} />
          <div className="text-[11px] font-mono pt-1" style={{ color: 'var(--holo-muted)' }}>
            Running the worktree recipe — fetch, worktree, submodules, install, then the
            aether-rag bootstrap (so the session's /mcp is warm) and a Terminal running
            Claude Code against the lane. This can take a few minutes on first install.
          </div>
        </div>
      </Frame>
    )
  }

  // ---- SPAWN REQUEST (awaiting approval) ----
  if (display.status === 'requested') {
    const blocked = snap.busy // an active spawn is holding the gate
    return (
      <Frame heading="SPAWN REQUEST" onMinimize={onMinimize}>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
          <Row label="LANE" value={display.draftName} />
          <Row label="BRANCH" value={display.targetBranch} />
          <Row label="WORKTREE" value={display.targetWorktree} />
          <Row label="DRAFT" value={display.draftPath} />
          <div className="pt-2">
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: 'var(--holo-muted)' }}>
              FULL PROMPT
            </div>
            <pre
              className="text-[11px] font-mono whitespace-pre-wrap break-words rounded p-3 max-h-[34vh] overflow-y-auto"
              style={{ color: 'var(--holo-text)', background: 'var(--holo-bg)', border: '1px solid var(--holo-border)' }}
            >
              {display.preview ?? '(no preview)'}
            </pre>
          </div>
          {blocked && (
            <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
              A spawn is already running{active ? ` in ${active.targetWorktree}` : ''}. Approve is
              disabled until you mark it complete.
            </div>
          )}
          {actionError && (
            <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
              {actionError}
            </div>
          )}
        </div>
        <div
          className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: 'var(--holo-border)' }}
        >
          {blocked && active && (
            <Btn label="MARK COMPLETE" onClick={() => void onComplete(active.id)} />
          )}
          <Btn label="DISMISS" variant="danger" onClick={() => void act(() => window.aether.spawn.dismiss(display.id))} />
          <Btn
            label="APPROVE & SPAWN"
            variant="accent"
            disabled={blocked}
            title={blocked ? 'A spawn is already running' : undefined}
            onClick={() => void act(() => window.aether.spawn.approve(display.id))}
          />
        </div>
      </Frame>
    )
  }

  // ---- SPAWN ACTIVE (live worktree) ----
  if (display.status === 'spawned') {
    return (
      <Frame heading="SPAWN ACTIVE" onMinimize={onMinimize}>
        <div className="px-5 py-5 space-y-3">
          <Row label="LANE" value={display.draftName} />
          <Row label="BRANCH" value={display.branch ?? display.targetBranch} />
          <Row label="WORKTREE" value={display.worktree ?? display.targetWorktree} />
          <Row label="RAG" value={ragLabel(display)} />
          <div className="text-[11px] font-mono pt-1" style={{ color: 'var(--holo-muted)' }}>
            A Claude Code session is running in its own Terminal window. Closing that
            window stops the agent (the kill switch). Mark complete when the session is
            done — only one spawn runs at a time. You can also minimize this window and
            reopen it from the Spawns strip.
          </div>
          {actionError && (
            <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
              {actionError}
            </div>
          )}
        </div>
        <div
          className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: 'var(--holo-border)' }}
        >
          <Btn label="MARK COMPLETE" variant="accent" onClick={() => void onComplete(display.id)} />
        </div>
      </Frame>
    )
  }

  // ---- SPAWN COMPLETE (closed — the copyable teardown) ----
  if (display.status === 'closed') {
    const cleanup = display.cleanup
    return (
      <Frame heading="SPAWN COMPLETE" onMinimize={onMinimize}>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
          <Row label="LANE" value={display.draftName} />
          <Row label="BRANCH" value={display.branch ?? display.targetBranch} />
          <Row label="WORKTREE" value={display.worktree ?? display.targetWorktree} />
          <div className="pt-2">
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: 'var(--holo-muted)' }}>
              CLEANUP — run from the main checkout to tear this worktree down
            </div>
            <pre
              className="text-[11px] font-mono whitespace-pre-wrap break-words rounded p-3 max-h-[40vh] overflow-y-auto"
              style={{ color: 'var(--holo-text)', background: 'var(--holo-bg)', border: '1px solid var(--holo-border)' }}
            >
              {cleanup ?? '(no worktree was recorded for this spawn)'}
            </pre>
          </div>
          {actionError && (
            <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
              {actionError}
            </div>
          )}
        </div>
        <div
          className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: 'var(--holo-border)' }}
        >
          {cleanup && (
            <Btn
              label={copied ? 'COPIED ✓' : 'COPY CLEANUP'}
              variant="accent"
              onClick={() => void onCopy(cleanup)}
            />
          )}
          <Btn label="CLOSE" onClick={onMinimize} />
        </div>
      </Frame>
    )
  }

  // ---- SPAWN FAILED (acknowledge) ----
  if (display.status === 'failed') {
    return (
      <Frame heading="SPAWN FAILED" onMinimize={onMinimize}>
        <div className="px-5 py-5 space-y-3">
          <Row label="LANE" value={display.draftName} />
          <Row label="STEP" value={display.step ?? '—'} />
          <div className="pt-1">
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: 'var(--holo-muted)' }}>
              ERROR
            </div>
            <pre
              className="text-[11px] font-mono whitespace-pre-wrap break-words rounded p-3 max-h-[40vh] overflow-y-auto"
              style={{ color: 'var(--holo-text)', background: 'var(--holo-bg)', border: '1px solid var(--holo-border)' }}
            >
              {display.error ?? '(no detail)'}
            </pre>
          </div>
        </div>
        <div
          className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: 'var(--holo-border)' }}
        >
          <Btn label="DISMISS" onClick={() => void act(() => window.aether.spawn.dismiss(display.id))} />
        </div>
      </Frame>
    )
  }

  // ---- DISMISSED (only reachable via a strip reopen) ----
  return (
    <Frame heading="SPAWN DISMISSED" onMinimize={onMinimize}>
      <div className="px-5 py-5 space-y-3">
        <Row label="LANE" value={display.draftName} />
        <Row label="STATUS" value={display.status} />
        <div className="text-[11px] font-mono pt-1" style={{ color: 'var(--holo-muted)' }}>
          This spawn was dismissed. Nothing to do here.
        </div>
      </div>
      <div
        className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t"
        style={{ borderColor: 'var(--holo-border)' }}
      >
        <Btn label="CLOSE" onClick={onMinimize} />
      </div>
    </Frame>
  )
}
