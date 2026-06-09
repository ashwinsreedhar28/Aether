import { useMemo, useState, useEffect, useRef } from 'react';
import { Search, X, Keyboard } from 'lucide-react';
import type { AppProps } from '../types';
import {
  SHORTCUT_GROUPS,
  isMac,
  renderCombo,
  type ShortcutGroup,
  type Shortcut,
} from './shortcuts';

export function KeyboardShortcuts({ isActive }: AppProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const mac = useMemo(() => isMac(), []);

  // Auto-focus search on mount + when activated
  useEffect(() => {
    if (isActive) {
      searchRef.current?.focus();
    }
  }, [isActive]);

  // Esc clears the search box
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && query) {
        e.stopPropagation();
        setQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, query]);

  const filtered = useMemo<ShortcutGroup[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUT_GROUPS;

    return SHORTCUT_GROUPS.map((group) => {
      const scopeMatches = group.scope.toLowerCase().includes(q);
      const matchedShortcuts = group.shortcuts.filter((s) => {
        if (scopeMatches) return true;
        if (s.description.toLowerCase().includes(q)) return true;
        const keys = Array.isArray(s.keys) ? s.keys : [s.keys];
        return keys.some((k) => k.toLowerCase().includes(q));
      });
      if (matchedShortcuts.length === 0) return null;
      return { ...group, shortcuts: matchedShortcuts };
    }).filter((g): g is ShortcutGroup => g !== null);
  }, [query]);

  const totalCount = useMemo(
    () => SHORTCUT_GROUPS.reduce((acc, g) => acc + g.shortcuts.length, 0),
    []
  );
  const visibleCount = useMemo(
    () => filtered.reduce((acc, g) => acc + g.shortcuts.length, 0),
    [filtered]
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary, #0e0f12)',
        color: 'var(--text-primary, #e5e7eb)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        fontSize: '14px',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 18px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <Keyboard size={18} style={{ opacity: 0.7 }} />
        <div style={{ fontSize: '15px', fontWeight: 600 }}>
          Keyboard Shortcuts
        </div>
        <div
          style={{
            marginLeft: 'auto',
            fontSize: '12px',
            opacity: 0.5,
          }}
        >
          {query ? `${visibleCount} of ${totalCount}` : `${totalCount} total`}
        </div>
      </div>

      {/* Search */}
      <div
        style={{
          padding: '10px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <Search size={14} style={{ opacity: 0.4 }} />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shortcuts (e.g. 'save', 'cmd+k', 'kanban')..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'inherit',
            fontSize: '14px',
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              opacity: 0.5,
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '8px 0 24px',
        }}
      >
        {filtered.length === 0 && (
          <div
            style={{
              padding: '40px 18px',
              textAlign: 'center',
              opacity: 0.5,
              fontSize: '13px',
            }}
          >
            No shortcuts match "{query}".
          </div>
        )}

        {filtered.map((group) => (
          <GroupBlock key={group.scope} group={group} mac={mac} />
        ))}
      </div>
    </div>
  );
}

function GroupBlock({ group, mac }: { group: ShortcutGroup; mac: boolean }) {
  return (
    <div style={{ padding: '14px 18px 4px' }}>
      <div
        style={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          opacity: 0.55,
          marginBottom: '4px',
        }}
      >
        {group.scope}
      </div>
      {group.hint && (
        <div
          style={{
            fontSize: '12px',
            opacity: 0.45,
            marginBottom: '10px',
          }}
        >
          {group.hint}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {group.shortcuts.map((s, i) => (
          <ShortcutRow key={i} shortcut={s} mac={mac} />
        ))}
      </div>
    </div>
  );
}

function ShortcutRow({
  shortcut,
  mac,
}: {
  shortcut: Shortcut;
  mac: boolean;
}) {
  const combos = Array.isArray(shortcut.keys) ? shortcut.keys : [shortcut.keys];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '7px 0',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div style={{ fontSize: '13.5px', opacity: 0.92 }}>
        {shortcut.description}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {combos.map((combo, idx) => (
          <span
            key={idx}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {idx > 0 && (
              <span
                style={{ fontSize: '11px', opacity: 0.4, marginRight: '2px' }}
              >
                or
              </span>
            )}
            {renderCombo(combo, mac).map((token, tIdx, arr) => (
              <span
                key={tIdx}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <kbd
                  style={{
                    fontFamily:
                      '"SF Mono", Menlo, Monaco, ui-monospace, monospace',
                    fontSize: '11.5px',
                    padding: '2px 7px',
                    minWidth: '20px',
                    textAlign: 'center',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '4px',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'inherit',
                    boxShadow:
                      'inset 0 -1px 0 rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.04)',
                  }}
                >
                  {token}
                </kbd>
                {tIdx < arr.length - 1 && (
                  <span style={{ opacity: 0.4, fontSize: '11px' }}>+</span>
                )}
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
