import { useEffect, useState } from 'react'

interface Metadata {
  name: string
  version: string
  isDev: boolean
  bootedAt: string
}

function formatToday(now: Date): string {
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

export function Welcome() {
  const [meta, setMeta] = useState<Metadata | null>(null)
  const [today, setToday] = useState<string>(() => formatToday(new Date()))

  useEffect(() => {
    let cancelled = false
    void window.homeOS.getMetadata().then((m) => {
      if (!cancelled) setMeta(m)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Refresh "today" if the app sits open across midnight. Cheap interval —
    // fires once a minute, no measurable cost.
    const id = window.setInterval(() => setToday(formatToday(new Date())), 60_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="h-full w-full flex items-center justify-center">
      <div
        className="flex flex-col items-center gap-5 px-14 py-12 rounded-2xl border"
        style={{
          background: 'rgba(15,15,25,0.5)',
          borderColor: 'var(--holo-border)',
          boxShadow:
            '0 0 25px rgba(100,150,255,0.12), inset 0 0 30px rgba(100,150,255,0.04)'
        }}
      >
        <div
          className="text-5xl font-light tracking-[0.08em]"
          style={{ color: 'var(--holo-accent)' }}
        >
          {meta?.name ?? 'homeOS'}
        </div>
        <div
          className="text-sm italic"
          style={{ color: 'var(--holo-muted)' }}
        >
          the personal OS, in progress
        </div>
        <div className="mt-6 flex flex-col items-center gap-1">
          <div
            className="text-xs uppercase tracking-[0.18em]"
            style={{ color: 'var(--holo-muted)' }}
          >
            {today}
          </div>
          <div
            className="text-xs font-mono"
            style={{ color: 'var(--holo-muted)' }}
          >
            v{meta?.version ?? '…'}
            {meta?.isDev ? ' · dev' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
