import { useRef, useEffect, useCallback, useState } from 'react';
import { getAnalyser, getAudioContext } from '../../../audio';

type VisualizationType = 'waveform' | 'frequency' | 'both';

interface WaveformVisualizerProps {
  width?: number;
  height?: number;
  type?: VisualizationType;
  color?: string;
  backgroundColor?: string;
  lineWidth?: number;
}

export function WaveformVisualizer({
  width = 400,
  height = 120,
  type = 'both',
  backgroundColor = 'rgba(0,0,0,0.3)',
  lineWidth = 2,
}: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const [isActive, setIsActive] = useState(false);

  // `draw` self-schedules via requestAnimationFrame (recursive animation loop).
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let analyser: AnalyserNode;
    try {
      analyser = getAnalyser();
    } catch {
      // Audio context not initialized yet
      // eslint-disable-next-line react-hooks/immutability
      animationRef.current = requestAnimationFrame(draw);
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const waveformData = new Uint8Array(bufferLength);
    const frequencyData = new Uint8Array(bufferLength);

    analyser.getByteTimeDomainData(waveformData);
    analyser.getByteFrequencyData(frequencyData);

    // Check if there's any audio activity
    const hasActivity = waveformData.some((v) => Math.abs(v - 128) > 2);
    setIsActive(hasActivity);

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--holo-accent')
      .trim() || '#00ffff';

    if (type === 'both') {
      // Draw frequency bars in background
      const barCount = 64;
      const barWidth = canvas.width / barCount;
      const step = Math.floor(bufferLength / barCount);

      ctx.fillStyle = `${accentColor}20`;
      for (let i = 0; i < barCount; i++) {
        const value = frequencyData[i * step];
        const barHeight = (value / 255) * canvas.height;
        ctx.fillRect(
          i * barWidth,
          canvas.height - barHeight,
          barWidth - 1,
          barHeight
        );
      }

      // Draw waveform on top
      ctx.beginPath();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = accentColor;

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = waveformData[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx.stroke();
    } else if (type === 'waveform') {
      // Draw waveform only
      ctx.beginPath();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = accentColor;

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = waveformData[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx.stroke();
    } else if (type === 'frequency') {
      // Draw frequency spectrum
      const barCount = 128;
      const barWidth = canvas.width / barCount;
      const step = Math.floor(bufferLength / barCount);

      for (let i = 0; i < barCount; i++) {
        const value = frequencyData[i * step];
        const percent = value / 255;
        const barHeight = percent * canvas.height;

        // Gradient from accent to dimmer
        const hue = 180 + percent * 60; // Cyan to blue range
        ctx.fillStyle = `hsla(${hue}, 100%, ${50 + percent * 20}%, ${0.6 + percent * 0.4})`;

        ctx.fillRect(
          i * barWidth,
          canvas.height - barHeight,
          barWidth - 1,
          barHeight
        );
      }
    }

    // Draw center line for waveform
    if (type === 'waveform' || type === 'both') {
      ctx.beginPath();
      ctx.strokeStyle = `${accentColor}30`;
      ctx.lineWidth = 1;
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    }

    animationRef.current = requestAnimationFrame(draw);
  }, [type, backgroundColor, lineWidth]);

  useEffect(() => {
    // Initialize audio context on first render
    try {
      getAudioContext();
    } catch {
      // Will be initialized when user interacts
    }

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [draw]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded border border-[var(--holo-border)]"
        style={{ width: '100%', height }}
      />
      {isActive && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[var(--holo-accent)] animate-pulse" />
      )}
    </div>
  );
}
