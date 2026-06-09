/**
 * EnvironmentSelector Component
 * Dropdown to switch between environments
 */

import { useState } from 'react';
import { ChevronDown, Globe, Check, Settings, Plus } from 'lucide-react';
import type { Environment } from '../../types';
import { EnvironmentEditor } from './EnvironmentEditor';

interface EnvironmentSelectorProps {
  environments: Environment[];
  activeEnvironmentId?: string;
  onSelect: (envId: string | undefined) => void;
  onUpdateEnvironment?: (envId: string, updates: Partial<Environment>) => void;
  onAddEnvironment?: (env: Environment) => void;
}

export function EnvironmentSelector({
  environments,
  activeEnvironmentId,
  onSelect,
  onUpdateEnvironment,
  onAddEnvironment,
}: EnvironmentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingEnv, setEditingEnv] = useState<Environment | null>(null);

  const activeEnv = environments.find((e) => e.id === activeEnvironmentId);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] hover:border-[var(--holo-accent)]/50 transition-colors"
      >
        <Globe size={14} className="text-[var(--holo-accent)]" />
        <span className="flex-1 text-sm text-left truncate">
          {activeEnv?.name || 'No Environment'}
        </span>
        <ChevronDown
          size={14}
          className={`text-[var(--holo-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          {/* Dropdown */}
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[rgba(20,20,30,0.95)] border border-[var(--holo-border)] rounded shadow-lg py-1">
            {/* No environment option */}
            <button
              onClick={() => {
                onSelect(undefined);
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--holo-accent)]/20 transition-colors"
            >
              <div className="w-4">
                {!activeEnvironmentId && <Check size={14} className="text-[var(--holo-accent)]" />}
              </div>
              <span className="text-[var(--holo-muted)]">No Environment</span>
            </button>

            {environments.length > 0 && (
              <div className="border-t border-[var(--holo-border)] my-1" />
            )}

            {/* Environment options */}
            {environments.map((env) => (
              <div
                key={env.id}
                className="flex items-center hover:bg-[var(--holo-accent)]/20 transition-colors"
              >
                <button
                  onClick={() => {
                    onSelect(env.id);
                    setIsOpen(false);
                  }}
                  className="flex-1 flex items-center gap-2 px-3 py-2 text-sm"
                >
                  <div className="w-4">
                    {activeEnvironmentId === env.id && (
                      <Check size={14} className="text-[var(--holo-accent)]" />
                    )}
                  </div>
                  <span>{env.name}</span>
                  <span className="text-xs text-[var(--holo-muted)]">
                    {env.variables.length} vars
                  </span>
                </button>
                {onUpdateEnvironment && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingEnv(env);
                      setIsOpen(false);
                    }}
                    className="p-2 text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
                    title="Edit environment"
                  >
                    <Settings size={14} />
                  </button>
                )}
              </div>
            ))}

            {/* Add new environment */}
            {onAddEnvironment && (
              <>
                <div className="border-t border-[var(--holo-border)] my-1" />
                <button
                  onClick={() => {
                    const newEnv: Environment = {
                      id: crypto.randomUUID(),
                      name: 'New Environment',
                      variables: [],
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    };
                    onAddEnvironment(newEnv);
                    setEditingEnv(newEnv);
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/20 transition-colors"
                >
                  <Plus size={14} />
                  <span>New Environment</span>
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Environment editor dialog */}
      {editingEnv && onUpdateEnvironment && (
        <EnvironmentEditor
          environment={editingEnv}
          onSave={(updates) => onUpdateEnvironment(editingEnv.id, updates)}
          onClose={() => setEditingEnv(null)}
        />
      )}
    </div>
  );
}
