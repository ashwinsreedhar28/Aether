/**
 * ToolsPanel Component
 *
 * Lists tools from the selected MCP server and allows testing them.
 */

import { useState, useCallback, memo } from 'react';
import { Wrench, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import type { McpTool } from '../types';
import { SchemaForm, type JsonSchema } from './SchemaForm';
import { JsonViewer } from './JsonViewer';

interface ToolsPanelProps {
  tools: McpTool[];
  onCallTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  loading?: boolean;
  serverRunning: boolean;
}

interface ToolItemProps {
  tool: McpTool;
  expanded: boolean;
  onToggle: () => void;
  onCall: (args: Record<string, unknown>) => Promise<unknown>;
}

interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}

const ToolItem = memo(function ToolItem({ tool, expanded, onToggle, onCall }: ToolItemProps) {
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);

  const handleCall = useCallback(
    async (args: Record<string, unknown>) => {
      setCalling(true);
      setResult(null);
      const startTime = Date.now();

      try {
        const res = await onCall(args);
        setResult({
          success: true,
          result: res,
          duration: Date.now() - startTime,
        });
      } catch (err) {
        setResult({
          success: false,
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - startTime,
        });
      } finally {
        setCalling(false);
      }
    },
    [onCall]
  );

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
        <Wrench className="w-4 h-4 text-[var(--holo-accent)]" />
        <span className="font-medium text-sm text-[var(--holo-text)]">{tool.name}</span>
      </button>

      {expanded && (
        <div className="p-3 space-y-3 bg-[rgba(0,0,0,0.1)]">
          {tool.description && (
            <p className="text-xs text-gray-400">{tool.description}</p>
          )}

          <div className="border-t border-[var(--holo-accent)]/10 pt-3">
            <h4 className="text-xs font-medium text-gray-400 mb-2">Parameters</h4>
            <SchemaForm
              schema={tool.inputSchema as JsonSchema | undefined}
              onSubmit={handleCall}
              submitLabel="Call Tool"
              loading={calling}
            />
          </div>

          {calling && (
            <div className="flex items-center gap-2 text-sm text-[var(--holo-accent)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Calling...</span>
            </div>
          )}

          {result && (
            <div className="border-t border-[var(--holo-accent)]/10 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-xs font-medium text-gray-400">Result</h4>
                <span className={`text-xs ${result.success ? 'text-green-400' : 'text-red-400'}`}>
                  {result.success ? 'Success' : 'Error'}
                </span>
                <span className="text-xs text-gray-500">{result.duration}ms</span>
              </div>

              {result.success ? (
                <JsonViewer data={result.result} collapsed />
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

export function ToolsPanel({ tools, onCallTool, loading, serverRunning }: ToolsPanelProps) {
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const handleToggle = useCallback((toolName: string) => {
    setExpandedTool(prev => (prev === toolName ? null : toolName));
  }, []);

  const handleCall = useCallback(
    (toolName: string) => async (args: Record<string, unknown>) => {
      return onCallTool(toolName, args);
    },
    [onCallTool]
  );

  if (!serverRunning) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Start a server to view tools</p>
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

  if (tools.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No tools available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 overflow-auto h-full">
      <div className="text-xs text-gray-500 mb-3">{tools.length} tool(s) available</div>
      {tools.map(tool => (
        <ToolItem
          key={tool.name}
          tool={tool}
          expanded={expandedTool === tool.name}
          onToggle={() => handleToggle(tool.name)}
          onCall={handleCall(tool.name)}
        />
      ))}
    </div>
  );
}
