import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import aboutSource from './about.md?raw'
import './markdown.css'

const MARKDOWN_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown'] }]

function basename(path: string): string {
  // Cross-platform: split on both separators rather than importing
  // node:path into the renderer.
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] ?? path
}

export function MarkdownViewer() {
  const [content, setContent] = useState<string>(aboutSource)
  const [filename, setFilename] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Drop any prior error once new content lands. Setting state inside the
  // open handler does this implicitly, but clearing on mount keeps the
  // intent obvious if the component remounts mid-error (app switch and
  // back).
  useEffect(() => {
    setError(null)
  }, [])

  async function handleOpen(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const path = await window.homeOS.files.openDialog({ filters: MARKDOWN_FILTERS })
      if (!path) return
      const text = await window.homeOS.files.readText(path)
      setContent(text)
      setFilename(basename(path))
      setError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full w-full flex flex-col">
      <header
        className="flex items-center gap-3 px-5 h-11 border-b shrink-0"
        style={{
          background: 'rgba(10,10,15,0.6)',
          borderColor: 'var(--holo-border)'
        }}
      >
        <button
          type="button"
          onClick={() => void handleOpen()}
          disabled={busy}
          className="flex items-center gap-2 px-3 h-7 rounded-md text-xs transition-colors disabled:opacity-50"
          style={{
            color: 'var(--holo-accent)',
            background: 'rgba(74,158,255,0.08)',
            border: '1px solid var(--holo-border)'
          }}
        >
          <FolderOpen size={13} />
          <span className="tracking-wide">Open .md file</span>
        </button>
        <span
          className="text-xs tracking-wide truncate"
          style={{ color: filename ? 'var(--holo-text)' : 'var(--holo-muted)' }}
        >
          {filename ?? 'About'}
        </span>
        {error ? (
          <span
            className="ml-auto text-[11px] truncate max-w-[60%]"
            style={{ color: 'rgb(255, 105, 105)' }}
            title={error}
          >
            {error}
          </span>
        ) : null}
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="holo-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}
