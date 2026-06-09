/**
 * JsonViewer Component
 *
 * Displays JSON data with collapsible sections and syntax highlighting.
 */

import { useState, useCallback, memo } from 'react';
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react';

interface JsonViewerProps {
  data: unknown;
  collapsed?: boolean;
  level?: number;
  label?: string;
}

interface JsonNodeProps {
  data: unknown;
  level: number;
  collapsed: boolean;
}

const JsonNode = memo(function JsonNode({ data, level, collapsed: initialCollapsed }: JsonNodeProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed && level > 0);

  const indent = level * 16;

  // Handle primitives
  if (data === null) {
    return <span className="text-gray-500">null</span>;
  }

  if (data === undefined) {
    return <span className="text-gray-500">undefined</span>;
  }

  if (typeof data === 'boolean') {
    return <span className="text-purple-400">{data.toString()}</span>;
  }

  if (typeof data === 'number') {
    return <span className="text-cyan-400">{data}</span>;
  }

  if (typeof data === 'string') {
    // Truncate long strings
    const displayStr = data.length > 200 ? data.slice(0, 200) + '...' : data;
    return <span className="text-green-400">"{displayStr}"</span>;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-gray-400">[]</span>;
    }

    return (
      <div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="inline-flex items-center text-gray-400 hover:text-gray-200"
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          <span className="ml-0.5">[</span>
          {collapsed && <span className="text-gray-500 text-xs ml-1">{data.length} items</span>}
        </button>
        {!collapsed && (
          <>
            {data.map((item, i) => (
              <div key={i} style={{ marginLeft: indent + 16 }} className="py-0.5">
                <span className="text-gray-500">{i}: </span>
                <JsonNode data={item} level={level + 1} collapsed={level >= 2} />
                {i < data.length - 1 && <span className="text-gray-500">,</span>}
              </div>
            ))}
            <div style={{ marginLeft: indent }}>]</div>
          </>
        )}
        {collapsed && <span>]</span>}
      </div>
    );
  }

  // Handle objects
  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) {
      return <span className="text-gray-400">{'{}'}</span>;
    }

    return (
      <div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="inline-flex items-center text-gray-400 hover:text-gray-200"
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          <span className="ml-0.5">{'{'}</span>
          {collapsed && <span className="text-gray-500 text-xs ml-1">{entries.length} keys</span>}
        </button>
        {!collapsed && (
          <>
            {entries.map(([key, value], i) => (
              <div key={key} style={{ marginLeft: indent + 16 }} className="py-0.5">
                <span className="text-blue-400">"{key}"</span>
                <span className="text-gray-400">: </span>
                <JsonNode data={value} level={level + 1} collapsed={level >= 2} />
                {i < entries.length - 1 && <span className="text-gray-500">,</span>}
              </div>
            ))}
            <div style={{ marginLeft: indent }}>{'}'}</div>
          </>
        )}
        {collapsed && <span>{'}'}</span>}
      </div>
    );
  }

  return <span className="text-gray-400">{String(data)}</span>;
});

export function JsonViewer({ data, collapsed = false, level = 0, label }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);

  return (
    <div className="relative group">
      {label && (
        <div className="text-xs text-gray-500 mb-1">{label}</div>
      )}
      <div className="font-mono text-xs bg-[rgba(0,0,0,0.3)] rounded p-2 overflow-auto max-h-[400px]">
        <JsonNode data={data} level={level} collapsed={collapsed} />
      </div>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1 rounded bg-[rgba(0,0,0,0.5)] opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-white"
        title="Copy JSON"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-green-400" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}
