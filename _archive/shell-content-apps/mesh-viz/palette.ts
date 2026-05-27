// Locked design vocabulary for the mesh-viz radial layout (lane 108a).
//
// These categorical hues are intentionally NOT the holo accent palette
// (theme/holographic.css is a near-monochrome blue-on-near-black system). A
// topology view needs four mutually distinguishable category colors, which a
// single-accent theme can't supply — so this is a purpose-built categorical
// scale that sits ON the holo dark background. See PR Open Questions for the
// harmonization note.

import type { NodeCategory, NodeStatus } from './types'

export interface CategoryStyle {
  fill: string
  stroke: string
  label: string
}

export const CATEGORY_PALETTE: Record<NodeCategory, CategoryStyle> = {
  Sensor: { fill: '#10b981', stroke: '#059669', label: 'Sensor' }, // green
  Actor: { fill: '#f59e0b', stroke: '#d97706', label: 'Actor' }, // orange
  Mixer: { fill: '#a855f7', stroke: '#9333ea', label: 'Mixer' }, // purple
  Planner: { fill: '#3b82f6', stroke: '#2563eb', label: 'Planner' }, // blue (reserved, no nodes yet)
}

/** Fallback for a category the broker sends that we don't yet style. */
export const UNKNOWN_STYLE: CategoryStyle = {
  fill: '#64748b',
  stroke: '#475569',
  label: 'Unknown',
}

/**
 * Node symbol opacity by liveness. running = full; unhealthy = dimmed;
 * stopped = ghosted. The core node overrides this (always full) because its
 * "stopped" status is a dispatch-host artifact, not a real outage.
 */
export const STATUS_OPACITY: Record<NodeStatus, number> = {
  running: 1.0,
  unhealthy: 0.65,
  stopped: 0.35,
}

/** Safe lookup that tolerates an unrecognized category string off the wire. */
export function styleFor(category: string): CategoryStyle {
  return (CATEGORY_PALETTE as Record<string, CategoryStyle>)[category] ?? UNKNOWN_STYLE
}

/** Opacity for a node, with a sane default if the status is unrecognized. */
export function opacityFor(status: string): number {
  return (STATUS_OPACITY as Record<string, number>)[status] ?? STATUS_OPACITY.stopped
}
