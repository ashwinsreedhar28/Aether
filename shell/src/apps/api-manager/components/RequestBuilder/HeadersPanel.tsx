/**
 * HeadersPanel Component
 * Headers key-value editor
 */

import type { KeyValuePair } from '../../types';
import { KeyValueEditor } from '../shared/KeyValueEditor';

interface HeadersPanelProps {
  headers: KeyValuePair[];
  onChange: (headers: KeyValuePair[]) => void;
}

export function HeadersPanel({ headers, onChange }: HeadersPanelProps) {
  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-medium mb-1">Headers</h3>
        <p className="text-xs text-[var(--holo-muted)]">
          Add custom headers to send with the request
        </p>
      </div>
      <KeyValueEditor
        pairs={headers}
        onChange={onChange}
        keyPlaceholder="Header"
        valuePlaceholder="Value"
      />
    </div>
  );
}
