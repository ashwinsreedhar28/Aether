import { Settings, PauseCircle } from 'lucide-react';
import { NavigationButtons } from './NavigationButtons';
import { AddressBar } from './AddressBar';
import type { BrowserState } from '../types';

interface BrowserToolbarProps {
  state: BrowserState;
  isActive: boolean;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onStop: () => void;
  onHome: () => void;
  onNavigate: (url: string) => void;
  onDisplayUrlChange: (url: string) => void;
  onOpenDevTools: () => void;
  onSuspend: () => void;
}

export function BrowserToolbar({
  state,
  isActive,
  onBack,
  onForward,
  onRefresh,
  onStop,
  onHome,
  onNavigate,
  onDisplayUrlChange,
  onOpenDevTools,
  onSuspend,
}: BrowserToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.5)]">
      <NavigationButtons
        canGoBack={state.canGoBack}
        canGoForward={state.canGoForward}
        isLoading={state.isLoading}
        onBack={onBack}
        onForward={onForward}
        onRefresh={onRefresh}
        onStop={onStop}
        onHome={onHome}
      />

      <AddressBar
        url={state.url}
        displayUrl={state.displayUrl}
        isSecure={state.isSecure}
        isLoading={state.isLoading}
        isActive={isActive}
        onNavigate={onNavigate}
        onDisplayUrlChange={onDisplayUrlChange}
      />

      <button
        onClick={onSuspend}
        className="p-1.5 rounded text-[var(--holo-muted)] hover:text-[var(--holo-text)]
                   hover:bg-[rgba(0,255,255,0.1)] active:bg-[rgba(0,255,255,0.2)] transition-colors"
        title="Suspend Tab"
      >
        <PauseCircle className="w-4 h-4" />
      </button>

      {/* Dev Tools button */}
      <button
        onClick={onOpenDevTools}
        className="p-1.5 rounded text-[var(--holo-muted)] hover:text-[var(--holo-text)]
                   hover:bg-[rgba(0,255,255,0.1)] active:bg-[rgba(0,255,255,0.2)] transition-colors"
        title="Open DevTools"
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  );
}
