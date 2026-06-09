import { useCallback, useRef, useEffect, useState } from 'react';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface UseResizeOptions {
  onResize: (delta: { width: number; height: number; x: number; y: number }) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  minWidth?: number;
  minHeight?: number;
}

export function useResize({
  onResize,
  onResizeStart,
  onResizeEnd,
}: UseResizeOptions) {
  const [isResizing, setIsResizing] = useState(false);
  const direction = useRef<ResizeDirection | null>(null);
  const startPos = useRef({ x: 0, y: 0 });

  const handleResizeStart = useCallback(
    (dir: ResizeDirection) => (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      direction.current = dir;
      startPos.current = { x: e.clientX, y: e.clientY };
      setIsResizing(true);
      onResizeStart?.();

      e.preventDefault();
      e.stopPropagation();
    },
    [onResizeStart]
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!direction.current) return;

      const deltaX = e.clientX - startPos.current.x;
      const deltaY = e.clientY - startPos.current.y;
      startPos.current = { x: e.clientX, y: e.clientY };

      let widthDelta = 0;
      let heightDelta = 0;
      let xDelta = 0;
      let yDelta = 0;

      const dir = direction.current;

      // East/West resizing
      if (dir.includes('e')) {
        widthDelta = deltaX;
      } else if (dir.includes('w')) {
        widthDelta = -deltaX;
        xDelta = deltaX;
      }

      // North/South resizing
      if (dir.includes('s')) {
        heightDelta = deltaY;
      } else if (dir.includes('n')) {
        heightDelta = -deltaY;
        yDelta = deltaY;
      }

      onResize({ width: widthDelta, height: heightDelta, x: xDelta, y: yDelta });
    };

    const handleMouseUp = () => {
      direction.current = null;
      setIsResizing(false);
      onResizeEnd?.();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, onResize, onResizeEnd]);

  return { handleResizeStart, isResizing };
}
