import { useCallback, useEffect, useState } from 'react'
import type { MeshInvokeResult, MeshStatus } from '../../../electron/preload'

type RoundTripState =
  | { kind: 'idle' }
  | { kind: 'firing' }
  | { kind: 'ok'; durationMs: number; deliveredAt: string }
  | { kind: 'error'; durationMs: number; message: string; details?: unknown }

const CORE_POLL_MS = 2_000

function StatusPill({ status }: { status: MeshStatus | null }) {
  // "core: online" means Core is responding to /v0/healthz. It deliberately
  // does NOT mean the shell holds an open mesh session — the shell has no
  // inbound surfaces in v0.1.0, so it uses the SDK's outbound-only path
  // (no register, no stream). When the first shell-side surface lands
  // (shell.toast, shell.focus_app, …) this pill grows a second state for
  // "shell registered".
  //
  // Three colours map to four states: starting (amber, mesh boot in
  // flight), online (green, /healthz returns 200), failed (red, with a
  // mesh.error message in the dialog the user already saw), offline
  // (red, Core stopped responding mid-session).
  let label: string
  let color: string
  if (status === null) {
    label = 'core: …'
    color = 'var(--holo-muted)'
  } else if (status.state === 'starting') {
    label = 'core: starting'
    color = 'rgb(255, 178, 60)'
  } else if (status.coreHealthy) {
    label = 'core: online'
    color = 'rgb(60, 210, 140)'
  } else if (status.state === 'failed') {
    label = 'core: failed'
    color = 'rgb(255, 105, 105)'
  } else {
    label = 'core: offline'
    color = 'rgb(255, 105, 105)'
  }
  return (
    <span
      className="text-[10px] uppercase tracking-[0.18em] font-medium px-2 py-1 rounded border"
      style={{
        color,
        borderColor: `${color}55`,
        background: `${color}10`
      }}
    >
      <span
        aria-hidden
        className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
        style={{ background: color }}
      />
      {label}
    </span>
  )
}

export function MeshDevTools() {
  const [status, setStatus] = useState<MeshStatus | null>(null)
  const [rt, setRt] = useState<RoundTripState>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async (): Promise<void> => {
      try {
        const next = await window.aether.mesh.status()
        if (!cancelled) setStatus(next)
      } catch {
        // IPC failed — main process is gone or hung. Treat as failed
        // rather than starting so the pill goes red, not amber.
        if (!cancelled) {
          setStatus({ coreUrl: null, coreHealthy: false, state: 'failed', error: 'ipc unreachable' })
        }
      }
      if (!cancelled) timer = setTimeout(tick, CORE_POLL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  const sendNotification = useCallback(async () => {
    setRt({ kind: 'firing' })
    const result: MeshInvokeResult = await window.aether.mesh.invoke('host_notifications.notify', {
      title: 'Aether',
      body: 'Mesh round-trip works.'
    })
    if (result.ok && result.envelope) {
      const payload = result.envelope.payload as { delivered?: boolean; at?: string }
      setRt({
        kind: 'ok',
        durationMs: result.durationMs,
        deliveredAt: payload.at ?? new Date().toISOString()
      })
      return
    }
    setRt({
      kind: 'error',
      durationMs: result.durationMs,
      message: result.error?.message ?? 'invoke failed',
      details: result.error?.data
    })
  }, [])

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1
              className="text-2xl font-light tracking-[0.04em]"
              style={{ color: 'var(--holo-accent)' }}
            >
              Mesh Dev Tools
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--holo-muted)' }}>
              {status?.coreUrl ?? 'core URL pending'}
            </p>
          </div>
          <StatusPill status={status} />
        </header>

        <section
          className="holo-card rounded-2xl border px-5 py-5 flex flex-col gap-4"
          style={{
            background: 'rgba(15,15,25,0.5)',
            borderColor: 'var(--holo-border)'
          }}
        >
          <div>
            <h2
              className="text-sm uppercase tracking-[0.18em] font-medium mb-1"
              style={{ color: 'var(--holo-text)' }}
            >
              Round-trip test
            </h2>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--holo-muted)' }}>
              Invokes <code>host_notifications.notify</code> through the mesh.
              The shell signs the envelope, Core verifies it against the edge
              graph, and the node fires a native notification.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void sendNotification()
            }}
            disabled={rt.kind === 'firing' || status?.coreHealthy !== true}
            className="self-start text-xs px-4 py-2 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              color: 'var(--holo-accent)',
              borderColor: 'rgba(74,158,255,0.45)',
              background: 'rgba(74,158,255,0.10)'
            }}
          >
            {rt.kind === 'firing' ? 'Sending…' : 'Send notification via mesh'}
          </button>
          <RoundTripResult state={rt} />
        </section>
      </div>
    </div>
  )
}

function RoundTripResult({ state }: { state: RoundTripState }) {
  if (state.kind === 'idle') {
    return (
      <div className="text-[11px]" style={{ color: 'var(--holo-muted)' }}>
        Click the button to fire one envelope.
      </div>
    )
  }
  if (state.kind === 'firing') {
    return (
      <div className="text-[11px]" style={{ color: 'var(--holo-muted)' }}>
        Signing envelope and POSTing to /v0/invoke…
      </div>
    )
  }
  if (state.kind === 'ok') {
    return (
      <div
        className="text-[11px] font-mono leading-relaxed px-3 py-2 rounded border"
        style={{
          color: 'rgb(60, 210, 140)',
          borderColor: 'rgba(60,210,140,0.35)',
          background: 'rgba(60,210,140,0.08)'
        }}
      >
        ok · round-trip {state.durationMs}ms · delivered_at {state.deliveredAt}
      </div>
    )
  }
  return (
    <div
      className="text-[11px] font-mono leading-relaxed px-3 py-2 rounded border whitespace-pre-wrap break-words"
      style={{
        color: 'rgb(255, 105, 105)',
        borderColor: 'rgba(255,105,105,0.35)',
        background: 'rgba(255,105,105,0.08)'
      }}
    >
      error · {state.durationMs}ms · {state.message}
      {state.details ? '\n' + JSON.stringify(state.details, null, 2) : ''}
    </div>
  )
}
