import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Plus, File, FolderPlus, LayoutDashboard, Bot, Plane } from 'lucide-react';
import { FILE_TEMPLATES } from '../../templates/fileTemplates';
import { ICON_SIZES, ICON_STROKE_WIDTH } from './iconConfig';

interface QuickCreateMenuProps {
  onCreateFile: (extension?: string) => void;
  onCreateFolder: () => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Map icon names to components
const ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  LayoutDashboard,
  Bot,
  Plane,
  File,
};

// Menu item definitions for keyboard navigation
interface MenuItem {
  id: string;
  action: () => void;
}

export function QuickCreateMenu({ onCreateFile, onCreateFolder, isOpen: controlledIsOpen, onOpenChange }: QuickCreateMenuProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Support both controlled and uncontrolled modes
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = useCallback((open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
    } else {
      setInternalIsOpen(open);
    }
    // Reset selection when opening
    if (open) {
      setSelectedIndex(0);
    }
  }, [onOpenChange]);

  // Build menu items array
  const menuItems: MenuItem[] = useMemo(() => [
    { id: 'new-file', action: () => onCreateFile() },
    { id: 'new-folder', action: () => onCreateFolder() },
    ...FILE_TEMPLATES.map(t => ({
      id: t.extension,
      action: () => onCreateFile(t.extension),
    })),
  ], [onCreateFile, onCreateFolder]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => (prev + 1) % menuItems.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => (prev - 1 + menuItems.length) % menuItems.length);
          break;
        case 'Enter':
          e.preventDefault();
          menuItems[selectedIndex].action();
          setIsOpen(false);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, menuItems, setIsOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [isOpen, setIsOpen]);

  const handleItemClick = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  // Calculate menu position, keeping it within window bounds
  const getMenuPosition = () => {
    if (!buttonRef.current) return { top: 0, left: 0 };
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 180; // min-w-[180px]
    const menuHeight = 200; // approximate height

    let top = rect.bottom + 4;
    let left = rect.left;

    // Keep menu within horizontal bounds
    if (left + menuWidth > window.innerWidth) {
      left = rect.right - menuWidth;
    }
    if (left < 0) {
      left = 4;
    }

    // Keep menu within vertical bounds
    if (top + menuHeight > window.innerHeight) {
      top = rect.top - menuHeight - 4;
    }
    if (top < 0) {
      top = 4;
    }

    return { top, left };
  };

  // Get class for menu item based on selection state
  const getItemClass = (index: number) => {
    const baseClass = "w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 text-[var(--holo-text)] transition-colors";
    return index === selectedIndex
      ? `${baseClass} bg-[var(--holo-accent)]/30`
      : `${baseClass} hover:bg-[var(--holo-accent)]/20`;
  };

  // Reads the (already-mounted) trigger button's rect to position the portal menu.
  // eslint-disable-next-line react-hooks/refs
  const menuPositionStyle = getMenuPosition();

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="p-1 rounded hover:bg-[var(--holo-accent)]/10 text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
        title="Create new file"
      >
        <Plus size={ICON_SIZES.fileTree} strokeWidth={ICON_STROKE_WIDTH} />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed bg-[rgba(15,15,25,0.95)] border border-[var(--holo-border)] rounded-lg py-1 min-w-[180px] z-[9999] shadow-xl backdrop-blur-sm"
            style={menuPositionStyle}
          >
            {/* Generic file option */}
            <button
              className={getItemClass(0)}
              onClick={() => handleItemClick(() => onCreateFile())}
              onMouseEnter={() => setSelectedIndex(0)}
            >
              <File size={ICON_SIZES.contextMenu} strokeWidth={ICON_STROKE_WIDTH} />
              <span>New File...</span>
            </button>

            {/* Folder option */}
            <button
              className={getItemClass(1)}
              onClick={() => handleItemClick(onCreateFolder)}
              onMouseEnter={() => setSelectedIndex(1)}
            >
              <FolderPlus size={ICON_SIZES.contextMenu} strokeWidth={ICON_STROKE_WIDTH} />
              <span>New Folder...</span>
            </button>

            {/* Divider */}
            <div className="my-1 border-t border-[var(--holo-border)]" />

            {/* Quick-create templates */}
            {FILE_TEMPLATES.map((template, index) => {
              const IconComponent = ICONS[template.icon] || File;
              const itemIndex = index + 2; // Offset by 2 for file and folder options
              return (
                <button
                  key={template.extension}
                  className={getItemClass(itemIndex)}
                  onClick={() => handleItemClick(() => onCreateFile(template.extension))}
                  onMouseEnter={() => setSelectedIndex(itemIndex)}
                >
                  <IconComponent size={ICON_SIZES.contextMenu} strokeWidth={ICON_STROKE_WIDTH} />
                  <span>{template.displayName}</span>
                  <span className="ml-auto text-xs text-[var(--holo-muted)]">.{template.extension}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
