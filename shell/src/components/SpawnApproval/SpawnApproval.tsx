import { useCallback, useEffect, useState } from 'react'
import type { SpawnSnapshot, SpawnView } from '../../types/aether'
import { useSpawnUi } from '../../stores/spawnUi'

// The spawn actor's window — a global modal raised by the shell's SpawnService
// when a spawn request lands in the ledger (raven's request_spawn tool wrote it
// after a correct passphrase, or work_on_issue wrote a card-gated lane batch,
// #268). The Director approves or dismisses here; nothing spawns until Approve
// is pressed. A lane batch shares ONE card — single approve spawns all, cancel
// spawns none. Concurrency (#268 ruling): recipes serialize; up to max_lanes
// spawned records live at once. Orphaned tmux lanes get reattach offers here.
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
      } as React.CSSProperties}
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
        } as React.CSSProperties}
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
              } as React.CSSProperties}
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

// The card's LANE line: lane records (#268) are named by their issue, draft
// records by the draft name.
function laneLabel(v: SpawnView): string {
  if (v.kind === 'lane') {
    return `#${v.issue ?? '?'}${v.issueTitle ? ` — ${v.issueTitle}` : ''}`
  }
  return v.draftName
}

// The identity the approve/dismiss IPC acts on: a lane batch approves as one
// unit (#268 addendum — single approve spawns all), so the batch id stands in
// for the record id when present.
function actionId(v: SpawnView): string {
  return v.kind === 'lane' && v.batchId ? v.batchId : v.id
}

