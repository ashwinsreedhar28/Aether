import { useCallback, useEffect, useState } from 'react'
import type { OrphanLane, SpawnSnapshot, SpawnView, TeardownRecord } from '../../types/aether'
import { useSpawnUi } from '../../stores/spawnUi'
import {
  foldGateComments,
  gatePhase,
  resolveReviseAction,
  shouldToastGate,
  type GatePhase,
  type LaneGateState,
} from '../../utils/laneGate'

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
// built from the recorded worktree/branch. Lane records also carry CLOSE OUT
// (#317): the shell executes that same teardown itself, behind guards and a
// two-beat confirm — the copyable block stays as the manual escape hatch.
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

// Action rows for orphaned lane sessions — one component behind BOTH hosts
// (the per-card strip below and the standalone ORPHANED LANES card), so the
// affordance set never diverges between them. Record-backed rows carry a
// ghost COMPLETE beside REATTACH (#318: the #302 contract — a finished lane
// must be closable wherever its reattach offer lives), with the full #308
// warn-and-force semantics: a live-session refusal arms COMPLETE ANYWAY on
// that row, never a silent terminal write. Self-contained error/warn state so
// any card branch can host it without wiring; on success the main side drops
// the orphan and broadcasts, so the row disappears with the next snapshot.
function OrphanRows({
  orphans,
  accent,
}: {
  orphans: OrphanLane[]
  // Accent the REATTACH buttons — the standalone card's rows are its primary
  // affordance; on the strip they ride muted under another card's actions.
  accent?: boolean
}): React.ReactElement | null {
  const [error, setError] = useState<string | null>(null)
  // The recordId whose complete() was refused with code 'live-session' (#305):
  // that row re-offers the same action as an explicit COMPLETE ANYWAY.
  const [warnId, setWarnId] = useState<string | null>(null)
  if (orphans.length === 0) return null
  const reattach = async (session: string): Promise<void> => {
    setError(null)
    const res = await window.aether.spawn.reattach(session)
    if (!res.ok) setError(res.error ?? 'reattach failed')
  }
  const complete = async (recordId: string, force = false): Promise<void> => {
    setError(null)
    const res = await window.aether.spawn.complete(recordId, force)
    if (!res.ok) {
      if (res.code === 'live-session') setWarnId(recordId)
      setError(res.error ?? 'complete failed')
      return
    }
    setWarnId(null)
  }
  return (
    <>
      {orphans.map((o) => {
        const rid = o.recordId
        return (
          <div key={o.session} className="flex items-center justify-between gap-3">
            <Row
              label={o.session}
              value={o.issue ? `issue #${o.issue} — ${o.worktree ?? ''}` : (o.worktree ?? '(no ledger record)')}
            />
            <div className="flex items-center gap-2 shrink-0">
              <Btn
                label="REATTACH"
                variant={accent ? 'accent' : 'ghost'}
                onClick={() => void reattach(o.session)}
              />
              {rid &&
                (warnId === rid ? (
                  <Btn
                    label="COMPLETE ANYWAY"
                    variant="danger"
                    title="The tmux session stays alive — the record's cleanup block kills it"
                    onClick={() => void complete(rid, true)}
                  />
                ) : (
                  <Btn
                    label="COMPLETE"
                    title="Close this lane's record and free its capacity slot"
                    onClick={() => void complete(rid)}
                  />
                ))}
            </div>
          </div>
        )
      })}
      {error && (
        <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
          {error}
        </div>
      )}
    </>
  )
}

// The strip host: reattach/complete rows ADDITIVE to whatever card is showing
// (#302 defect 7: main seeded orphans after relaunch, but the only rendering
// path lived behind "no candidate" — lane-232's own SPAWN ACTIVE card
// shadowed every reattach affordance). The full ORPHANED LANES card below
// still covers the nothing-else-to-show boot.
function OrphanStrip({ orphans }: { orphans: OrphanLane[] }): React.ReactElement | null {
  if (orphans.length === 0) return null
  return (
    <div className="pt-3 mt-1 space-y-2" style={{ borderTop: '1px solid var(--holo-border)' }}>
      <div className="text-[10px] tracking-[0.2em]" style={{ color: 'var(--holo-muted)' }}>
        ORPHANED LANES — alive in tmux, no terminal attached
      </div>
      <OrphanRows orphans={orphans} />
    </div>
  )
}

