/**
 * ResourcesPanel Component
 *
 * Lists resources from the selected MCP server and allows reading them.
 */

import { useState, useCallback, memo } from 'react';
import { FileText, ChevronRight, ChevronDown, Eye, Loader2 } from 'lucide-react';
import type { McpResource } from '../types';
import { JsonViewer } from './JsonViewer';

interface ResourcesPanelProps {
  resources: McpResource[];
  onReadResource: (uri: string) => Promise<unknown>;
  loading?: boolean;
  serverRunning: boolean;
}

interface ResourceItemProps {
  resource: McpResource;
  expanded: boolean;
  onToggle: () => void;
  onRead: () => Promise<unknown>;
}

interface ReadResult {
  success: boolean;
  content?: unknown;
  error?: string;
}

const ResourceItem = memo(function ResourceItem({ resource, expanded, onToggle, onRead }: ResourceItemProps) {
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<ReadResult | null>(null);

  const handleRead = useCallback(async () => {
    setReading(true);
    setResult(null);

    try {
      const content = await onRead();
      setResult({
        success: true,
        content,
      });
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setReading(false);
    }
  }, [onRead]);

  return (
    <div className="border border-[var(--holo-accent)]/10 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-3 bg-[rgba(0,0,0,0.2)] hover:bg-[rgba(0,0,0,0.3)] transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
        <FileText className="w-4 h-4 text-[var(--holo-accent)]" />
        <span className="font-medium text-sm text-[var(--holo-text)] flex-1 truncate">{resource.name}</span>
        {resource.mimeType && (
          <span className="text-xs text-gray-500">{resource.mimeType}</span>
        )}
      </button>

      {expanded && (
        <div className="p-3 space-y-3 bg-[rgba(0,0,0,0.1)]">
          <div className="text-xs text-gray-500 break-all">
            <span className="text-gray-400">URI:</span> {resource.uri}
          </div>

          {resource.description && (
            <p className="text-xs text-gray-400">{resource.description}</p>
          )}

          <button
            onClick={handleRead}
            disabled={reading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] rounded hover:bg-[var(--holo-accent)]/30 transition-colors disabled:opacity-50"
          >
            {reading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Reading...</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>Read Resource</span>
              </>
            )}
          </button>

          {result && (
            <div className="border-t border-[var(--holo-accent)]/10 pt-3">
              <h4 className="text-xs font-medium text-gray-400 mb-2">Content</h4>
              {result.success ? (
                <JsonViewer data={result.content} collapsed />
              ) : (
                <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded">
                  {result.error}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export function ResourcesPanel({ resources, onReadResource, loading, serverRunning }: ResourcesPanelProps) {
  const [expandedResource, setExpandedResource] = useState<string | null>(null);

  const handleToggle = useCallback((uri: string) => {
    setExpandedResource(prev => (prev === uri ? null : uri));
  }, []);

  const handleRead = useCallback(
    (uri: string) => async () => {
      return onReadResource(uri);
    },
    [onReadResource]
  );

  if (!serverRunning) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Start a server to view resources</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[var(--holo-accent)] animate-spin" />
      </div>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No resources available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 overflow-auto h-full">
      <div className="text-xs text-gray-500 mb-3">{resources.length} resource(s) available</div>
      {resources.map(resource => (
        <ResourceItem
          key={resource.uri}
          resource={resource}
          expanded={expandedResource === resource.uri}
          onToggle={() => handleToggle(resource.uri)}
          onRead={handleRead(resource.uri)}
        />
      ))}
    </div>
  );
}