// The tmux-missing caution, shown wherever a lane is about to (or did) run on
// the pty fallback.
function TmuxWarning(): React.ReactElement {
  return (
    <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
      tmux is not installed — lanes will run in a plain terminal and DIE when
      Aether quits. Remedy: brew install tmux.
    </div>
  )
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

  const onReattach = useCallback(async (session: string) => {
    setActionError(null)
    const res = await window.aether.spawn.reattach(session)
    if (!res.ok) setActionError(res.error ?? 'reattach failed')
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

  // Orphaned lanes (#268): lane-* tmux sessions that survived an app quit.
  // With nothing else to show, the reattach offers get their own card.
  if (!display) {
    if (snap.orphans.length === 0) return null
    const orphanKey = `orphans:${snap.orphans.map((o) => o.session).join(',')}`
    if (minimizedKey === orphanKey) return null
    return (
      <Frame heading="ORPHANED LANES" onMinimize={() => minimize(orphanKey)}>
        <div className="px-5 py-5 space-y-3">
          <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
            These lane sessions are still alive in tmux from a previous run.
            Reattach to bring one back into a terminal window — its Claude Code
            session kept working while Aether was closed.
          </div>
          {snap.orphans.map((o) => (
            <div key={o.session} className="flex items-center justify-between gap-3">
              <Row
                label={o.session}
                value={o.issue ? `issue #${o.issue} — ${o.worktree ?? ''}` : (o.worktree ?? '(no ledger record)')}
              />
              <Btn label="REATTACH" variant="accent" onClick={() => void onReattach(o.session)} />
            </div>
          ))}
          {actionError && (
            <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
              {actionError}
            </div>
          )}
        </div>
      </Frame>
    )
  }

  // Batch-stable identity: every member of a lane batch shares one card, and
  // a status transition still re-raises a minimized card.
  const cardKey = `${actionId(display)}:${display.status}`
  if (minimizedKey === cardKey) return null
  const onMinimize = (): void => {
    setActionError(null)
    setCopied(false)
    minimize(cardKey)
  }

  const isRunning = display.id === snap.running || snap.queue.includes(display.id)

  // ---- SPAWNING (recipe in flight) ----
  if (isRunning) {
    const runningNow = snap.running ? (spawns.find((s) => s.id === snap.running) ?? display) : display
    return (
      <Frame heading="SPAWNING" onMinimize={onMinimize}>
        <div className="px-5 py-5 space-y-3">
          <Row label="LANE" value={laneLabel(runningNow)} />
          <Row label="STEP" value={snap.runningStep ?? 'starting'} />
          {snap.queue.length > 0 && (
            <Row label="QUEUED" value={`${snap.queue.length} more lane(s) in this approval — recipes run one at a time`} />
          )}
          <div className="text-[11px] font-mono pt-1" style={{ color: 'var(--holo-muted)' }}>
            Running the worktree recipe — fetch, worktree, submodules, install, then the
            aether-rag bootstrap (so the session's /mcp is warm) and the Claude Code
            launch{runningNow.kind === 'lane' ? ' in a detached tmux session with an attached terminal window; the desktop tiles when the whole approval is live' : ' in a Terminal window'}.
            This can take a few minutes on first install.
          </div>
        </div>
      </Frame>
    )
  }

  // ---- SPAWN REQUEST (awaiting approval) ----
  if (display.status === 'requested') {
    // A lane batch shares ONE card (#268 addendum): every still-requested
    // sibling is enumerated; the single approve spawns all, dismiss cancels all.
    const batch =
      display.kind === 'lane' && display.batchId
        ? spawns.filter((s) => s.batchId === display.batchId && s.status === 'requested')
        : [display]
    const wouldExceed = snap.liveCount + batch.length > snap.maxLanes
    const blocked = snap.running !== null || wouldExceed
    const blockedReason =
      snap.running !== null
        ? 'A spawn recipe is already running — approve again when it finishes.'
        : `Approving ${batch.length} lane(s) would exceed the cap (${snap.liveCount} live, max ${snap.maxLanes}). Mark a spawn complete first.`
    return (
      <Frame heading={batch.length > 1 ? `LANE SPAWN REQUEST — ${batch.length} LANES` : 'SPAWN REQUEST'} onMinimize={onMinimize}>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
          {batch.map((lane) => (
            <div key={lane.id} className="space-y-1">
              <Row label="LANE" value={laneLabel(lane)} />
              <Row label="BRANCH" value={lane.targetBranch} />
              <Row label="WORKTREE" value={lane.targetWorktree} />
              {lane.kind !== 'lane' && <Row label="DRAFT" value={lane.draftPath} />}
            </div>
          ))}
          <Row label="CAPACITY" value={`${snap.liveCount} of ${snap.maxLanes} lanes live`} />
          {!snap.tmuxAvailable && display.kind === 'lane' && <TmuxWarning />}
          <div className="pt-2">
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: 'var(--holo-muted)' }}>
              {display.kind === 'lane' ? 'KICKOFF PROMPT (per lane, issue number varies)' : 'FULL PROMPT'}
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
              {blockedReason}
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
          {wouldExceed && active && (
            <Btn label="MARK COMPLETE" onClick={() => void onComplete(active.id)} />
          )}
          <Btn
            label={batch.length > 1 ? 'DISMISS ALL' : 'DISMISS'}
            variant="danger"
            onClick={() => void act(() => window.aether.spawn.dismiss(actionId(display)))}
          />
          <Btn
            label={batch.length > 1 ? `APPROVE & SPAWN ${batch.length} LANES` : 'APPROVE & SPAWN'}
            variant="accent"
            disabled={blocked}
            title={blocked ? blockedReason : undefined}
            onClick={() => void act(() => window.aether.spawn.approve(actionId(display)))}
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
          <Row label="LANE" value={laneLabel(display)} />
          <Row label="BRANCH" value={display.branch ?? display.targetBranch} />
          <Row label="WORKTREE" value={display.worktree ?? display.targetWorktree} />
          {display.tmuxSession && <Row label="TMUX" value={display.tmuxSession} />}
          <Row label="RAG" value={ragLabel(display)} />
          <Row label="CAPACITY" value={`${snap.liveCount} of ${snap.maxLanes} lanes live`} />
          <div className="text-[11px] font-mono pt-1" style={{ color: 'var(--holo-muted)' }}>
            {display.tmuxSession
              ? `A Claude Code session is running inside tmux (${display.tmuxSession}) with a terminal window attached. Quitting Aether does NOT stop it — the lane survives detached and offers a reattach on the next boot. To kill it: tmux kill-session -t ${display.tmuxSession}. Mark complete when the lane is done to free its capacity slot.`
              : display.kind === 'lane'
                ? 'A Claude Code session is running in a plain terminal pane (tmux is not installed) — quitting Aether KILLS this lane. Mark complete when the session is done.'
                : 'A Claude Code session is running in its own Terminal window. Closing that window stops the agent (the kill switch). Mark complete when the session is done. You can also minimize this window and reopen it from the Spawns strip.'}
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
          <Row label="LANE" value={laneLabel(display)} />
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
          <Row label="LANE" value={laneLabel(display)} />
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
        <Row label="LANE" value={laneLabel(display)} />
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
