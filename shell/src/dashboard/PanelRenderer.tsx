import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// A panel as it arrives from the RAVEN_AVP scene server (server/scene_doc.py
// `Panel`). The preload types snapshot panels and delta payloads as `unknown`
// (it deliberately avoids cross-package imports), so the renderer declares the
// subset of fields it consumes. Only `id` is structurally guaranteed here;
// `kind` defaults to 'text' server-side, `text`/`url` carry the body. The wire
// also carries transform/size/style, but the 2D dashboard ignores them (layout
// is arrival-order column, not transform.position — Sprint 6.3b Q3=C).
export interface ScenePanel {
  id: string
  kind?: string
  text?: string
  url?: string | null
  data?: string | null
  [key: string]: unknown
}

// react-markdown emits bare h1/ul/li/etc. Tailwind's preflight zeroes their
// default sizing and list markers, so without these overrides markdown renders
// visually flat. These restore just enough structure to read as formatted
// markup on the diagnostic surface — not a full prose theme.
const mdComponents = {
  h1: (p: ComponentPropsWithoutRef<'h1'>) => (
    <h1 className="text-lg font-semibold mt-2 mb-1" {...p} />
  ),
  h2: (p: ComponentPropsWithoutRef<'h2'>) => (
    <h2 className="text-base font-semibold mt-2 mb-1" {...p} />
  ),
  h3: (p: ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="text-sm font-semibold mt-2 mb-1" {...p} />
  ),
  p: (p: ComponentPropsWithoutRef<'p'>) => <p className="my-1" {...p} />,
  ul: (p: ComponentPropsWithoutRef<'ul'>) => (
    <ul className="list-disc pl-5 my-1" {...p} />
  ),
  ol: (p: ComponentPropsWithoutRef<'ol'>) => (
    <ol className="list-decimal pl-5 my-1" {...p} />
  ),
  li: (p: ComponentPropsWithoutRef<'li'>) => <li className="my-0.5" {...p} />,
  code: (p: ComponentPropsWithoutRef<'code'>) => (
    <code
      className="px-1 py-0.5 rounded text-[0.85em]"
      style={{ background: 'rgba(var(--holo-accent-rgb), 0.12)' }}
      {...p}
    />
  ),
  a: ({ href, children, ...rest }: ComponentPropsWithoutRef<'a'>) => (
    // Anchors must not navigate the renderer away from the app. Route http(s)
    // links to the system browser via the shell IPC; render the rest inert.
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href) void window.aether.shell.openExternal(href)
      }}
      style={{ color: 'var(--holo-accent)' }}
      {...rest}
    >
      {children}
    </a>
  ),
}

function Fallback({ label }: { label: string }): React.ReactElement {
  return (
    <div className="text-xs italic" style={{ color: 'var(--holo-muted)' }}>
      {label}
    </div>
  )
}

// Renders the body of a single panel by kind. Pure — no state, no IPC except
// the anchor → openExternal hop above. The card chrome (id header, border)
// lives in Dashboard so this stays a kind-switch.
export function PanelRenderer({ panel }: { panel: ScenePanel }): React.ReactElement {
  const kind = panel.kind ?? 'text'

  switch (kind) {
    case 'text':
      return (
        <pre
          className="whitespace-pre-wrap break-words font-mono text-sm m-0"
          style={{ color: 'var(--holo-text)' }}
        >
          {panel.text ?? ''}
        </pre>
      )

    case 'markdown':
      return (
        <div className="text-sm" style={{ color: 'var(--holo-text)' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {panel.text ?? ''}
          </ReactMarkdown>
        </div>
      )

    case 'html':
      if (!panel.url) {
        return <Fallback label="html panel missing 'url'" />
      }
      return (
        // Maximally restrictive sandbox: sandbox="" opts the frame into ALL
        // restrictions (no scripts, no same-origin, no forms, no popups,
        // unique opaque origin). Diagnostic html panels render as static
        // markup; this is the safe default per the lane spec ("start as
        // restrictive as possible"). A later lane can relax per trusted
        // source if an embed needs scripts. The scene server already validates
        // html panel urls are http(s) with a host (scene_doc.py Panel._validate_kind).
        <iframe
          title={`panel-${panel.id}`}
          src={panel.url}
          sandbox=""
          className="w-full h-64 rounded border-0"
          style={{ background: '#fff' }}
        />
      )

    default:
      return <Fallback label={`Unsupported panel kind: ${kind}`} />
  }
}
