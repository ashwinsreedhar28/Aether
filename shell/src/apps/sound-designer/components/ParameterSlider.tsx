import { useCallback } from 'react';

interface ParameterSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  logarithmic?: boolean;
  onChange: (value: number) => void;
}

export function ParameterSlider({
  label,
  value,
  min,
  max,
  step = 0.001,
  unit = '',
  logarithmic = false,
  onChange,
}: ParameterSliderProps) {
  const displayValue = logarithmic
    ? Math.round(value)
    : value < 1
    ? value.toFixed(4)
    : value.toFixed(2);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = parseFloat(e.target.value);
      onChange(logarithmic ? Math.exp(raw) : raw);
    },
    [onChange, logarithmic]
  );

  const sliderValue = logarithmic ? Math.log(Math.max(value, 0.001)) : value;
  const sliderMin = logarithmic ? Math.log(Math.max(min, 0.001)) : min;
  const sliderMax = logarithmic ? Math.log(max) : max;

  return (
    <div className="flex items-center gap-3 py-1.5">
      <label className="w-24 text-xs text-[var(--holo-muted)] shrink-0">{label}</label>
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={step}
        value={sliderValue}
        onChange={handleChange}
        className="flex-1 h-1 accent-[var(--holo-accent)] bg-[var(--holo-border)] rounded-full appearance-none cursor-pointer"
      />
      <span className="w-20 text-xs text-right text-[var(--holo-muted)] shrink-0">
        {displayValue} {unit}
      </span>
    </div>
  );
}
