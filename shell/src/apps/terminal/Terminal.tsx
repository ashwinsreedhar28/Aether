import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { AppProps } from '../types';
import { useAppContext } from '../AppContext';
import { registerTerminal, unregisterTerminal } from '../../utils/terminalRegistry';

export function Terminal({ filePath: sessionId, isActive }: AppProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isInitializedRef = useRef(false);
  const { updateTab } = useAppContext();

  // Track the actual valid session ID (may differ from prop if session was recreated)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Validate/create session on mount
  useEffect(() => {
    if (!sessionId) return;
    const sid = sessionId;

    let cancelled = false;

    async function ensureSession() {
      try {
        // Check if session exists
        const existingSession = await window.electron.terminal.getSession(sid);

        if (cancelled) return;

        if (existingSession) {
          // Session exists, use it
          setActiveSessionId(sid);
        } else {
          // Session doesn't exist (app was restarted), create new one
          const newSession = await window.electron.terminal.create();

          if (cancelled) return;

          // Update the tab's filePath to the new session ID
          updateTab({ filePath: newSession.sessionId });
          setActiveSessionId(newSession.sessionId);
        }
      } catch (e) {
        console.error('Failed to ensure terminal session:', e);
      }
    }

    ensureSession();

    return () => {
      cancelled = true;
    };
  }, [sessionId, updateTab]);

  // Handle terminal data from main process
  const handleTerminalData = useCallback((event: { sessionId: string; data: string }) => {
    if (event.sessionId === activeSessionId && terminalRef.current) {
      terminalRef.current.write(event.data);
    }
  }, [activeSessionId]);

  // Handle terminal exit
  const handleTerminalExit = useCallback((event: { sessionId: string; exitCode: number }) => {
    if (event.sessionId === activeSessionId && terminalRef.current) {
      terminalRef.current.write(`\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m\r\n`);
    }
  }, [activeSessionId]);

  // Initialize terminal once we have a valid session
  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current || !activeSessionId) return;

    const terminal = new XTerm({
      theme: {
        background: '#0a0a0f',
        foreground: '#e0e0e0',
        cursor: '#00ffff',
        cursorAccent: '#0a0a0f',
        selectionBackground: 'rgba(0, 255, 255, 0.3)',
        selectionForeground: '#ffffff',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
        brightBlack: '#6272a4',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);
    registerTerminal(terminal);

    // Allow Cmd/Ctrl+Arrow to pass through for window navigation
    terminal.attachCustomKeyEventHandler((event) => {
      if ((event.metaKey || event.ctrlKey) &&
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        return false; // Don't handle, let it bubble
      }
      return true; // Handle all other keys normally
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    isInitializedRef.current = true;

    // Delay fit() to allow terminal to fully render
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        // Send initial size to PTY after fit
        const { cols, rows } = terminal;
        window.electron.terminal.resize(activeSessionId, cols, rows);
        // Auto-focus terminal after initialization
        terminal.focus();
      } catch (e) {
        console.error('Failed to fit terminal:', e);
      }
    });

    // Handle user input - send to PTY
    terminal.onData((data) => {
      window.electron.terminal.write(activeSessionId, data);
    });

    // Handle terminal resize
    terminal.onResize(({ cols, rows }) => {
      window.electron.terminal.resize(activeSessionId, cols, rows);
    });

    // Subscribe to terminal output from main process
    const unsubscribeData = window.electron.terminal.onData(handleTerminalData);
    const unsubscribeExit = window.electron.terminal.onExit(handleTerminalExit);

    return () => {
      unsubscribeData();
      unsubscribeExit();
      unregisterTerminal(terminal);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      isInitializedRef.current = false;
    };
  }, [activeSessionId, handleTerminalData, handleTerminalExit]);

  // Handle container resize - must depend on activeSessionId to ensure
  // the ResizeObserver is set up after the terminal is initialized
  useEffect(() => {
    if (!containerRef.current || !fitAddonRef.current) return;

    const container = containerRef.current;

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // Ignore resize errors during transitions
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [activeSessionId]);

  // Focus terminal and scroll to bottom when tab becomes active
  useEffect(() => {
    if (isActive && terminalRef.current) {
      // Use requestAnimationFrame to ensure DOM is ready after window focus change
      // Then use a small timeout to let xterm's internal focus handling settle
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (terminalRef.current) {
            terminalRef.current.focus();
            terminalRef.current.scrollToBottom();
          }
        }, 10);
      });
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-[#0a0a0f]"
      style={{ padding: '4px' }}
    />
  );
}
