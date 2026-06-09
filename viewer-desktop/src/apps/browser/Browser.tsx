import { useRef, useEffect, useCallback } from 'react';
import type { AppProps } from '../types';
import { BrowserToolbar } from './components/BrowserToolbar';
import { BookmarksBar } from './components/BookmarksBar';
import { WebViewContainer } from './components/WebViewContainer';
import { useBrowserState } from './hooks/useBrowserState';
import { useBookmarks } from './hooks/useBookmarks';
import type { WebViewRef } from './types';
import { HOME_PAGE } from './constants';
import { useAppContext } from '../AppContext';

export function Browser({ filePath, isActive, onTitleChange }: AppProps) {
  const { updateTab, setSuspended } = useAppContext();
  const webviewRef = useRef<WebViewRef>(null);
  const {
    state,
    navigate,
    goBack,
    goForward,
    refresh,
    stop,
    goHome,
    updateFromWebview,
    setDisplayUrl,
  } = useBrowserState(webviewRef);

  const {
    bookmarks,
    addBookmark,
    removeBookmark,
    isBookmarked,
    getBookmarkByUrl,
  } = useBookmarks();

  // Determine initial URL (use filePath if it looks like a URL, otherwise use home page)
  const initialUrl = filePath &&
    (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('www.'))
    ? (filePath.startsWith('www.') ? `https://${filePath}` : filePath)
    : HOME_PAGE;

  // Handle title changes
  const handleTitleChange = useCallback((title: string) => {
    onTitleChange?.(title || 'Browser');
  }, [onTitleChange]);

  // Persist current URL/title onto the tab so suspended tabs can restore
  useEffect(() => {
    if (!state.url) return;
    updateTab({ filePath: state.url });
  }, [state.url, updateTab]);

  useEffect(() => {
    if (!state.title) return;
    updateTab({ title: state.title });
  }, [state.title, updateTab]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key === 'r') {
        e.preventDefault();
        refresh();
      } else if (isMod && e.key === '[') {
        e.preventDefault();
        goBack();
      } else if (isMod && e.key === ']') {
        e.preventDefault();
        goForward();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, refresh, goBack, goForward]);

  // Handle bookmark toggle
  const handleBookmarkToggle = useCallback(() => {
    if (isBookmarked(state.url)) {
      const bookmark = getBookmarkByUrl(state.url);
      if (bookmark) {
        removeBookmark(bookmark.id);
      }
    } else {
      addBookmark(state.title, state.url);
    }
  }, [state.url, state.title, isBookmarked, getBookmarkByUrl, addBookmark, removeBookmark]);

  // Open DevTools
  const handleOpenDevTools = useCallback(() => {
    if (webviewRef.current?.isDevToolsOpened()) {
      webviewRef.current.closeDevTools();
    } else {
      webviewRef.current?.openDevTools();
    }
  }, []);

  const handleSuspend = useCallback(() => {
    setSuspended(true);
  }, [setSuspended]);

  return (
    <div className="flex flex-col h-full bg-[var(--holo-bg)]">
      {/* Loading progress bar */}
      {state.isLoading && (
        <div className="h-0.5 bg-[var(--holo-bg)]">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-all duration-200"
            style={{ width: `${state.loadProgress}%` }}
          />
        </div>
      )}

      {/* Toolbar */}
      <BrowserToolbar
        state={state}
        isActive={isActive}
        onBack={goBack}
        onForward={goForward}
        onRefresh={refresh}
        onStop={stop}
        onHome={goHome}
        onNavigate={navigate}
        onDisplayUrlChange={setDisplayUrl}
        onOpenDevTools={handleOpenDevTools}
        onSuspend={handleSuspend}
      />

      {/* Bookmarks bar */}
      <BookmarksBar
        bookmarks={bookmarks}
        currentUrl={state.url}
        isBookmarked={isBookmarked(state.url)}
        onBookmarkClick={navigate}
        onAddBookmark={handleBookmarkToggle}
        onRemoveBookmark={removeBookmark}
      />

      {/* Webview container */}
      <WebViewContainer
        ref={webviewRef}
        initialUrl={initialUrl}
        onStateChange={updateFromWebview}
        onTitleChange={handleTitleChange}
      />
    </div>
  );
}
