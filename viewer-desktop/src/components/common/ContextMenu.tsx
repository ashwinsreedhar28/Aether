import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  // Adjust position after mount to keep menu in viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const menuWidth = rect.width || 160;
      const menuHeight = rect.height || items.length * 32;

      let adjustedX = x;
      let adjustedY = y;

      // Keep within viewport bounds
      if (x + menuWidth > window.innerWidth - 8) {
        adjustedX = window.innerWidth - menuWidth - 8;
      }
      if (y + menuHeight > window.innerHeight - 8) {
        adjustedY = window.innerHeight - menuHeight - 8;
      }

      // Ensure minimum position
      adjustedX = Math.max(8, adjustedX);
      adjustedY = Math.max(8, adjustedY);

      if (adjustedX !== x || adjustedY !== y) {
        // Must measure the rendered menu (getBoundingClientRect) before repositioning it.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPosition({ x: adjustedX, y: adjustedY });
      }
    }
  }, [x, y, items.length]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Use capture phase to catch clicks before they propagate
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const menu = (
    <div
      ref={menuRef}
      className="fixed holo-panel py-1 min-w-[160px] z-[9999] shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, index) => {
        if (item.divider) {
          return (
            <div
              key={index}
              className="my-1 border-t border-[var(--holo-border)]"
            />
          );
        }

        return (
          <button
            key={index}
            className={`
              w-full px-3 py-1.5 text-left text-sm flex items-center gap-2
              transition-colors duration-100
              ${item.disabled
                ? 'text-[var(--holo-muted)] cursor-not-allowed'
                : item.danger
                  ? 'text-rose-400 hover:bg-rose-500/20'
                  : 'text-[var(--holo-text)] hover:bg-[var(--holo-accent)]/20'
              }
            `}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
          >
            {item.icon && <span className="w-4 flex items-center justify-center flex-shrink-0">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );

  // Render into document.body to escape any overflow clipping
  return createPortal(menu, document.body);
}
