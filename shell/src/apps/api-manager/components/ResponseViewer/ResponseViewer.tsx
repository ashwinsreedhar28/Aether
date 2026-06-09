/**
 * ResponseViewer Component
 * Main response display with status, timing, headers, body
 */

import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { ApiResponse } from '../../types';
import { formatBytes, formatDuration } from '../../constants';
import { ResponseBody } from './ResponseBody';
import { ResponseHeaders } from './ResponseHeaders';

interface ResponseViewerProps {
  response: ApiResponse | null;
  error: string | null;
  isLoading: boolean;
}

type Tab = 'body' | 'headers';

export function ResponseViewer({ response, error, isLoading }: ResponseViewerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('body');

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-[var(--holo-muted)]">
        <Loader2 size={32} className="animate-spin text-[var(--holo-accent)]" />
        <p className="text-sm">Sending request...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-4">
        <AlertCircle size={32} className="text-red-400" />
        <div className="text-center">
          <p className="text-sm font-medium text-red-400 mb-1">Request failed</p>
          <p className="text-xs text-[var(--holo-muted)]">{error}</p>
        </div>
      </div>
    );
  }

  // No response yet
  if (!response) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-[var(--holo-muted)]">
        <p className="text-sm">Send a request to see the response</p>
      </div>
    );
  }

  const isSuccess = response.status >= 200 && response.status < 300;
  const isRedirect = response.status >= 300 && response.status < 400;
  const isClientError = response.status >= 400 && response.status < 500;
  const isServerError = response.status >= 500;

  const statusColor = isSuccess
    ? 'text-green-400'
    : isRedirect
    ? 'text-blue-400'
    : isClientError
    ? 'text-yellow-400'
    : isServerError
    ? 'text-red-400'
    : 'text-[var(--holo-muted)]';

  const statusBg = isSuccess
    ? 'bg-green-500/20'
    : isRedirect
    ? 'bg-blue-500/20'
    : isClientError
    ? 'bg-yellow-500/20'
    : isServerError
    ? 'bg-red-500/20'
    : 'bg-[var(--holo-muted)]/20';

  return (
    <div className="h-full flex flex-col">
      {/* Response meta */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--holo-border)]">
        <span className={`px-2 py-1 text-sm font-bold rounded ${statusBg} ${statusColor}`}>
          {response.status} {response.statusText}
        </span>
        <span className="text-xs text-[var(--holo-muted)]">
          {formatDuration(response.time)}
        </span>
        <span className="text-xs text-[var(--holo-muted)]">
          {formatBytes(response.size)}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--holo-border)]">
        <button
          onClick={() => setActiveTab('body')}
          className={`px-4 py-2 text-sm font-medium transition-colors relative ${
            activeTab === 'body'
              ? 'text-[var(--holo-accent)]'
              : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
          }`}
        >
          Body
          {activeTab === 'body' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--holo-accent)]" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('headers')}
          className={`px-4 py-2 text-sm font-medium transition-colors relative ${
            activeTab === 'headers'
              ? 'text-[var(--holo-accent)]'
              : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
          }`}
        >
          Headers
          <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--holo-accent)]/20">
            {Object.keys(response.headers).length}
          </span>
          {activeTab === 'headers' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--holo-accent)]" />
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'body' && (
          <ResponseBody body={response.body} bodyType={response.bodyType} />
        )}
        {activeTab === 'headers' && <ResponseHeaders headers={response.headers} />}
      </div>
    </div>
  );
}
