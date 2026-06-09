/**
 * RequestBuilder Component
 * Main request building panel with URL bar, headers, body, auth
 */

import { useState } from 'react';
import { Trash2, Copy } from 'lucide-react';
import type { ApiRequest } from '../../types';
import { UrlBar } from './UrlBar';
import { HeadersPanel } from './HeadersPanel';
import { ParamsPanel } from './ParamsPanel';
import { BodyPanel } from './BodyPanel';
import { AuthPanel } from './AuthPanel';

interface RequestBuilderProps {
  request: ApiRequest;
  onUpdate: (updates: Partial<ApiRequest>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSend: () => void;
  isLoading: boolean;
  onCancel: () => void;
}

type Tab = 'params' | 'headers' | 'body' | 'auth';

export function RequestBuilder({
  request,
  onUpdate,
  onDelete,
  onDuplicate,
  onSend,
  isLoading,
  onCancel,
}: RequestBuilderProps) {
  const [activeTab, setActiveTab] = useState<Tab>('params');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(request.name);

  const handleNameSubmit = () => {
    if (editName.trim()) {
      onUpdate({ name: editName.trim() });
    } else {
      setEditName(request.name);
    }
    setIsEditing(false);
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'params', label: 'Params', count: request.queryParams.filter((p) => p.enabled).length },
    { id: 'headers', label: 'Headers', count: request.headers.filter((h) => h.enabled).length },
    { id: 'body', label: 'Body' },
    { id: 'auth', label: 'Auth' },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Request name and actions */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--holo-border)]">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNameSubmit();
              if (e.key === 'Escape') {
                setEditName(request.name);
                setIsEditing(false);
              }
            }}
            autoFocus
            className="flex-1 px-2 py-1 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-accent)] rounded focus:outline-none"
          />
        ) : (
          <span
            className="flex-1 text-sm font-medium cursor-pointer hover:text-[var(--holo-accent)]"
            onClick={() => {
              setEditName(request.name);
              setIsEditing(true);
            }}
          >
            {request.name}
          </span>
        )}

        <button
          onClick={onDuplicate}
          className="p-1.5 rounded hover:bg-[var(--holo-accent)]/20 text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
          title="Duplicate"
        >
          <Copy size={14} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded hover:bg-red-500/20 text-[var(--holo-muted)] hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* URL bar */}
      <div className="px-3 py-2 border-b border-[var(--holo-border)]">
        <UrlBar
          method={request.method}
          url={request.url}
          queryParams={request.queryParams}
          onMethodChange={(method) => onUpdate({ method })}
          onUrlChange={(url) => onUpdate({ url })}
          onSend={onSend}
          isLoading={isLoading}
          onCancel={onCancel}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--holo-border)]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? 'text-[var(--holo-accent)]'
                : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--holo-accent)]/20">
                {tab.count}
              </span>
            )}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--holo-accent)]" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'params' && (
          <ParamsPanel
            params={request.queryParams}
            onChange={(queryParams) => onUpdate({ queryParams })}
          />
        )}
        {activeTab === 'headers' && (
          <HeadersPanel
            headers={request.headers}
            onChange={(headers) => onUpdate({ headers })}
          />
        )}
        {activeTab === 'body' && (
          <BodyPanel body={request.body} onChange={(body) => onUpdate({ body })} />
        )}
        {activeTab === 'auth' && (
          <AuthPanel auth={request.auth} onChange={(auth) => onUpdate({ auth })} />
        )}
      </div>
    </div>
  );
}
