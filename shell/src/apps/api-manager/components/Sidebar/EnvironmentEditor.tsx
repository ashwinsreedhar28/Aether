/**
 * EnvironmentEditor Component
 * Dialog for editing environment variables
 */

import { useState } from 'react';
import { X, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import type { Environment, EnvironmentVariable } from '../../types';
import { generateId } from '../../constants';

interface EnvironmentEditorProps {
  environment: Environment;
  onSave: (updates: Partial<Environment>) => void;
  onClose: () => void;
}

export function EnvironmentEditor({ environment, onSave, onClose }: EnvironmentEditorProps) {
  const [variables, setVariables] = useState<EnvironmentVariable[]>(environment.variables);
  const [name, setName] = useState(environment.name);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const handleAddVariable = () => {
    setVariables([
      ...variables,
      {
        id: generateId(),
        key: '',
        value: '',
        enabled: true,
        isSecret: false,
      },
    ]);
  };

  const handleRemoveVariable = (id: string) => {
    setVariables(variables.filter((v) => v.id !== id));
  };

  const handleUpdateVariable = (
    id: string,
    field: keyof EnvironmentVariable,
    value: string | boolean
  ) => {
    setVariables(
      variables.map((v) => (v.id === id ? { ...v, [field]: value } : v))
    );
  };

  const handleSave = () => {
    onSave({ name, variables });
    onClose();
  };

  const toggleSecret = (id: string) => {
    setShowSecrets((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-2xl max-h-[80vh] bg-[var(--holo-bg)] border border-[var(--holo-border)] rounded-lg shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--holo-border)]">
          <h2 className="text-lg font-medium">Edit Environment</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--holo-accent)]/20 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Environment name */}
          <div>
            <label className="block text-sm font-medium mb-2">Environment Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
            />
          </div>

          {/* Variables */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Variables</label>
              <button
                onClick={handleAddVariable}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 transition-colors"
              >
                <Plus size={12} />
                Add Variable
              </button>
            </div>

            {/* Variable list */}
            <div className="space-y-2">
              {/* Header */}
              {variables.length > 0 && (
                <div className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--holo-muted)]">
                  <div className="w-5" />
                  <div className="flex-1">Variable</div>
                  <div className="flex-1">Value</div>
                  <div className="w-8">Secret</div>
                  <div className="w-8" />
                </div>
              )}

              {variables.map((variable) => (
                <div
                  key={variable.id}
                  className="flex items-center gap-2 p-2 rounded bg-[rgba(20,20,30,0.5)] group"
                >
                  {/* Enabled checkbox */}
                  <input
                    type="checkbox"
                    checked={variable.enabled}
                    onChange={(e) =>
                      handleUpdateVariable(variable.id, 'enabled', e.target.checked)
                    }
                    className="w-4 h-4 rounded border-[var(--holo-border)] bg-transparent accent-[var(--holo-accent)]"
                  />

                  {/* Key input */}
                  <input
                    type="text"
                    value={variable.key}
                    onChange={(e) =>
                      handleUpdateVariable(variable.id, 'key', e.target.value)
                    }
                    placeholder="Variable name"
                    className="flex-1 px-2 py-1.5 text-sm bg-transparent border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
                  />

                  {/* Value input */}
                  <div className="flex-1 relative">
                    <input
                      type={variable.isSecret && !showSecrets[variable.id] ? 'password' : 'text'}
                      value={variable.value}
                      onChange={(e) =>
                        handleUpdateVariable(variable.id, 'value', e.target.value)
                      }
                      placeholder="Value"
                      className="w-full px-2 py-1.5 pr-8 text-sm bg-transparent border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
                    />
                    {variable.isSecret && (
                      <button
                        type="button"
                        onClick={() => toggleSecret(variable.id)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
                      >
                        {showSecrets[variable.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    )}
                  </div>

                  {/* Secret toggle */}
                  <div className="w-8 flex justify-center">
                    <input
                      type="checkbox"
                      checked={variable.isSecret || false}
                      onChange={(e) =>
                        handleUpdateVariable(variable.id, 'isSecret', e.target.checked)
                      }
                      className="w-4 h-4 rounded border-[var(--holo-border)] bg-transparent accent-[var(--holo-accent)]"
                      title="Mark as secret"
                    />
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={() => handleRemoveVariable(variable.id)}
                    className="w-8 flex justify-center p-1 rounded hover:bg-red-500/20 text-[var(--holo-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              {variables.length === 0 && (
                <div className="text-center py-8 text-[var(--holo-muted)] text-sm">
                  No variables defined. Click "Add Variable" to create one.
                </div>
              )}
            </div>
          </div>

          {/* Usage hint */}
          <div className="p-3 rounded bg-[var(--holo-accent)]/10 border border-[var(--holo-accent)]/30">
            <p className="text-xs text-[var(--holo-muted)]">
              <strong className="text-[var(--holo-accent)]">Tip:</strong> Use variables in your
              requests with <code className="px-1 py-0.5 rounded bg-[rgba(0,0,0,0.3)]">{'{{variableName}}'}</code> syntax.
              For example: <code className="px-1 py-0.5 rounded bg-[rgba(0,0,0,0.3)]">{'{{baseUrl}}/users'}</code>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--holo-border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded bg-[rgba(20,20,30,0.5)] text-[var(--holo-muted)] hover:text-[var(--holo-text)] hover:bg-[rgba(30,30,40,0.5)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
