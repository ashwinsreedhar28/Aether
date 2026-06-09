import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, X, Loader2, AlertCircle, Sparkles, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useWorkspaceStore } from '../../stores/workspaceStore';

interface StreamedContent {
  id: string;
  type: 'text' | 'tool_use' | 'thinking';
  content: string;
}

const AVAILABLE_MODELS = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
] as const;

interface CommandPaletteProps {
  isVisible: boolean;
  onClose: () => void;
  onProcessingChange?: (processing: boolean) => void;
}

export function CommandPalette({ isVisible, onClose, onProcessingChange }: CommandPaletteProps) {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [responses, setResponses] = useState<StreamedContent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('sonnet');
  const [sessionId, setSessionId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const scrollPositionRef = useRef<number>(0);

  const activeWorkspace = useWorkspaceStore(s => {
    const id = s.activeWorkspaceId;
    return s.workspaces.find(w => w.id === id);
  });

  // Get current file from active window/tab
  const getCurrentFile = useCallback((): string | undefined => {
    if (!activeWorkspace) return undefined;
    const activeWindow = activeWorkspace.windows.find(w => w.id === activeWorkspace.focusedWindowId);
    if (!activeWindow) return undefined;
    const activeTab = activeWindow.tabs?.find(t => t.id === activeWindow.activeTabId);
    return activeTab?.filePath;
  }, [activeWorkspace]);

  // Get all open file paths across all windows/tabs
  const getOpenFiles = useCallback((): string[] => {
    if (!activeWorkspace) return [];
    return activeWorkspace.windows
      .flatMap(w => w.tabs || [])
      .map(tab => tab.filePath);
  }, [activeWorkspace]);

  // Check auth status on mount
  useEffect(() => {
    window.electron.claude.getAuthStatus().then(status => {
      setIsAuthenticated(status.authenticated);
    });
  }, []);

  // Set up stream listener
  useEffect(() => {
    const cleanup = window.electron.claude.onStream((message) => {
      // Capture session ID from any message
      if (message.session_id && !sessionIdRef.current) {
        sessionIdRef.current = message.session_id;
        setSessionId(message.session_id);
      }

      if (message.type === 'assistant') {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          content.forEach((block) => {
            if (block.type === 'text' && block.text) {
              setResponses(prev => [...prev, {
                id: crypto.randomUUID(),
                type: 'text',
                content: block.text!
              }]);
              setStreamingText('');
            } else if (block.type === 'tool_use' && block.name) {
              setResponses(prev => [...prev, {
                id: crypto.randomUUID(),
                type: 'tool_use',
                content: `Using ${block.name}...`
              }]);
            }
          });
        }
      } else if (message.type === 'stream_event') {
        const delta = message.event?.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          setStreamingText(prev => prev + delta.text);
        }
      } else if (message.type === 'result') {
        // Flush any remaining streaming text
        if (streamingText) {
          setResponses(prev => [...prev, {
            id: crypto.randomUUID(),
            type: 'text',
            content: streamingText
          }]);
          setStreamingText('');
        }
        setIsProcessing(false);
        if (message.is_error) {
          setError(message.errors?.join(', ') || 'An error occurred');
        }
      }
    });

    return cleanup;
  }, [streamingText]);

  // Auto-scroll responses
  useEffect(() => {
    responseRef.current?.scrollTo(0, responseRef.current.scrollHeight);
  }, [responses, streamingText]);

  // Focus input and restore scroll position when palette becomes visible
  useEffect(() => {
    if (isVisible) {
      inputRef.current?.focus();
      requestAnimationFrame(() => {
        if (responseRef.current) {
          responseRef.current.scrollTop = scrollPositionRef.current;
        }
      });
    } else {
      if (responseRef.current) {
        scrollPositionRef.current = responseRef.current.scrollTop;
      }
    }
  }, [isVisible]);

  // Notify parent of processing state changes
  useEffect(() => {
    onProcessingChange?.(isProcessing);
  }, [isProcessing, onProcessingChange]);

  // Clear conversation and session
  const handleClear = () => {
    sessionIdRef.current = null;
    setSessionId(null);
    setResponses([]);
    setStreamingText('');
    setError(null);
    setInput('');
    inputRef.current?.focus();
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!input.trim() || isProcessing) return;

    const query = input;
    setIsProcessing(true);
    setStreamingText('');
    setError(null);

    // Add separator for follow-up queries in the same session
    if (sessionId && responses.length > 0) {
      setResponses(prev => [...prev, {
        id: crypto.randomUUID(),
        type: 'text',
        content: `\n> ${query}\n`
      }]);
    } else if (!sessionId) {
      setResponses([]);
    }

    setInput('');

    try {
      await window.electron.claude.query(query, {
        cwd: activeWorkspace?.rootDir || process.cwd(),
        currentFile: getCurrentFile(),
        model: selectedModel,
        resume: sessionId || undefined,
        openFiles: getOpenFiles(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
      setIsProcessing(false);
    }
  };

  // Handle abort
  const handleAbort = () => {
    window.electron.claude.abort();
    setIsProcessing(false);
  };

  // Handle keyboard
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Hide when not visible (component stays mounted for background processing)
  if (!isVisible) return null;

  // Render auth prompt if not authenticated
  if (isAuthenticated === false) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-end justify-center pb-8"
        onClick={handleBackdropClick}
      >
        <div
          className="w-full max-w-2xl bg-[var(--holo-panel)] border border-[var(--holo-border)] rounded-lg p-6 shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="text-[var(--holo-accent)]" size={24} />
            <h3 className="text-lg text-[var(--holo-text)]">Sign in to Claude</h3>
          </div>
          <p className="text-sm text-[var(--holo-muted)] mb-4">
            The command palette requires authentication. Set the CLAUDE_CODE_OAUTH_TOKEN environment variable or run `claude login` in your terminal.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading auth state
  if (isAuthenticated === null) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-end justify-center pb-8"
        onClick={handleBackdropClick}
      >
        <div className="w-full max-w-3xl bg-[var(--holo-panel)] border border-[var(--holo-border)] rounded-lg p-4 shadow-2xl">
          <div className="flex items-center justify-center gap-2 text-[var(--holo-muted)]">
            <Loader2 size={20} className="animate-spin" />
            <span>Checking authentication...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center pb-8"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-3xl bg-[var(--holo-panel)]/95 backdrop-blur-md border border-[var(--holo-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Response area - only show if there are responses */}
        {(responses.length > 0 || streamingText || error) && (
          <div
            ref={responseRef}
            className="max-h-80 overflow-y-auto p-4 border-b border-[var(--holo-border)] space-y-2"
          >
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            {responses.map((r) => (
              <div key={r.id} className="text-sm">
                {r.type === 'tool_use' ? (
                  <span className="text-[var(--holo-accent)] opacity-70 text-xs font-mono">
                    {r.content}
                  </span>
                ) : (
                  <div className="text-[var(--holo-text)] prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{r.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
            {streamingText && (
              <div className="text-sm">
                <div className="text-[var(--holo-text)] prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{streamingText}</ReactMarkdown>
                </div>
                <span className="inline-block w-2 h-4 bg-[var(--holo-accent)] animate-pulse ml-0.5" />
              </div>
            )}
          </div>
        )}

        {/* Input area */}
        <div className="flex items-center gap-3 p-4">
          <Sparkles size={20} className="text-[var(--holo-accent)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Claude anything..."
            disabled={isProcessing}
            className="flex-1 bg-transparent text-[var(--holo-text)] placeholder-[var(--holo-muted)] focus:outline-none disabled:opacity-50"
            autoFocus
          />

          {isProcessing ? (
            <button
              onClick={handleAbort}
              className="text-[var(--holo-accent)] hover:text-red-400 transition-colors flex-shrink-0"
              title="Stop"
            >
              <Loader2 size={20} className="animate-spin" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="text-[var(--holo-muted)] hover:text-[var(--holo-accent)] disabled:opacity-30 transition-colors flex-shrink-0"
            >
              <Send size={20} />
            </button>
          )}

          {sessionId && (
            <button
              onClick={handleClear}
              className="text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors flex-shrink-0"
              title="Clear conversation"
            >
              <RotateCcw size={16} />
            </button>
          )}

          <button
            onClick={onClose}
            className="text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Hint bar */}
        <div className="px-4 pb-3 text-xs text-[var(--holo-muted)] flex items-center gap-4">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isProcessing}
            className="bg-[var(--holo-bg)] text-[var(--holo-muted)] border border-[var(--holo-border)] rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:border-[var(--holo-accent)] disabled:opacity-50"
          >
            {AVAILABLE_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <span>
            <kbd className="px-1.5 py-0.5 bg-[var(--holo-bg)] rounded border border-[var(--holo-border)] font-mono text-[10px]">Enter</kbd>
            {' '}Send
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-[var(--holo-bg)] rounded border border-[var(--holo-border)] font-mono text-[10px]">esc</kbd>
            {' '}Close
          </span>
          {sessionId && (
            <span className="text-[var(--holo-accent)] opacity-70">
              Session active
            </span>
          )}
          {getCurrentFile() && (
            <span className="ml-auto truncate max-w-xs opacity-70">
              Context: {getCurrentFile()?.split('/').pop()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
