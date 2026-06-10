/**
 * PromptsPanel Component
 *
 * Lists prompts from the selected MCP server and allows getting them with arguments.
 */

import { useState, useCallback, memo } from 'react';
import { MessageSquare, ChevronRight, ChevronDown, Send, Loader2 } from 'lucide-react';
import type { McpPrompt } from '../types';
import { JsonViewer } from './JsonViewer';

interface PromptsPanelProps {
  prompts: McpPrompt[];
  onGetPrompt: (name: string, args?: Record<string, string>) => Promise<unknown>;
  loading?: boolean;
  serverRunning: boolean;
}

interface PromptItemProps {
  prompt: McpPrompt;
  expanded: boolean;
  onToggle: () => void;
  onGet: (args?: Record<string, string>) => Promise<unknown>;
}

interface GetResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

const PromptItem = memo(function PromptItem({ prompt, expanded, onToggle, onGet }: PromptItemProps) {
  const [getting, setGetting] = useState(false);
  const [result, setResult] = useState<GetResult | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});

  const handleArgChange = useCallback((name: string, value: string) => {
    setArgs(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleGet = useCallback(async () => {
    setGetting(true);
    setResult(null);

    try {
      // Filter out empty args
      const cleanArgs: Record<string, string> = {};
      for (const [key, val] of Object.entries(args)) {
        if (val) {
          cleanArgs[key] = val;
        }
      }

      const res = await onGet(Object.keys(cleanArgs).length > 0 ? cleanArgs : undefined);
      setResult({
        success: true,
        result: res,
      });
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGetting(false);
    }
  }, [args, onGet]);

  const hasArgs = prompt.arguments && prompt.arguments.length > 0;

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
        <MessageSquare className="w-4 h-4 text-[var(--holo-accent)]" />
        <span className="font-medium text-sm text-[var(--holo-text)]">{prompt.name}</span>
      </button>

      {expanded && (
        <div className="p-3 space-y-3 bg-[rgba(0,0,0,0.1)]">
          {prompt.description && (
            <p className="text-xs text-gray-400">{prompt.description}</p>
          )}

          {hasArgs && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-gray-400">Arguments</h4>
              {prompt.arguments!.map(arg => (
                <div key={arg.name}>
                  <label className="block text-xs text-gray-500 mb-1">
                    {arg.name}
                    {arg.required && <span className="text-red-400 ml-0.5">*</span>}
                    {arg.description && (
                      <span className="text-gray-600 ml-2">{arg.description}</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={args[arg.name] || ''}
                    onChange={e => handleArgChange(arg.name, e.target.value)}
                    className="w-full px-2 py-1.5 bg-[rgba(0,0,0,0.3)] border border-[var(--holo-accent)]/20 rounded text-sm text-[var(--holo-text)] focus:outline-none focus:border-[var(--holo-accent)]/50"
                  />
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleGet}
            disabled={getting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] rounded hover:bg-[var(--holo-accent)]/30 transition-colors disabled:opacity-50"
          >
            {getting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Getting...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Get Prompt</span>
              </>
            )}
          </button>

          {result && (
            <div className="border-t border-[var(--holo-accent)]/10 pt-3">
              <h4 className="text-xs font-medium text-gray-400 mb-2">Result</h4>
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

export function PromptsPanel({ prompts, onGetPrompt, loading, serverRunning }: PromptsPanelProps) {
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);

  const handleToggle = useCallback((promptName: string) => {
    setExpandedPrompt(prev => (prev === promptName ? null : promptName));
  }, []);

  const handleGet = useCallback(
    (promptName: string) => async (args?: Record<string, string>) => {
      return onGetPrompt(promptName, args);
    },
    [onGetPrompt]
  );

  if (!serverRunning) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Start a server to view prompts</p>
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

  if (prompts.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No prompts available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 overflow-auto h-full">
      <div className="text-xs text-gray-500 mb-3">{prompts.length} prompt(s) available</div>
      {prompts.map(prompt => (
        <PromptItem
          key={prompt.name}
          prompt={prompt}
          expanded={expandedPrompt === prompt.name}
          onToggle={() => handleToggle(prompt.name)}
          onGet={handleGet(prompt.name)}
        />
      ))}
    </div>
  );
}
