import { useEffect, useState, type ReactNode } from 'react';
import { Activity, Hand, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useLeapStore } from '../../../stores/leapStore';

export function InputSettings() {
  const leap = useSettingsStore((s) => s.settings.input.leap);
  const setLeapSettings = useSettingsStore((s) => s.setLeapSettings);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  const status = useLeapStore((s) => s.connectionStatus);
  const error = useLeapStore((s) => s.error);
  const trackedHands = useLeapStore((s) => s.trackedHands);
  const lastFrameAt = useLeapStore((s) => s.lastFrameAt);

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings().finally(() => setIsLoading(false));
  }, [loadSettings]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[var(--holo-muted)]">Loading settings...</div>
      </div>
    );
  }

  const statusIcon =
    status === 'connected' ? (
      <Wifi size={14} className="text-green-400" />
    ) : status === 'connecting' ? (
      <Loader2 size={14} className="text-amber-300 animate-spin" />
    ) : (
      <WifiOff size={14} className="text-red-400" />
    );

  const lastSeen =
    typeof lastFrameAt === 'number'
      ? new Date(lastFrameAt).toLocaleTimeString()
      : 'never';

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="text-sm font-medium text-[var(--holo-text)] mb-1">Leap Motion</h2>
          <p className="text-xs text-[var(--holo-muted)]">
            Vision-Pro-style hand input for selecting, dragging, and scrolling with pinch gestures.
          </p>
        </div>

        <div className="p-4 rounded-lg border border-[var(--holo-border)] bg-[rgba(20,20,30,0.4)] space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Hand size={14} className="text-[var(--holo-accent)]" />
              <span className="text-sm text-[var(--holo-text)]">Enable Leap Controls</span>
            </div>
            <button
              onClick={() => setLeapSettings({ enabled: !leap.enabled })}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                leap.enabled
                  ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                  : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
              }`}
            >
              {leap.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 text-[var(--holo-muted)]">
              {statusIcon}
              <span className="capitalize">{status}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[var(--holo-muted)]">
              <Activity size={12} />
              <span>{trackedHands} hand(s) tracked</span>
            </div>
            <span className="text-[var(--holo-muted)]">Last frame: {lastSeen}</span>
          </div>

          {error && status === 'error' && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="text-xs uppercase tracking-wide text-[var(--holo-muted)]">Connection</div>
          <SettingRow
            label="Leap Endpoint"
            description="WebSocket endpoint for Ultraleap service."
            control={
              <input
                type="text"
                value={leap.endpoint}
                onChange={(e) => setLeapSettings({ endpoint: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded bg-[rgba(15,15,25,0.8)] border border-[var(--holo-border)] focus:outline-none focus:border-[var(--holo-accent)]"
                placeholder="ws://127.0.0.1:6437/v7.json"
              />
            }
          />

          <SettingRow
            label="Reconnect Interval"
            description="Retry delay when service is unavailable."
            control={
              <NumberInput
                value={leap.reconnectMs}
                min={500}
                max={10000}
                step={100}
                unit="ms"
                onChange={(value) => setLeapSettings({ reconnectMs: value })}
              />
            }
          />

          <SliderRow
            label="Confidence Threshold"
            description="Ignore low-confidence tracked hands."
            min={0}
            max={1}
            step={0.01}
            value={leap.confidenceThreshold}
            onChange={(value) => setLeapSettings({ confidenceThreshold: value })}
          />

          <SliderRow
            label="Tracking Stale Timeout"
            description="How long hand data stays valid after last frame."
            min={80}
            max={1200}
            step={10}
            value={leap.staleHandMs}
            onChange={(value) => setLeapSettings({ staleHandMs: value })}
            unit="ms"
          />

          <SettingRow
            label="Hide Native Cursor"
            description="Hide system cursor while hands are actively tracked."
            control={
              <button
                onClick={() => setLeapSettings({ hideNativeCursor: !leap.hideNativeCursor })}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                  leap.hideNativeCursor
                    ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                    : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
                }`}
              >
                {leap.hideNativeCursor ? 'Enabled' : 'Disabled'}
              </button>
            }
          />

          <div className="text-xs uppercase tracking-wide text-[var(--holo-muted)]">Cursor Tracking</div>
          <SliderRow
            label="Cursor Smoothing"
            description="Higher values track faster, lower values feel steadier."
            min={0.05}
            max={1}
            step={0.01}
            value={leap.smoothing}
            onChange={(value) => setLeapSettings({ smoothing: value })}
          />

          <SliderRow
            label="Deadzone"
            description="Ignore tiny movements to reduce jitter."
            min={0}
            max={10}
            step={0.1}
            value={leap.deadzonePx}
            onChange={(value) => setLeapSettings({ deadzonePx: value })}
            unit="px"
          />

          <SliderRow
            label="Edge Padding"
            description="Reserve a border where cursor cannot enter."
            min={0}
            max={200}
            step={1}
            value={leap.edgePaddingPx}
            onChange={(value) => setLeapSettings({ edgePaddingPx: value })}
            unit="px"
          />

          <SettingRow
            label="Tracking Bounds (mm)"
            description="Physical palm range that maps to full screen."
            control={
              <div className="flex flex-wrap gap-3">
                <NumberInput
                  value={leap.xMinMm}
                  min={-500}
                  max={500}
                  step={1}
                  unit="x min"
                  onChange={(value) => setLeapSettings({ xMinMm: value })}
                />
                <NumberInput
                  value={leap.xMaxMm}
                  min={-500}
                  max={500}
                  step={1}
                  unit="x max"
                  onChange={(value) => setLeapSettings({ xMaxMm: value })}
                />
                <NumberInput
                  value={leap.yMinMm}
                  min={-200}
                  max={700}
                  step={1}
                  unit="y min"
                  onChange={(value) => setLeapSettings({ yMinMm: value })}
                />
                <NumberInput
                  value={leap.yMaxMm}
                  min={-200}
                  max={700}
                  step={1}
                  unit="y max"
                  onChange={(value) => setLeapSettings({ yMaxMm: value })}
                />
              </div>
            }
          />

          <SettingRow
            label="Axis Inversion"
            description="Flip cursor direction per axis."
            control={
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setLeapSettings({ invertX: !leap.invertX })}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    leap.invertX
                      ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                      : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
                  }`}
                >
                  Invert X: {leap.invertX ? 'On' : 'Off'}
                </button>
                <button
                  onClick={() => setLeapSettings({ invertY: !leap.invertY })}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    leap.invertY
                      ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                      : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
                  }`}
                >
                  Invert Y: {leap.invertY ? 'On' : 'Off'}
                </button>
              </div>
            }
          />

          <SliderRow
            label="Cursor Gain X"
            description="Horizontal amplification around center."
            min={0.2}
            max={3}
            step={0.01}
            value={leap.cursorGainX}
            onChange={(value) => setLeapSettings({ cursorGainX: value })}
          />

          <SliderRow
            label="Cursor Gain Y"
            description="Vertical amplification around center."
            min={0.2}
            max={3}
            step={0.01}
            value={leap.cursorGainY}
            onChange={(value) => setLeapSettings({ cursorGainY: value })}
          />

          <div className="text-xs uppercase tracking-wide text-[var(--holo-muted)]">Hover + Click</div>
          <SettingRow
            label="Hover Primary Hand"
            description="Preferred hand used for passive hover movement."
            control={
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'right', label: 'Right' },
                  { id: 'left', label: 'Left' },
                  { id: 'mostRecent', label: 'Most Recent' },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setLeapSettings({ hoverPrimaryHand: option.id as typeof leap.hoverPrimaryHand })}
                    className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                      leap.hoverPrimaryHand === option.id
                        ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                        : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            }
          />

          <SliderRow
            label="Hover Move Rate"
            description="Max hover-only pointer move event frequency."
            min={5}
            max={120}
            step={1}
            value={leap.hoverMoveHz}
            onChange={(value) => setLeapSettings({ hoverMoveHz: value })}
            unit="Hz"
          />

          <SliderRow
            label="Pinch Threshold"
            description="Pinch strength required to start interaction."
            min={0.3}
            max={1}
            step={0.01}
            value={leap.pinchThreshold}
            onChange={(value) => setLeapSettings({ pinchThreshold: value })}
          />

          <SliderRow
            label="Release Threshold"
            description="Pinch strength where held gesture is released."
            min={0.1}
            max={0.9}
            step={0.01}
            value={leap.releaseThreshold}
            onChange={(value) => setLeapSettings({ releaseThreshold: value })}
          />

          <SliderRow
            label="Click Movement Tolerance"
            description="Maximum movement before pinch click is cancelled."
            min={2}
            max={24}
            step={1}
            value={leap.dragActivationPx}
            onChange={(value) => setLeapSettings({ dragActivationPx: value })}
            unit="px"
          />

          <SliderRow
            label="Minimum Pinch Time For Click"
            description="Delay required before release can register click."
            min={0}
            max={300}
            step={5}
            value={leap.minPinchMsForClick}
            onChange={(value) => setLeapSettings({ minPinchMsForClick: value })}
            unit="ms"
          />

          <div className="text-xs uppercase tracking-wide text-[var(--holo-muted)]">Scroll Behavior</div>
          <SettingRow
            label="Scroll Fallback Mode"
            description="Controls when pinch-hold may switch into scroll mode."
            control={
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'auto', label: 'Auto (Scrollable only)' },
                  { id: 'always', label: 'Always' },
                  { id: 'never', label: 'Never' },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setLeapSettings({ scrollFallbackMode: option.id as typeof leap.scrollFallbackMode })}
                    className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                      leap.scrollFallbackMode === option.id
                        ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                        : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            }
          />

          <SliderRow
            label="Scroll Hold Delay"
            description="Pinch-hold time before scroll fallback is allowed."
            min={0}
            max={600}
            step={10}
            value={leap.scrollHoldDelayMs}
            onChange={(value) => setLeapSettings({ scrollHoldDelayMs: value })}
            unit="ms"
          />

          <SliderRow
            label="Scroll Activation Distance"
            description="Movement before pinch-hold switches from press to scroll."
            min={4}
            max={40}
            step={1}
            value={leap.scrollActivationPx}
            onChange={(value) => setLeapSettings({ scrollActivationPx: value })}
            unit="px"
          />

          <SliderRow
            label="Scroll Sensitivity"
            description="Scale of wheel delta while pinch-scrolling."
            min={0.2}
            max={3}
            step={0.05}
            value={leap.scrollSensitivity}
            onChange={(value) => setLeapSettings({ scrollSensitivity: value })}
          />

          <SliderRow
            label="Scroll Sensitivity X"
            description="Horizontal scroll multiplier."
            min={0}
            max={3}
            step={0.05}
            value={leap.scrollSensitivityX}
            onChange={(value) => setLeapSettings({ scrollSensitivityX: value })}
          />

          <SliderRow
            label="Scroll Sensitivity Y"
            description="Vertical scroll multiplier."
            min={0}
            max={3}
            step={0.05}
            value={leap.scrollSensitivityY}
            onChange={(value) => setLeapSettings({ scrollSensitivityY: value })}
          />

          <SettingRow
            label="Scroll Axis Mode"
            description="Restrict wheel injection to vertical/horizontal/both."
            control={
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'vertical', label: 'Vertical' },
                  { id: 'horizontal', label: 'Horizontal' },
                  { id: 'both', label: 'Both' },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setLeapSettings({ scrollAxisMode: option.id as typeof leap.scrollAxisMode })}
                    className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                      leap.scrollAxisMode === option.id
                        ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                        : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            }
          />

          <SettingRow
            label="Scroll Inversion"
            description="Invert wheel direction per axis."
            control={
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setLeapSettings({ invertScrollX: !leap.invertScrollX })}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    leap.invertScrollX
                      ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                      : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
                  }`}
                >
                  Invert X: {leap.invertScrollX ? 'On' : 'Off'}
                </button>
                <button
                  onClick={() => setLeapSettings({ invertScrollY: !leap.invertScrollY })}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    leap.invertScrollY
                      ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                      : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
                  }`}
                >
                  Invert Y: {leap.invertScrollY ? 'On' : 'Off'}
                </button>
              </div>
            }
          />

          <div className="text-xs uppercase tracking-wide text-[var(--holo-muted)]">Visual</div>
          <SettingRow
            label="Show Crosshairs"
            description="Display left/right holographic hand cursors when tracked."
            control={
              <button
                onClick={() => setLeapSettings({ showCrosshairs: !leap.showCrosshairs })}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                  leap.showCrosshairs
                    ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                    : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
                }`}
              >
                {leap.showCrosshairs ? 'Visible' : 'Hidden'}
              </button>
            }
          />

          <SettingRow
            label="Crosshair Style"
            description="Choose the visual style used for tracked hand cursors."
            control={
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'ironman', label: 'Iron Man' },
                  { id: 'minimal', label: 'Minimal' },
                  { id: 'dot', label: 'Dot' },
                ].map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setLeapSettings({ crosshairStyle: style.id as typeof leap.crosshairStyle })}
                    className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                      leap.crosshairStyle === style.id
                        ? 'text-[var(--holo-accent)] border-[var(--holo-accent)]/50 bg-[var(--holo-accent)]/10'
                        : 'text-[var(--holo-muted)] border-[var(--holo-border)] bg-[var(--holo-border)]/10'
                    }`}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}

