import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewerProps {
  sessionId: string;
  isActive?: boolean;
}

export function TerminalViewer({ sessionId, isActive = true }: TerminalViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isInitializedRef = useRef(false);

  // Handle terminal data from main process
  const handleTerminalData = useCallback((event: { sessionId: string; data: string }) => {
    if (event.sessionId === sessionId && terminalRef.current) {
      terminalRef.current.write(event.data);
    }
  }, [sessionId]);

  // Handle terminal exit
  const handleTerminalExit = useCallback((event: { sessionId: string; exitCode: number }) => {
    if (event.sessionId === sessionId && terminalRef.current) {
      terminalRef.current.write(`\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m\r\n`);
    }
  }, [sessionId]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return;

    const terminal = new Terminal({
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

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    isInitializedRef.current = true;

    // Delay fit() to allow terminal to fully render
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        // Send initial size to PTY after fit
        const { cols, rows } = terminal;
        window.electron.terminal.resize(sessionId, cols, rows);
      } catch (e) {
        console.error('Failed to fit terminal:', e);
      }
    });

    // Handle user input - send to PTY
    terminal.onData((data) => {
      window.electron.terminal.write(sessionId, data);
    });

    // Handle terminal resize
    terminal.onResize(({ cols, rows }) => {
      window.electron.terminal.resize(sessionId, cols, rows);
    });

    // Subscribe to terminal output from main process
    const unsubscribeData = window.electron.terminal.onData(handleTerminalData);
    const unsubscribeExit = window.electron.terminal.onExit(handleTerminalExit);

    return () => {
      unsubscribeData();
      unsubscribeExit();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      isInitializedRef.current = false;
    };
  }, [sessionId, handleTerminalData, handleTerminalExit]);

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current || !fitAddonRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // Ignore resize errors during transitions
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Focus terminal when tab becomes active
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus();
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
