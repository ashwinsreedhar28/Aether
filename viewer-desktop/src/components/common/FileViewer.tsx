import { memo } from 'react';
import { getApp } from '../../apps';
import { AppWrapper } from '../../apps/AppWrapper';
import { AppProvider } from '../../apps/AppContext';
import type { AppProps } from '../../apps/types';

interface FileViewerProps {
  windowId: string;
  tabId: string;
  filePath: string;
  appId: string;
  isActive?: boolean;
  onClose?: () => void;
}

/**
 * FileViewer dynamically loads and renders app components based on appId.
 * Each app is wrapped in an ErrorBoundary for crash isolation.
 * Memoized to prevent re-renders when only parent Window position changes.
 */
export const FileViewer = memo(function FileViewer({
  windowId,
  tabId,
  filePath,
  appId,
  isActive = true,
  onClose,
}: FileViewerProps) {
  // Get the app definition from the registry
  const appDef = getApp(appId);

  if (!appDef) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--holo-muted)]">
        <div className="text-center">
          <p className="text-amber-400 mb-2">Unknown app: {appId}</p>
          <p className="text-sm">This app type is not registered.</p>
        </div>
      </div>
    );
  }

  const AppComponent = appDef.component;

  const appProps: AppProps = {
    windowId,
    tabId,
    filePath,
    isActive,
  };

  return (
    <AppProvider windowId={windowId} tabId={tabId}>
      <AppWrapper
        appId={appId}
        AppComponent={AppComponent}
        appProps={appProps}
        onClose={onClose}
      />
    </AppProvider>
  );
});
