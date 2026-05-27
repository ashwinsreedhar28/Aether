import type { ReactElement } from 'react'
import type { ActivityEntry, ActivityPayload, TopologyPayload } from './types'
import { styleFor } from './palette'

interface ActivityFeedProps {
  activity: ActivityPayload | null
  topology: TopologyPayload | null
}

const DEFAULT_SRC_CATEGORY = 'Mixer'

/** 24h HH:MM:SS from a Unix-seconds timestamp. */
function formatTime(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toLocaleTimeString('en-GB', { hour12: false })
}

/**
 * Seconds since the broker stamped the snapshot. Derived from the broker
 * clock (`fetched_at_ms`), so a client/broker skew shows here rather than a
 * real "ago" — acceptable for a liveness hint. Recomputed each render, which
 * the 2s poll drives, so no separate ticking timer is needed.
 */
function secondsAgo(fetchedAtMs: number): number {
  return Math.max(0, Math.round((Date.now() - fetchedAtMs) / 1000))
}

function EntryRow({ entry, topology }: { entry: ActivityEntry; topology: TopologyPayload | null }): ReactElement {
  const srcCategory = topology?.nodes.find((n) => n.id === entry.src_node)?.category ?? DEFAULT_SRC_CATEGORY
  const accent = styleFor(srcCategory).fill
  const result = entry.success ? `${entry.latency_ms.toFixed(1)}ms` : (entry.error_kind ?? 'failed')

  return (
    <li
      className="px-3 py-2 border-b text-[11px] leading-tight"
      style={{ borderColor: 'var(--holo-border)', borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span style={{ color: 'var(--holo-muted)' }} className="tabular-nums">
          {formatTime(entry.ts)}
        </span>
        <span
          className="tabular-nums"
          style={{ color: entry.success ? 'var(--holo-text)' : 'rgb(255, 105, 105)' }}
        >
          {result}
        </span>
      </div>
      <div className="mt-0.5 truncate" style={{ color: 'var(--holo-text)' }}>
        {entry.src_node} <span style={{ color: 'var(--holo-muted)' }}>→</span> {entry.dst_node}
        <span style={{ color: 'var(--holo-muted)' }}>.{entry.surface}</span>
      </div>
    </li>
  )
}

export function ActivityFeed({ activity, topology }: ActivityFeedProps): ReactElement {
  const entries = activity?.activity ?? []
  const subtitle = activity
    ? `${entries.length} event${entries.length === 1 ? '' : 's'} · fetched ${secondsAgo(activity.fetched_at_ms)}s ago`
    : 'no snapshot yet'

  return (
    <aside
      className="shrink-0 flex flex-col border-l"
      style={{ width: 280, borderColor: 'var(--holo-border)', background: 'rgba(10,10,15,0.45)' }}
    >
      <header className="px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--holo-border)' }}>
        <div className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--holo-muted)' }}>
          Activity
        </div>
        <div className="text-[10px] mt-0.5 tabular-nums" style={{ color: 'var(--holo-muted)' }}>
          {subtitle}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        {activity === null ? (
          <div className="px-3 py-6 text-[11px]" style={{ color: 'var(--holo-muted)' }}>
            Waiting for activity…
          </div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-6 text-[11px]" style={{ color: 'var(--holo-muted)' }}>
            No invocations recorded yet.
          </div>
        ) : (
          <ul>
            {/* Newest-first is guaranteed by the broker (types.ts) — do NOT re-sort.
                No server id on entries, so the key is a composite + index. */}
            {entries.map((entry, i) => (
              <EntryRow key={`${entry.ts}-${entry.src_node}-${entry.surface}-${i}`} entry={entry} topology={topology} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
