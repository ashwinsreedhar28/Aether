import { Component, Suspense, lazy, type ReactNode, type ComponentType } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import type { AppProps } from './types';

interface ErrorBoundaryProps {
  children: ReactNode;
  appId: string;
  onClose?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary that catches runtime errors in apps
 */
class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`App "${this.props.appId}" crashed:`, error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-4 p-6 bg-[rgba(15,15,25,0.9)]">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-6 h-6" />
            <span className="text-lg font-medium">App Crashed</span>
          </div>

          <p className="text-sm text-[var(--holo-muted)] text-center max-w-md">
            The "{this.props.appId}" app encountered an error and stopped working.
          </p>

          {/* Show error in dev mode */}
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300 max-w-md overflow-auto max-h-32">
              {this.state.error.message}
            </pre>
          )}

          <div className="flex gap-2 mt-2">
            <button
              onClick={this.handleReload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] rounded hover:bg-[var(--holo-accent)]/30 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reload App
            </button>
            {this.props.onClose && (
              <button
                onClick={this.props.onClose}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
              >
                <X className="w-4 h-4" />
                Close Tab
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Loading fallback shown while app is being loaded
 */
function AppLoading() {
  return (
    <div className="h-full flex items-center justify-center text-[var(--holo-muted)]">
      <div className="flex flex-col items-center gap-2">
        <div className="w-6 h-6 border-2 border-[var(--holo-accent)]/30 border-t-[var(--holo-accent)] rounded-full animate-spin" />
        <span className="text-sm">Loading app...</span>
      </div>
    </div>
  );
}

interface AppWrapperProps {
  appId: string;
  AppComponent: ComponentType<AppProps>;
  appProps: AppProps;
  onClose?: () => void;
}

/**
 * Wrapper component that provides error boundary and suspense for apps
 */
export function AppWrapper({ appId, AppComponent, appProps, onClose }: AppWrapperProps) {
  return (
    <AppErrorBoundary appId={appId} onClose={onClose}>
      <Suspense fallback={<AppLoading />}>
        <AppComponent {...appProps} />
      </Suspense>
    </AppErrorBoundary>
  );
}

/**
 * Create a lazy-loaded app component with error handling
 */
// eslint-disable-next-line react-refresh/only-export-components -- factory co-located with the wrapper component by design
export function createLazyApp(
  importFn: () => Promise<{ default: ComponentType<AppProps> }>
): ComponentType<AppProps> {
  return lazy(importFn);
}
