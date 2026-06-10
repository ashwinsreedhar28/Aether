import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  Palette,
  Globe,
  Image,
  FileType,
  File,
  Layout,
  Plane,
  Users
} from 'lucide-react';
import { FILE_TYPE_COLORS, ICON_SIZES, ICON_STROKE_WIDTH } from './iconConfig';

interface FileIconProps {
  type: 'file' | 'directory';
  extension?: string;
  isExpanded?: boolean;
}

interface IconConfig {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
}

export function FileIcon({ type, extension, isExpanded }: FileIconProps) {
  if (type === 'directory') {
    const Icon = isExpanded ? FolderOpen : Folder;
    return (
      <Icon
        size={ICON_SIZES.fileTree}
        strokeWidth={ICON_STROKE_WIDTH}
        className="text-[var(--holo-accent)]"
      />
    );
  }

  // File type icons with colors
  const iconMap: Record<string, IconConfig> = {
    md: { Icon: FileText, color: FILE_TYPE_COLORS.md },
    json: { Icon: FileCode, color: FILE_TYPE_COLORS.json },
    js: { Icon: FileCode, color: FILE_TYPE_COLORS.js },
    ts: { Icon: FileCode, color: FILE_TYPE_COLORS.ts },
    tsx: { Icon: FileCode, color: FILE_TYPE_COLORS.tsx },
    jsx: { Icon: FileCode, color: FILE_TYPE_COLORS.jsx },
    css: { Icon: Palette, color: FILE_TYPE_COLORS.css },
    html: { Icon: Globe, color: FILE_TYPE_COLORS.html },
    png: { Icon: Image, color: FILE_TYPE_COLORS.image },
    jpg: { Icon: Image, color: FILE_TYPE_COLORS.image },
    jpeg: { Icon: Image, color: FILE_TYPE_COLORS.image },
    gif: { Icon: Image, color: FILE_TYPE_COLORS.image },
    svg: { Icon: Image, color: FILE_TYPE_COLORS.image },
    pdf: { Icon: FileType, color: FILE_TYPE_COLORS.pdf },
    txt: { Icon: File, color: FILE_TYPE_COLORS.txt },
    kanban: { Icon: Layout, color: FILE_TYPE_COLORS.kanban },
    airplane: { Icon: Plane, color: FILE_TYPE_COLORS.airplane },
    agents: { Icon: Users, color: FILE_TYPE_COLORS.agents },
  };

  const config = extension ? iconMap[extension] : null;
  const { Icon, color } = config || { Icon: File, color: FILE_TYPE_COLORS.default };

  return (
    <Icon
      size={ICON_SIZES.fileTree}
      strokeWidth={ICON_STROKE_WIDTH}
      className={color}
    />
  );
}
