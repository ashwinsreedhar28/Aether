import { useState, useEffect } from 'react';
import { useFileWatcher } from '../../hooks/useFileWatcher';

export function Toolbar() {
  const { connected } = useFileWatcher();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="h-12 flex items-center justify-between px-4 relative">
      {/* Left: R.A.V.E.N. box */}
      <div
        className="holo-panel px-4 py-2 flex items-center"
        style={{
          clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
        }}
      >
        <div className="text-sm font-medium text-[var(--holo-text)]" style={{ fontFamily: 'DepartureMono, monospace' }}>
          R.A.V.E.N.
        </div>
      </div>

      {/* Right: Status and TIME box */}
      <div className="flex items-center gap-3">
        {/* Connection status */}
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? 'bg-green-500' : 'bg-red-500'
            }`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
          <span className="text-xs text-[var(--holo-muted)]">
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>

        {/* TIME box */}
        <div
          className="holo-panel px-4 py-2 flex items-center"
          style={{
            clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
          }}
        >
          <div className="text-sm font-medium text-[var(--holo-text)]">
            {time.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