// ---- the spawned card (#310: gate-aware) -------------------------------------

// Pull-based gate state for a spawned lane (#310): ONE github.get_issue read
// when the card opens, plus the explicit REFRESH — no background poller in v1
// by spec. The issue thread is the machine-readable lane channel; the fold
// matches the fixed comment prefixes the kickoff dictates and only counts
// comments newer than this record's spawned event.
function useLaneGate(
  issue: number | null,
  spawnedAtIso: string,
): {
  gate: LaneGateState | null
  checking: boolean
  gateError: string | null
  refresh: () => void
} {
  const [gate, setGate] = useState<LaneGateState | null>(null)
  const [checking, setChecking] = useState(false)
  const [gateError, setGateError] = useState<string | null>(null)
  const check = useCallback(async () => {
    if (issue == null) return
    setChecking(true)
    setGateError(null)
    try {
      const res = await window.aether.mesh.invoke('github.get_issue', { number: issue })
      if (res.ok && res.envelope) {
        const payload = res.envelope.payload as { comments?: unknown; title?: unknown }
        const next = foldGateComments(payload.comments, spawnedAtIso)
        setGate(next)
        // READY TO TEST toast (#340): one per gate arrival (re-gates included;
        // refreshes of the same report excluded — shouldToastGate claims it).
        // Fire-and-forget over the existing shell → host_notifications.notify
        // edge; a down notifier must never surface as a gate-check failure.
        if (shouldToastGate(issue, next)) {
          const title = typeof payload.title === 'string' ? payload.title : ''
          void window.aether.mesh
            .invoke('host_notifications.notify', {
              title: 'Aether',
              body: `Lane ${issue} is ready to test${title ? ` — ${title}` : ''}`,
            })
            .catch(() => {})
        }
      } else {
        setGateError(res.error?.message ?? 'gate check unavailable')
      }
    } catch (e) {
      setGateError(e instanceof Error ? e.message : 'gate check unavailable')
    } finally {
      setChecking(false)
    }
  }, [issue, spawnedAtIso])
  useEffect(() => {
    void check()
  }, [check])
  return { gate, checking, gateError, refresh: () => void check() }
}

// The card-side CLOSE OUT state machine (#317), shared by the active card and
// the TEARDOWN FAILED retry card. Two-beat by design (§11.4 — destroying a
// worktree behind one tap is the hazard the copy-only era guarded against):
// the first press arms, the second executes. A 'dirty' refusal — whether from
// this card's own press or a voice close_lane the shell refused — swaps the
// button to an explicit CLOSE ANYWAY that re-requests with force (#308
// warn-and-force law). 'pr-open' / 'lane-busy' refusals surface as text only:
// they have no force path.
function useCloseOut(
  issue: number | null,
  lastTeardown: TeardownRecord | null,
): {
  closing: boolean
  closeError: string | null
  closePhase: 'idle' | 'armed' | 'warn'
  onCloseOut: () => Promise<void>
} {
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [localPhase, setLocalPhase] = useState<'armed' | 'warn' | null>(null)
  // A voice-initiated teardown the shell refused as 'dirty' arms the warn
  // directly — the card is where the #308 explicit force lives.
  const derivedWarn = lastTeardown?.status === 'failed' && lastTeardown.code === 'dirty'
  const closePhase: 'idle' | 'armed' | 'warn' = localPhase ?? (derivedWarn ? 'warn' : 'idle')

  const onCloseOut = async (): Promise<void> => {
    if (issue == null || closing) return
    if (closePhase === 'idle') {
      // First beat: arm. No IPC, no ledger line.
      setCloseError(null)
      setLocalPhase('armed')
      return
    }
    setClosing(true)
    setCloseError(null)
    const res = await window.aether.spawn.closeLane(issue, closePhase === 'warn')
    setClosing(false)
    if (res.ok) {
      setLocalPhase(null)
      return // the record folds to 'closed'; the card re-renders off the snapshot
    }
    setCloseError(res.error ?? 'close-out failed')
    setLocalPhase(res.code === 'dirty' ? 'warn' : null)
  }
  return { closing, closeError, closePhase, onCloseOut }
}

