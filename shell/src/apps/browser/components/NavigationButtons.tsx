import { ArrowLeft, ArrowRight, RotateCw, X, Home } from 'lucide-react';

interface NavigationButtonsProps {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onStop: () => void;
  onHome: () => void;
}

export function NavigationButtons({
  canGoBack,
  canGoForward,
  isLoading,
  onBack,
  onForward,
  onRefresh,
  onStop,
  onHome,
}: NavigationButtonsProps) {
  const buttonClass = (enabled: boolean) =>
    `p-1.5 rounded transition-colors ${
      enabled
        ? 'text-[var(--holo-text)] hover:bg-[rgba(0,255,255,0.1)] active:bg-[rgba(0,255,255,0.2)]'
        : 'text-[var(--holo-muted)] cursor-not-allowed opacity-50'
    }`;

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={onBack}
        disabled={!canGoBack}
        className={buttonClass(canGoBack)}
        title="Go back"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>

      <button
        onClick={onForward}
        disabled={!canGoForward}
        className={buttonClass(canGoForward)}
        title="Go forward"
      >
        <ArrowRight className="w-4 h-4" />
      </button>

      {isLoading ? (
        <button
          onClick={onStop}
          className={buttonClass(true)}
          title="Stop loading"
        >
          <X className="w-4 h-4" />
        </button>
      ) : (
        <button
          onClick={onRefresh}
          className={buttonClass(true)}
          title="Refresh"
        >
          <RotateCw className="w-4 h-4" />
        </button>
      )}

      <button
        onClick={onHome}
        className={buttonClass(true)}
        title="Home"
      >
        <Home className="w-4 h-4" />
      </button>
    </div>
  );
}
