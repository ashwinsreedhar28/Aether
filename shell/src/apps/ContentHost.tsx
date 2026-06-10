/**
 * ContentHost — the desktop shell adapter for @viewer/core renderers.
 *
 * The pure content rendering (markdown, json, mermaid, latex, image, html, ...)
 * now lives once in @viewer/core. This host owns the *desktop-only* concerns:
 * resolving a file path into content via fileApi, watching it for external
 * changes, and persisting edits. It maps AppProps -> a View + ResolvedViewData
 * and renders the registered shared renderer.
 *
 * Editing-capable renderers report changes through `onContentChange`; the host
 * holds the latest draft and writes it on Cmd+S (matching the previous apps).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRenderer,
  registerBuiltinRenderers,
  type View,
  type ViewType,
  type ResolvedViewData,
} from '@viewer/core';
import { useAppContext } from './AppContext';
import { useFileWatcher } from '../hooks/useFileWatcher';
import type { AppProps } from './types';
import 'katex/dist/katex.min.css';

registerBuiltinRenderers();

interface ContentHostProps extends AppProps {
  /** Which shared renderer to delegate to. */
  type: ViewType;
  /** When true, edits are persisted back to the file on Cmd+S. */
  editable?: boolean;
}

export function ContentHost({ type, editable = false, filePath, tabId, isActive }: ContentHostProps) {
  const { fileApi, setDirty } = useAppContext();
  const { subscribeToFile } = useFileWatcher();

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirtyState] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const draftRef = useRef('');

  const loadFile = useCallback(async (isReload = false) => {
    if (!filePath) return;
    if (!isReload) setLoading(true);
    setError(null);
    setExternalChange(false);
    try {
      const data = await fileApi.readFile(filePath);
      setContent(data.content);
      draftRef.current = data.content;
      setDirtyState(false);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setLoading(false);
    }
  }, [filePath, fileApi, setDirty]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  // External change handling: editable views warn while dirty, otherwise reload.
  useEffect(() => {
    if (!filePath) return;
    return subscribeToFile(filePath, () => {
      if (editable && dirty) setExternalChange(true);
      else loadFile(true);
    });
  }, [filePath, subscribeToFile, editable, dirty, loadFile]);

  const handleContentChange = useCallback((next: string) => {
    draftRef.current = next;
    const changed = next !== content;
    setDirtyState(changed);
    setDirty(changed);
  }, [content, setDirty]);

  const handleSave = useCallback(async () => {
    if (!editable || !dirty || !filePath) return;
    setSaving(true);
    try {
      await fileApi.writeFile(filePath, draftRef.current);
      setContent(draftRef.current);
      setDirtyState(false);
      setDirty(false);
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  }, [editable, dirty, filePath, fileApi, setDirty]);

  useEffect(() => {
    if (!isActive || !editable) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActive, editable, handleSave]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--holo-muted)]">
        Loading...
      </div>
    );
  }
  if (error) {
    return <div className="flex items-center justify-center h-full text-red-400">{error}</div>;
  }
  if (content === null) return null;

  const entry = getRenderer(type);
  if (!entry) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        No renderer registered for "{type}"
      </div>
    );
  }
  const Renderer = entry.render;

  const view: View = {
    id: tabId,
    type,
    title: filePath?.split('/').pop() || type,
    source: { kind: 'path', value: filePath || '' },
  };
  const data: ResolvedViewData = { content };

  return (
    <div className="h-full flex flex-col">
      {externalChange && (
        <div className="flex items-center justify-between px-3 py-2 bg-amber-500/20 border-b border-amber-500/50">
          <span className="text-xs text-amber-300">This file has been modified externally</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadFile(true)}
              className="px-2 py-0.5 text-xs bg-amber-500 text-black rounded hover:bg-amber-400 transition-colors"
            >
              Reload
            </button>
            <button
              onClick={() => setExternalChange(false)}
              className="px-2 py-0.5 text-xs text-amber-300 hover:text-amber-200 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {editable && (dirty || saving) && (
        <div className="flex items-center justify-end gap-2 px-3 py-1 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.5)]">
          {dirty && <span className="text-xs text-amber-400">Unsaved</span>}
          {saving && <span className="text-xs text-[var(--holo-muted)]">Saving...</span>}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-2 py-0.5 text-xs bg-[var(--holo-accent)] rounded hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <Renderer
          view={view}
          data={data}
          isActive={isActive}
          onContentChange={editable ? handleContentChange : undefined}
        />
      </div>
    </div>
  );
}
