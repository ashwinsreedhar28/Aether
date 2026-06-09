import { useCallback, useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import type { BrowserState, WebViewRef } from '../types';
import { HOME_PAGE, BLOCKED_PROTOCOLS } from '../constants';

interface WebViewContainerProps {
  initialUrl?: string;
  onStateChange: (updates: Partial<BrowserState>) => void;
  onTitleChange?: (title: string) => void;
}

export const WebViewContainer = forwardRef<WebViewRef, WebViewContainerProps>(
  function WebViewContainer({ initialUrl, onStateChange, onTitleChange }, ref) {
    const webviewRef = useRef<Electron.WebviewTag | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [src] = useState(() => initialUrl || HOME_PAGE);

    const pendingUpdatesRef = useRef<Partial<BrowserState> | null>(null);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const emitStateChange = useCallback((updates: Partial<BrowserState>) => {
      pendingUpdatesRef.current = { ...(pendingUpdatesRef.current || {}), ...updates };
      if (flushTimerRef.current) return;

      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        const pending = pendingUpdatesRef.current;
        pendingUpdatesRef.current = null;
        if (pending) onStateChange(pending);
      }, 100);
    }, [onStateChange]);

    // Expose webview methods via ref
    useImperativeHandle(ref, () => ({
      loadURL: (url: string) => webviewRef.current?.loadURL(url),
      goBack: () => webviewRef.current?.goBack(),
      goForward: () => webviewRef.current?.goForward(),
      reload: () => webviewRef.current?.reload(),
      stop: () => webviewRef.current?.stop(),
      canGoBack: () => webviewRef.current?.canGoBack() ?? false,
      canGoForward: () => webviewRef.current?.canGoForward() ?? false,
      getURL: () => webviewRef.current?.getURL() ?? '',
      getTitle: () => webviewRef.current?.getTitle() ?? '',
      openDevTools: () => webviewRef.current?.openDevTools(),
      isDevToolsOpened: () => webviewRef.current?.isDevToolsOpened() ?? false,
      closeDevTools: () => webviewRef.current?.closeDevTools(),
    }), []);

    useEffect(() => {
      const webview = webviewRef.current;
      if (!webview) return;

      const handleDidStartLoading = () => {
        emitStateChange({ isLoading: true, loadProgress: 10 });
      };

      const handleDidStopLoading = () => {
        emitStateChange({
          isLoading: false,
          loadProgress: 100,
          canGoBack: webview.canGoBack(),
          canGoForward: webview.canGoForward(),
        });
      };

      const handleDidNavigate = (event: Electron.DidNavigateEvent) => {
        const url = event.url;
        const isSecure = url.startsWith('https://');
        emitStateChange({
          url,
          displayUrl: url,
          isSecure,
          canGoBack: webview.canGoBack(),
          canGoForward: webview.canGoForward(),
        });
      };

      const handleDidNavigateInPage = (event: Electron.DidNavigateInPageEvent) => {
        if (event.isMainFrame) {
          const url = event.url;
          const isSecure = url.startsWith('https://');
          emitStateChange({
            url,
            displayUrl: url,
            isSecure,
            canGoBack: webview.canGoBack(),
            canGoForward: webview.canGoForward(),
          });
        }
      };

      const handlePageTitleUpdated = (event: Electron.PageTitleUpdatedEvent) => {
        emitStateChange({ title: event.title });
        onTitleChange?.(event.title);
      };

      const handleDidFailLoad = (event: Electron.DidFailLoadEvent) => {
        if (event.errorCode !== -3) { // Ignore aborted loads
          console.error('Page load failed:', event.errorDescription);
          emitStateChange({ isLoading: false, loadProgress: 0 });
        }
      };

      const handleNewWindow = (event: { preventDefault: () => void; url: string }) => {
        event.preventDefault();
        // Open in the same webview instead of new window
        const protocol = new URL(event.url).protocol;
        if (!BLOCKED_PROTOCOLS.includes(protocol)) {
          webview.loadURL(event.url);
        }
      };

      const handleWillNavigate = (event: Electron.WillNavigateEvent) => {
        try {
          const protocol = new URL(event.url).protocol;
          if (BLOCKED_PROTOCOLS.includes(protocol)) {
            event.preventDefault();
          }
        } catch {
          event.preventDefault();
        }
      };

      // Add event listeners
      webview.addEventListener('did-start-loading', handleDidStartLoading);
      webview.addEventListener('did-stop-loading', handleDidStopLoading);
      webview.addEventListener('did-navigate', handleDidNavigate as EventListener);
      webview.addEventListener('did-navigate-in-page', handleDidNavigateInPage as EventListener);
      webview.addEventListener('page-title-updated', handlePageTitleUpdated as EventListener);
      webview.addEventListener('did-fail-load', handleDidFailLoad as EventListener);
      webview.addEventListener('new-window', handleNewWindow as unknown as EventListener);
      webview.addEventListener('will-navigate', handleWillNavigate as EventListener);

      return () => {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        pendingUpdatesRef.current = null;

        webview.removeEventListener('did-start-loading', handleDidStartLoading);
        webview.removeEventListener('did-stop-loading', handleDidStopLoading);
        webview.removeEventListener('did-navigate', handleDidNavigate as EventListener);
        webview.removeEventListener('did-navigate-in-page', handleDidNavigateInPage as EventListener);
        webview.removeEventListener('page-title-updated', handlePageTitleUpdated as EventListener);
        webview.removeEventListener('did-fail-load', handleDidFailLoad as EventListener);
        webview.removeEventListener('new-window', handleNewWindow as unknown as EventListener);
        webview.removeEventListener('will-navigate', handleWillNavigate as EventListener);
      };
    }, [emitStateChange, onTitleChange]);

    return (
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <webview
          ref={webviewRef}
          src={src}
          className="absolute inset-0 w-full h-full"
          webpreferences="contextIsolation=yes, nodeIntegration=no, sandbox=yes"
          partition="persist:browser"
        />
      </div>
    );
  }
);