// The CLOSE OUT footer label for each phase of the state machine above.
function closeOutLabel(phase: 'idle' | 'armed' | 'warn', closing: boolean): string {
  if (closing) return 'CLOSING…'
  if (phase === 'armed') return 'CONFIRM CLOSE OUT'
  if (phase === 'warn') return 'CLOSE ANYWAY'
  return 'CLOSE OUT'
}

// The lane's newest teardown line for the TEARDOWN row — voice or card, the
// outcome is observable either way (the relay row's sibling).
function teardownRowValue(t: TeardownRecord): string {
  if (t.status === 'done') return 'closed out ✓ — session, worktree, and branch are gone'
  if (t.status === 'failed') return `close-out failed — ${t.error ?? 'no detail'}`
  return 'closing…'
}

// The SPAWN ACTIVE card, gate-aware for lane records (#310): a GATE REPORT
// comment on the issue thread newer than the spawn renders LANE AT GATE with
// the report inline and a PROCEED button (the "clean, proceed" relay — the
// same ledger path the lane_proceed voice tool writes); a PR OPENED comment
// upgrades the state and links the PR. The revision loop (#339): AT GATE and
// REVISING carry a feedback input whose REVISE posts the typed text to the
// thread as DIRECTOR FEEDBACK and relays the fixed re-gate order; DIRECTOR
// FEEDBACK newer than the report renders LANE REVISING with the feedback
// inline, and PROCEED stays available there as the accept-anyway override.
// Draft spawns render exactly as before. Mounted with key={display.id} so
// gate/relay state never leaks across records.
function ActiveCard({
  display,
  snap,
  displayOrphan,
  otherOrphans,
  liveWarn,
  actionError,
  onComplete,
  onReattach,
  onMinimize,
}: {
  display: SpawnView
  snap: SpawnSnapshot
  displayOrphan: OrphanLane | null
  otherOrphans: OrphanLane[]
  liveWarn: boolean
  actionError: string | null
  onComplete: (id: string, force?: boolean) => void
  onReattach: (session: string) => void
  onMinimize: () => void
}): React.ReactElement {
  // Gate state applies to lane records only — a draft spawn has no issue
  // thread to fold.
  const issue = display.kind === 'lane' ? (display.issue ?? null) : null
  const { gate, checking, gateError, refresh } = useLaneGate(issue, display.ts)
  // Pure fold → phase (#339): PR OPENED > REVISING (feedback newer than the
  // report) > AT GATE > working. laneGate.gatePhase owns the precedence.
  const phase: GatePhase = gatePhase(gate)
  const prUrl = gate?.pr?.url ?? null

  // PROCEED outcome, local to this card; the ledger keeps the audit trail
  // (the RELAY row reads it back from the snapshot).
  const [proceeding, setProceeding] = useState(false)
  const [proceedError, setProceedError] = useState<string | null>(null)
  const onProceed = async (): Promise<void> => {
    if (issue == null) return
    setProceeding(true)
    setProceedError(null)
    const res = await window.aether.spawn.proceed(issue)
    setProceeding(false)
    if (!res.ok) setProceedError(res.error ?? 'relay failed')
  }

  // REVISE (#339): typed feedback posts to the thread then relays the fixed
  // re-gate order; an empty press against fresh thread feedback relays only;
  // an empty press with nothing to revise against refuses by name — the
  // decision is resolveReviseAction's (pure, unit-tested), this handler just
  // dispatches it. Post outcome is card-local; the relay's audit trail is
  // the ledger's RELAY row, same as PROCEED.
  const [feedbackInput, setFeedbackInput] = useState('')
  const [revisingBusy, setRevisingBusy] = useState(false)
  const [reviseError, setReviseError] = useState<string | null>(null)
  const [revisePosted, setRevisePosted] = useState(false)
  const onRevise = async (): Promise<void> => {
    if (issue == null || revisingBusy) return
    const action = resolveReviseAction(gate, feedbackInput)
    if (action.kind === 'refuse') {
      setReviseError(action.error)
      return
    }
    setRevisingBusy(true)
    setReviseError(null)
    setRevisePosted(false)
    const res = await window.aether.spawn.revise(
      issue,
      action.kind === 'post-and-relay' ? action.text : undefined,
    )
    setRevisingBusy(false)
    if (!res.ok) {
      setReviseError(res.error ?? 'revise failed')
      return
    }
    setFeedbackInput('')
    setRevisePosted(res.posted === true)
    // Re-fold the thread: the fresh DIRECTOR FEEDBACK comment flips the card
    // to REVISING and renders the posted body inline.
    refresh()
  }

  // The lane's newest relay (snapshot arrives newest-first) — makes a voice
  // "proceed lane N" observable on the card, success or failure.
  const lastRelay = issue != null ? (snap.relays.find((r) => r.issue === issue) ?? null) : null

  // The lane's newest teardown (#317) — same observability for "close out
  // lane N", and its 'dirty' code arms the CLOSE ANYWAY warn below.
  const lastTeardown =
    issue != null ? (snap.teardowns.find((t) => t.issue === issue) ?? null) : null
  const { closing, closeError, closePhase, onCloseOut } = useCloseOut(issue, lastTeardown)

  const heading =
    phase === 'pr-opened'
      ? 'LANE PR OPENED'
      : phase === 'revising'
        ? 'LANE REVISING'
        : phase === 'at-gate'
          ? 'LANE AT GATE'
          : 'SPAWN ACTIVE'

  return (
    <Frame heading={heading} onMinimize={onMinimize}>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        <Row label="LANE" value={laneLabel(display)} />
        <Row label="BRANCH" value={display.branch ?? display.targetBranch} />
        <Row label="WORKTREE" value={display.worktree ?? display.targetWorktree} />
        {display.tmuxSession && <Row label="TMUX" value={display.tmuxSession} />}
        <Row label="RAG" value={ragLabel(display)} />
        <Row label="CAPACITY" value={`${snap.liveCount} of ${snap.maxLanes} lanes live`} />
        {issue != null && (
          <Row
            label="GATE"
            value={
              checking
                ? 'checking the issue thread…'
                : phase === 'pr-opened'
                  ? (gate?.pr?.body.split('\n')[0]?.trim() ?? 'PR opened')
                  : phase === 'revising'
                    ? 'REVISING — latest DIRECTOR FEEDBACK below; REVISE re-relays the re-gate order'
                    : phase === 'at-gate'
                      ? 'AT GATE — report below; PROCEED relays "clean, proceed"'
                      : gateError
                        ? `check failed — ${gateError}`
                        : 'working — no gate report on the issue thread yet'
            }
          />
        )}
        {lastRelay && (
          <Row
            label="RELAY"
            value={
              lastRelay.status === 'relayed'
                ? `"${lastRelay.text}" relayed ✓`
                : lastRelay.status === 'failed'
                  ? `relay failed — ${lastRelay.error ?? 'no detail'}`
                  : `"${lastRelay.text}" pending…`
            }
          />
        )}
        {lastTeardown && <Row label="TEARDOWN" value={teardownRowValue(lastTeardown)} />}
        {revisePosted && (
          <Row label="FEEDBACK" value="DIRECTOR FEEDBACK posted to the issue thread ✓" />
        )}
        {closePhase === 'armed' && (
          <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
            CONFIRM CLOSE OUT runs the teardown: tmux session killed, worktree removed, branch
            deleted, record closed. An open PR or a busy pane refuses; uncommitted/unpushed work
            warns first.
          </div>
        )}
        {closePhase === 'warn' && (
          <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
            This lane has uncommitted or unpushed work — CLOSE ANYWAY destroys it permanently.
          </div>
        )}
        {phase === 'revising' && gate?.feedback && (
          <div className="pt-2">
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: 'var(--holo-muted)' }}>
              DIRECTOR FEEDBACK — the lane&apos;s current revision contract
            </div>
            <pre
              className="text-[11px] font-mono whitespace-pre-wrap break-words rounded p-3 max-h-[34vh] overflow-y-auto"
              style={{ color: 'var(--holo-text)', background: 'var(--holo-bg)', border: '1px solid var(--holo-border)' }}
            >
              {gate.feedback}
            </pre>
          </div>
        )}
        {gate?.report && (
          <div className="pt-2">
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: 'var(--holo-muted)' }}>
              GATE REPORT — posted to the issue thread
            </div>
            <pre
              className="text-[11px] font-mono whitespace-pre-wrap break-words rounded p-3 max-h-[34vh] overflow-y-auto"
              style={{ color: 'var(--holo-text)', background: 'var(--holo-bg)', border: '1px solid var(--holo-border)' }}
            >
              {gate.report}
            </pre>
          </div>
        )}
        {(phase === 'at-gate' || phase === 'revising') && (
          <div className="pt-2">
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: 'var(--holo-muted)' }}>
              FEEDBACK — posted as &quot;DIRECTOR FEEDBACK — …&quot; on the issue thread
            </div>
            <textarea
              value={feedbackInput}
              onChange={(e) => setFeedbackInput(e.target.value)}
              rows={3}
              placeholder="What the lane must address before it re-gates (REVISE posts it, then relays the fixed re-gate order)"
              className="w-full text-[11px] font-mono rounded p-2 resize-y outline-none"
              style={{
                color: 'var(--holo-text)',
                background: 'var(--holo-bg)',
                border: '1px solid var(--holo-border)',
              }}
            />
          </div>
        )}
        <div className="text-[11px] font-mono pt-1" style={{ color: 'var(--holo-muted)' }}>
          {display.tmuxSession
            ? displayOrphan
              ? `The Claude Code session is alive inside tmux (${display.tmuxSession}) but NO terminal window is attached — the relaunch case. Reattach to bring it back into a terminal window, or kill it: tmux kill-session -t ${display.tmuxSession}. Mark complete when the lane is done to free its capacity slot.`
              : `A Claude Code session is running inside tmux (${display.tmuxSession}) with a terminal window attached. Quitting Aether does NOT stop it — the lane survives detached and offers a reattach on the next boot. To kill it: tmux kill-session -t ${display.tmuxSession}. Mark complete when the lane is done to free its capacity slot.`
            : display.kind === 'lane'
              ? 'A Claude Code session is running in a plain terminal pane (tmux is not installed) — quitting Aether KILLS this lane. Mark complete when the session is done.'
              : 'A Claude Code session is running in its own Terminal window. Closing that window stops the agent (the kill switch). Mark complete when the session is done. You can also minimize this window and reopen it from the Spawns strip.'}
        </div>
        {(actionError || proceedError || reviseError || closeError) && (
          <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
            {actionError ?? proceedError ?? reviseError ?? closeError}
          </div>
        )}
        <OrphanStrip orphans={otherOrphans} />
      </div>
      <div
        className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t"
        style={{ borderColor: 'var(--holo-border)' }}
      >
        {issue != null && (
          <Btn
            label={checking ? 'CHECKING…' : 'REFRESH'}
            disabled={checking}
            title="Re-read the issue thread for a gate report / PR link"
            onClick={() => {
              refresh()
              // Explicit refresh is an orphan-freshness trigger too (#318).
              void window.aether.spawn.refreshOrphans()
            }}
          />
        )}
        {prUrl && (
          <Btn
            label="OPEN PR"
            variant="accent"
            onClick={() => void window.aether.shell.openExternal(prUrl)}
          />
        )}
        {(phase === 'at-gate' || phase === 'revising') && (
          // REVISE is primary while the lane owes a revision; on AT GATE it
          // stands ready beside PROCEED for the first feedback round.
          <Btn
            label={revisingBusy ? (feedbackInput.trim() ? 'POSTING…' : 'RELAYING…') : 'REVISE'}
            variant={phase === 'revising' ? 'accent' : 'ghost'}
            disabled={revisingBusy || proceeding}
            title={`Posts typed feedback to the issue thread, then types "revise per the latest DIRECTOR FEEDBACK, then re-gate" into the lane's pane`}
            onClick={() => void onRevise()}
          />
        )}
        {(phase === 'at-gate' || phase === 'revising') && (
          // From REVISING this is the Director's accept-anyway override — the
          // feedback stays on the thread as history, the lane ships.
          <Btn
            label={proceeding ? 'RELAYING…' : 'PROCEED'}
            variant={phase === 'at-gate' ? 'accent' : 'ghost'}
            disabled={proceeding || revisingBusy}
            title={`Types "clean, proceed" into the lane's pane — it will open its PR`}
            onClick={() => void onProceed()}
          />
        )}
        {displayOrphan && (
          <Btn
            label="REATTACH"
            variant="accent"
            onClick={() => onReattach(displayOrphan.session)}
          />
        )}
        {issue != null && (
          // The spawn's mirror (#317): guarded teardown through the same
          // ledger the voice close_lane tool writes. Two-beat confirm; the
          // 'dirty' warn swaps in CLOSE ANYWAY (#308 warn-and-force).
          <Btn
            label={closeOutLabel(closePhase, closing)}
            variant={closePhase === 'idle' ? 'ghost' : 'danger'}
            disabled={closing}
            title="Tear this lane down: kill its session, remove its worktree, delete its branch, close the record"
            onClick={() => void onCloseOut()}
          />
        )}
        {liveWarn ? (
          // The live-session refusal is showing (#305): the same action,
          // re-offered deliberately. Force-close frees the capacity slot;
          // the session survives until the cleanup block's kill-session.
          <Btn
            label="COMPLETE ANYWAY"
            variant="danger"
            title="The tmux session stays alive — the cleanup block on the next card kills it"
            onClick={() => onComplete(display.id, true)}
          />
        ) : (
          <Btn
            label="MARK COMPLETE"
            variant={displayOrphan || phase === 'at-gate' || phase === 'revising' ? 'ghost' : 'accent'}
            onClick={() => onComplete(display.id)}
          />
        )}
      </div>
    </Frame>
  )
}