interface SettingRowProps {
  label: string;
  description: string;
  control: ReactNode;
}

function SettingRow({ label, description, control }: SettingRowProps) {
  return (
    <div className="p-4 rounded-lg border border-[var(--holo-border)] bg-[rgba(20,20,30,0.25)] space-y-2">
      <div className="text-sm text-[var(--holo-text)]">{label}</div>
      <div className="text-xs text-[var(--holo-muted)]">{description}</div>
      <div>{control}</div>
    </div>
  );
}

interface SliderRowProps {
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onChange: (value: number) => void;
}

function SliderRow({
  label,
  description,
  min,
  max,
  step,
  value,
  unit,
  onChange,
}: SliderRowProps) {
  const isIntegerStep = Number.isInteger(step);
  const valueLabel = isIntegerStep ? String(Math.round(value)) : value.toFixed(2);

  return (
    <SettingRow
      label={label}
      description={description}
      control={
        <div className="space-y-2">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full h-2 bg-[var(--holo-border)] rounded-lg appearance-none cursor-pointer accent-[var(--holo-accent)]"
          />
          <div className="text-xs text-[var(--holo-muted)]">
            {valueLabel}{unit ? ` ${unit}` : ''}
          </div>
        </div>
      }
    />
  );
}

interface NumberInputProps {
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

function NumberInput({ value, min, max, step, unit, onChange }: NumberInputProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) {
            onChange(Math.max(min, Math.min(max, next)));
          }
        }}
        className="w-32 px-3 py-2 text-sm rounded bg-[rgba(15,15,25,0.8)] border border-[var(--holo-border)] focus:outline-none focus:border-[var(--holo-accent)]"
      />
      {unit && <span className="text-xs text-[var(--holo-muted)]">{unit}</span>}
    </div>
  );
}
