import { useState, useCallback } from 'react';
import type { BrowserState, WebViewRef } from '../types';
import { HOME_PAGE } from '../constants';

const initialState: BrowserState = {
  url: HOME_PAGE,
  displayUrl: HOME_PAGE,
  isLoading: false,
  loadProgress: 0,
  canGoBack: false,
  canGoForward: false,
  title: 'New Tab',
  isSecure: true,
};

export function useBrowserState(webviewRef: React.RefObject<WebViewRef | null>) {
  const [state, setState] = useState<BrowserState>(initialState);

  const navigate = useCallback((url: string) => {
    let finalUrl = url.trim();

    // If it doesn't look like a URL, treat it as a search
    if (!finalUrl.includes('.') && !finalUrl.startsWith('http')) {
      finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
    } else if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `https://${finalUrl}`;
    }

    setState(prev => ({ ...prev, displayUrl: finalUrl }));
    webviewRef.current?.loadURL(finalUrl);
  }, [webviewRef]);

  const goBack = useCallback(() => {
    webviewRef.current?.goBack();
  }, [webviewRef]);

  const goForward = useCallback(() => {
    webviewRef.current?.goForward();
  }, [webviewRef]);

  const refresh = useCallback(() => {
    webviewRef.current?.reload();
  }, [webviewRef]);

  const stop = useCallback(() => {
    webviewRef.current?.stop();
  }, [webviewRef]);

  const goHome = useCallback(() => {
    navigate(HOME_PAGE);
  }, [navigate]);

  const updateFromWebview = useCallback((updates: Partial<BrowserState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const setDisplayUrl = useCallback((url: string) => {
    setState(prev => ({ ...prev, displayUrl: url }));
  }, []);

  return {
    state,
    navigate,
    goBack,
    goForward,
    refresh,
    stop,
    goHome,
    updateFromWebview,
    setDisplayUrl,
  };
}
