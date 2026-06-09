import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, X, AlertCircle, Mic, MicOff, Radio, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type {
  TranscriptEntry,
  ToolCallEntry,
  VoiceAvailability,
  RavenStatus,
} from '../../types/aether';

// The cmd-/ palette is the console for Aether's raven-core voice assistant —
// NOT a Claude chat. Typed input is injected via window.aether.voice.sendText
// (the same brain the mic feeds); replies + tool calls arrive on the voice push
// channels, so a typed conversation reads exactly like a spoken one.

interface CommandPaletteProps {
  isVisible: boolean;
  onClose: () => void;
  onProcessingChange?: (processing: boolean) => void;
}

type LogLine =
  | { kind: 'speech'; id: string; speaker: 'user' | 'raven' | 'system'; text: string }
  | { kind: 'tool'; id: string; toolName: string; ok: boolean };

export function CommandPalette({ isVisible, onClose, onProcessingChange }: CommandPaletteProps) {
  const [input, setInput] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);
  const [available, setAvailable] = useState<VoiceAvailability | null>(null);
  const [status, setStatus] = useState<RavenStatus>('stopped');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const listening = status === 'running' || status === 'starting';
  const isAvailable = available?.kind === 'available';

  // Append a transcript fragment, merging it into the previous line when the
  // same speaker is still talking (transcription arrives incrementally).
  const pushTranscript = useCallback((entry: TranscriptEntry) => {
    if (!entry.text) return;
    setLog((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === 'speech' && last.speaker === entry.speaker) {
        const merged = { ...last, text: last.text + entry.text };
        return [...prev.slice(0, -1), merged];
      }
      return [...prev, { kind: 'speech', id: entry.id, speaker: entry.speaker, text: entry.text }];
    });
  }, []);

  const pushToolCall = useCallback((entry: ToolCallEntry) => {
    setLog((prev) => [
      ...prev,
      { kind: 'tool', id: entry.id, toolName: entry.toolName, ok: !entry.error },
    ]);
  }, []);

  // Subscribe to the voice push channels + seed current state on mount.
  useEffect(() => {
    let alive = true;
    window.aether.voice.availability().then((a) => alive && setAvailable(a));
    window.aether.voice.status().then((s) => alive && setStatus(s.status));
    window.aether.voice.recentTranscripts(20).then(({ transcripts }) => {
      if (!alive) return;
      transcripts.forEach(pushTranscript);
    });

    const unsubs = [
      window.aether.voice.onTranscript(pushTranscript),
      window.aether.voice.onToolCall(pushToolCall),
      window.aether.voice.onAvailabilityChanged((a) => setAvailable(a)),
      window.aether.voice.onStatusChanged((s) => setStatus(s.status)),
    ];
    return () => {
      alive = false;
      unsubs.forEach((u) => u());
    };
  }, [pushTranscript, pushToolCall]);

  // Auto-scroll
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  // Focus when shown
  useEffect(() => {
    if (isVisible) inputRef.current?.focus();
  }, [isVisible]);

  useEffect(() => {
    // Only the brief text-send counts as "processing" for the parent's shimmer
    // bar — ambient listening is the steady state, not an in-flight turn.
    onProcessingChange?.(sending);
  }, [sending, onProcessingChange]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setFeedback(null);
    setSending(true);
    try {
      const res = await window.aether.voice.sendText(text);
      if ('error' in res) {
        const reason =
          res.error === 'no_session'
            ? 'Raven is not listening — turn the mic on.'
            : res.error === 'empty'
              ? 'Say something first.'
              : res.error;
        setFeedback(reason);
      }
      // On success the daemon echoes a 'user' transcript + raven's reply over
      // the push channel, so we don't append here.
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'send failed');
    } finally {
      setSending(false);
    }
  };

  const toggleMic = async () => {
    try {
      if (listening) await window.aether.voice.stop();
      else await window.aether.voice.start();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'mic toggle failed');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isVisible) return null;

  const hasLog = log.length > 0 || feedback;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center pb-8"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-3xl bg-[var(--holo-panel)]/95 backdrop-blur-md border border-[var(--holo-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Unavailable banner */}
        {available && !isAvailable && (
          <div className="px-4 py-3 border-b border-[var(--holo-border)] flex items-start gap-2 text-sm text-amber-300">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Raven is unavailable ({available.reason}). The mesh and apps still work; set
              {' '}<span className="font-mono">GEMINI_API_KEY</span> in .env.local to wake the assistant.
            </span>
          </div>
        )}

        {/* Transcript */}
        {hasLog && (
          <div
            ref={logRef}
            className="max-h-80 overflow-y-auto p-4 border-b border-[var(--holo-border)] space-y-2"
          >
            {log.map((line) =>
              line.kind === 'tool' ? (
                <div
                  key={line.id}
                  className="flex items-center gap-1.5 text-xs font-mono text-[var(--holo-accent)] opacity-70"
                >
                  <Wrench size={12} />
                  {line.toolName}
                  {!line.ok && <span className="text-red-400">(failed)</span>}
                </div>
              ) : (
                <div key={line.id} className="text-sm">
                  <span
                    className={`text-[10px] uppercase tracking-wider font-mono mr-2 ${
                      line.speaker === 'user'
                        ? 'text-[var(--holo-muted)]'
                        : line.speaker === 'raven'
                          ? 'text-[var(--holo-accent)]'
                          : 'text-amber-400'
                    }`}
                  >
                    {line.speaker === 'raven' ? 'Aether' : line.speaker}
                  </span>
                  <div className="text-[var(--holo-text)] prose prose-invert prose-sm max-w-none inline">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {line.text}
                    </ReactMarkdown>
                  </div>
                </div>
              ),
            )}
            {feedback && (
              <div className="flex items-center gap-2 text-amber-300 text-sm">
                <AlertCircle size={16} />
                {feedback}
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <div className="flex items-center gap-3 p-4">
          <button
            onClick={toggleMic}
            disabled={!isAvailable}
            title={listening ? 'Stop listening' : 'Start listening'}
            className={`flex-shrink-0 transition-colors disabled:opacity-30 ${
              listening ? 'text-[var(--holo-accent)]' : 'text-[var(--holo-muted)] hover:text-[var(--holo-accent)]'
            }`}
          >
            {listening ? <Radio size={20} className="animate-pulse" /> : isAvailable ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isAvailable ? 'Talk to Aether…' : 'Aether assistant offline'}
            className="flex-1 bg-transparent text-[var(--holo-text)] placeholder-[var(--holo-muted)] focus:outline-none"
            autoFocus
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || sending}
            className="text-[var(--holo-muted)] hover:text-[var(--holo-accent)] disabled:opacity-30 transition-colors flex-shrink-0"
          >
            <Send size={20} />
          </button>
          <button
            onClick={onClose}
            className="text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Hint bar */}
        <div className="px-4 pb-3 text-xs text-[var(--holo-muted)] flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                listening ? 'bg-[var(--holo-accent)] animate-pulse' : isAvailable ? 'bg-green-500' : 'bg-[var(--holo-muted)]'
              }`}
            />
            {listening ? 'Listening' : isAvailable ? 'Ready' : 'Offline'}
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-[var(--holo-bg)] rounded border border-[var(--holo-border)] font-mono text-[10px]">Enter</kbd>{' '}
            Send
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-[var(--holo-bg)] rounded border border-[var(--holo-border)] font-mono text-[10px]">esc</kbd>{' '}
            Close
          </span>
          <span className="ml-auto opacity-70 font-mono">raven-core</span>
        </div>
      </div>
    </div>
  );
}
