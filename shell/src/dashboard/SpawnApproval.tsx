import { useCallback, useEffect, useState } from 'react'
import type { SpawnSnapshot } from '../../electron/preload'

// The spawn approval card — a global modal raised by the shell's SpawnService
// when a spawn request lands in the ledger (raven's request_spawn tool wrote it
// after a correct passphrase). The Director approves or dismisses here; nothing
// spawns until Approve is pressed. Concurrency is capped at one live spawn — while
// a spawn is active, Approve is disabled with the reason shown and the card offers
// "Mark complete". Closing the spawned Terminal window is the kill switch.
//
// The passphrase never reaches this layer: it was verified server-side before the
// request was recorded.

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
  children,
}: {
  heading: string
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
          className="shrink-0 px-5 py-3 text-[11px] tracking-[0.3em] border-b"
          style={{ color: 'var(--holo-accent)', borderColor: 'var(--holo-border)' }}
        >
          {heading}
        </div>
        {children}
      </div>
    </div>
  )
}

// ---- the card --------------------------------------------------------------

export function SpawnApproval(): React.ReactElement | null {
  const [snap, setSnap] = useState<SpawnSnapshot | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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

  if (!snap) return null

  const spawns = snap.spawns
  const running = snap.running
  const active = spawns.find((s) => s.status === 'spawned')
  const requested = spawns.find((s) => s.status === 'requested')
  const failed = spawns.find((s) => s.status === 'failed')

  // Priority: a recipe in flight, then a pending request (with the concurrency
  // gate surfaced), then a live spawn to close, then a failure to acknowledge.
  if (running) {
    const rec = spawns.find((s) => s.id === running)
    return (
      <Frame heading="SPAWNING">
        <div className="px-5 py-5 space-y-3">
          <Row label="LANE" value={rec?.draftName ?? running} />
          <Row label="STEP" value={snap.runningStep ?? 'starting'} />
          <div className="text-[11px] font-mono pt-1" style={{ color: 'var(--holo-muted)' }}>
            Running the worktree recipe — fetch, worktree, submodules, install, then a
            Terminal launches Claude Code against the lane. This can take a few minutes
            on first install.
          </div>
        </div>
      </Frame>
    )
  }

  if (requested) {
    const blocked = snap.busy // an active spawn is holding the gate
    return (
      <Frame heading="SPAWN REQUEST">
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
          <Row label="LANE" value={requested.draftName} />
          <Row label="BRANCH" value={requested.targetBranch} />
          <Row label="WORKTREE" value={requested.targetWorktree} />
          <Row label="DRAFT" value={requested.draftPath} />
          <div className="pt-2">
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: 'var(--holo-muted)' }}>
              FULL PROMPT
            </div>
            <pre
              className="text-[11px] font-mono whitespace-pre-wrap break-words rounded p-3 max-h-[34vh] overflow-y-auto"
              style={{ color: 'var(--holo-text)', background: 'var(--holo-bg)', border: '1px solid var(--holo-border)' }}
            >
              {requested.preview ?? '(no preview)'}
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
            <Btn label="MARK COMPLETE" onClick={() => void act(() => window.aether.spawn.complete(active.id))} />
          )}
          <Btn label="DISMISS" variant="danger" onClick={() => void act(() => window.aether.spawn.dismiss(requested.id))} />
          <Btn
            label="APPROVE & SPAWN"
            variant="accent"
            disabled={blocked}
            title={blocked ? 'A spawn is already running' : undefined}
            onClick={() => void act(() => window.aether.spawn.approve(requested.id))}
          />
        </div>
      </Frame>
    )
  }

  if (active) {
    return (
      <Frame heading="SPAWN ACTIVE">
        <div className="px-5 py-5 space-y-3">
          <Row label="LANE" value={active.draftName} />
          <Row label="BRANCH" value={active.branch ?? active.targetBranch} />
          <Row label="WORKTREE" value={active.worktree ?? active.targetWorktree} />
          <div className="text-[11px] font-mono pt-1" style={{ color: 'var(--holo-muted)' }}>
            A Claude Code session is running in its own Terminal window. Closing that
            window stops the agent (the kill switch). Mark complete when the session is
            done — only one spawn runs at a time.
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
          <Btn label="MARK COMPLETE" variant="accent" onClick={() => void act(() => window.aether.spawn.complete(active.id))} />
        </div>
      </Frame>
    )
  }

  if (failed) {
    return (
      <Frame heading="SPAWN FAILED">
        <div className="px-5 py-5 space-y-3">
          <Row label="LANE" value={failed.draftName} />
          <Row label="STEP" value={failed.step ?? '—'} />
          <div className="pt-1">
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: 'var(--holo-muted)' }}>
              ERROR
            </div>
            <pre
              className="text-[11px] font-mono whitespace-pre-wrap break-words rounded p-3 max-h-[40vh] overflow-y-auto"
              style={{ color: 'var(--holo-text)', background: 'var(--holo-bg)', border: '1px solid var(--holo-border)' }}
            >
              {failed.error ?? '(no detail)'}
            </pre>
          </div>
        </div>
        <div
          className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: 'var(--holo-border)' }}
        >
          <Btn label="DISMISS" onClick={() => void act(() => window.aether.spawn.dismiss(failed.id))} />
        </div>
      </Frame>
    )
  }

  return null
}