// The TEARDOWN FAILED card (#317): a destruction step failed mid-teardown, so
// the record still holds its capacity slot (only 'closed' frees it). Offers
// the retry — executor steps are precondition-guarded, so a retry resumes
// where the failure left off — plus the copyable cleanup block as the manual
// escape hatch.
function TeardownFailedCard({
  display,
  snap,
  otherOrphans,
  actionError,
  onCopy,
  copied,
  onMinimize,
}: {
  display: SpawnView
  snap: SpawnSnapshot
  otherOrphans: OrphanLane[]
  actionError: string | null
  onCopy: (text: string) => void
  copied: boolean
  onMinimize: () => void
}): React.ReactElement {
  const issue = display.issue ?? null
  const lastTeardown =
    issue != null ? (snap.teardowns.find((t) => t.issue === issue) ?? null) : null
  const { closing, closeError, closePhase, onCloseOut } = useCloseOut(issue, lastTeardown)
  return (
    <Frame heading="TEARDOWN FAILED" onMinimize={onMinimize}>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        <Row label="LANE" value={laneLabel(display)} />
        <Row label="BRANCH" value={display.branch ?? display.targetBranch} />
        <Row label="WORKTREE" value={display.worktree ?? display.targetWorktree} />
        <Row label="STEP" value={display.step ?? '—'} />
        <Row label="CAPACITY" value={`${snap.liveCount} of ${snap.maxLanes} lanes live — this record still holds its slot`} />
        <div className="pt-1">
          <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: 'var(--holo-muted)' }}>
            ERROR
          </div>
          <pre
            className="text-[11px] font-mono whitespace-pre-wrap break-words rounded p-3 max-h-[24vh] overflow-y-auto"
            style={{ color: 'var(--holo-text)', background: 'var(--holo-bg)', border: '1px solid var(--holo-border)' }}
          >
            {display.error ?? '(no detail)'}
          </pre>
        </div>
        <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
          The teardown stopped at the step above; what already succeeded stays done. CLOSE OUT
          retries from where it left off, or run the cleanup block below by hand — the record
          closes (and frees its slot) only when every step has succeeded.
        </div>
        {display.cleanup && (
          <pre
            className="text-[11px] font-mono whitespace-pre-wrap break-words rounded p-3 max-h-[24vh] overflow-y-auto"
            style={{ color: 'var(--holo-text)', background: 'var(--holo-bg)', border: '1px solid var(--holo-border)' }}
          >
            {display.cleanup}
          </pre>
        )}
        {closePhase === 'warn' && (
          <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
            This lane has uncommitted or unpushed work — CLOSE ANYWAY destroys it permanently.
          </div>
        )}
        {(actionError || closeError) && (
          <div className="text-[11px] font-mono" style={{ color: 'var(--holo-muted)' }}>
            {actionError ?? closeError}
          </div>
        )}
        <OrphanStrip orphans={otherOrphans} />
      </div>
      <div
        className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t"
        style={{ borderColor: 'var(--holo-border)' }}
      >
        {display.cleanup && (
          <Btn
            label={copied ? 'COPIED ✓' : 'COPY CLEANUP'}
            onClick={() => onCopy(display.cleanup ?? '')}
          />
        )}
        <Btn
          label={closeOutLabel(closePhase, closing)}
          variant={closePhase === 'idle' ? 'accent' : 'danger'}
          disabled={closing}
          title="Retry the teardown from the failed step"
          onClick={() => void onCloseOut()}
        />
      </div>
    </Frame>
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
  // The id whose complete() was refused with code 'live-session' (#305): the
  // record's tmux session is still alive. The footer swaps MARK COMPLETE for an
  // explicit COMPLETE ANYWAY while the warning shows — never a silent terminal
  // write on a live record (the lane-232 incident).
  const [liveWarnId, setLiveWarnId] = useState<string | null>(null)
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
    // Pull-based orphan freshness (#318): re-probe behind the fast list()
    // seed — a changed list lands via the broadcast. Fire-and-forget so a
    // slow tmux never delays the card's first paint.
    void window.aether.spawn.refreshOrphans()
    return () => {
      alive = false
      unsub()
    }
  }, [])

  // Card open is a freshness trigger (#318): a summon (Lanes row click,
  // Spawns strip, voice show_lane_card) re-probes so the raised card's orphan
  // affordances reflect tmux NOW, not the boot cache.
  useEffect(() => {
    if (openedId != null) void window.aether.spawn.refreshOrphans()
  }, [openedId])

  const act = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setActionError(null)
      const res = await fn()
      if (!res.ok) setActionError(res.error ?? 'action failed')
    },
    [],
  )

  const onComplete = useCallback(async (id: string, force = false) => {
    setActionError(null)
    const res = await window.aether.spawn.complete(id, force)
    if (!res.ok) {
      // Live-session refusal (#305): arm the COMPLETE ANYWAY affordance and
      // show the warning; the next press carries force.
      if (res.code === 'live-session') setLiveWarnId(id)
      setActionError(res.error ?? 'action failed')
      return
    }
    setLiveWarnId(null)
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

  // Candidate: the highest-priority record worth surfacing. A pending request
  // outranks everything — busy gates the Approve button (`blocked` below),
  // never visibility (#300: a request that landed mid-recipe sat invisible
  // behind the in-flight card until the app restarted) — then the recipe in
  // flight, a live spawn, a just-closed spawn's cleanup, a failed teardown
  // still holding capacity (#317), a failure to acknowledge. Members of the
  // approved batch still read 'requested' in the ledger while they hold the
  // running/queued slots; they render as SPAWNING, so the pending-request
  // finder skips them.
  const runningRec = snap.running ? (spawns.find((s) => s.id === snap.running) ?? null) : null
  const requested =
    spawns.find(
      (s) => s.status === 'requested' && s.id !== snap.running && !snap.queue.includes(s.id),
    ) ?? null
  const active = spawns.find((s) => s.status === 'spawned') ?? null
  const tornFailed = spawns.find((s) => s.status === 'teardown_failed') ?? null
  const failed = spawns.find((s) => s.status === 'failed') ?? null
  const justClosed = justClosedId
    ? (spawns.find((s) => s.id === justClosedId && s.status === 'closed') ?? null)
    : null
  const candidate = requested ?? runningRec ?? active ?? justClosed ?? tornFailed ?? failed ?? null

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
            session kept working while Aether was closed — or complete a
            finished lane's record right here.
          </div>
          <OrphanRows orphans={snap.orphans} accent />
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
    setLiveWarnId(null)
    setCopied(false)
    minimize(cardKey)
  }

  const isRunning = display.id === snap.running || snap.queue.includes(display.id)

  // Orphan affordances are ADDITIVE — never a competing card state (#302
  // defect 7). The displayed spawned record's own orphan becomes an inline
  // REATTACH beside MARK COMPLETE; every other orphan (hand-made lane-*
  // sessions, or records the chain didn't pick) rides as compact rows on
  // whatever card is showing. The one-candidate chain above stays intact —
  // requested still outranks everything per the #302 visibility ruling.
  const displayOrphan =
    display.status === 'spawned' && display.tmuxSession
      ? (snap.orphans.find((o) => o.session === display.tmuxSession) ?? null)
      : null
  const otherOrphans = snap.orphans.filter((o) => o !== displayOrphan)

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
          <OrphanStrip orphans={otherOrphans} />
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
        : `Approving ${batch.length} lane(s) would exceed the cap (${snap.liveCount} live, max ${snap.maxLanes}). Mark a spawn complete first (open its card from the Spawns strip or its Lanes row).`
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
          <OrphanStrip orphans={otherOrphans} />
        </div>
        <div
          className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: 'var(--holo-border)' }}
        >
          {/* State-gated actions (#305 addendum): a requested card carries
              Approve + Dismiss ONLY. The old over-cap MARK COMPLETE shortcut
              acted on a DIFFERENT (live) record from the requested card — the
              lane-232 hazard class — so it is absent, not disabled; the
              blocked line names where the real action lives. */}
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

  // ---- SPAWN ACTIVE (live worktree; lane records are gate-aware, #310) ----
  if (display.status === 'spawned') {
    return (
      <ActiveCard
        // Keyed per record: gate + relay state must never leak across spawns
        // sharing the mounted component position.
        key={display.id}
        display={display}
        snap={snap}
        displayOrphan={displayOrphan}
        otherOrphans={otherOrphans}
        liveWarn={liveWarnId === display.id}
        actionError={actionError}
        onComplete={(id, force) => void onComplete(id, force)}
        onReattach={(session) => void onReattach(session)}
        onMinimize={onMinimize}
      />
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
          <OrphanStrip orphans={otherOrphans} />
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

  // ---- TEARDOWN FAILED (#317 — retry or hand-clean; the slot stays held) ----
  if (display.status === 'teardown_failed') {
    return (
      <TeardownFailedCard
        // Keyed per record: close-out confirm state must never leak across
        // records sharing the mounted position (the ActiveCard rule).
        key={display.id}
        display={display}
        snap={snap}
        otherOrphans={otherOrphans}
        actionError={actionError}
        onCopy={(text) => void onCopy(text)}
        copied={copied}
        onMinimize={onMinimize}
      />
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
          <OrphanStrip orphans={otherOrphans} />
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
        <OrphanStrip orphans={otherOrphans} />
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
