/**
 * ParamsPanel Component
 * Query parameters editor
 */

import type { KeyValuePair } from '../../types';
import { KeyValueEditor } from '../shared/KeyValueEditor';

interface ParamsPanelProps {
  params: KeyValuePair[];
  onChange: (params: KeyValuePair[]) => void;
}

export function ParamsPanel({ params, onChange }: ParamsPanelProps) {
  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-medium mb-1">Query Parameters</h3>
        <p className="text-xs text-[var(--holo-muted)]">
          Parameters will be appended to the URL as ?key=value
        </p>
      </div>
      <KeyValueEditor
        pairs={params}
        onChange={onChange}
        keyPlaceholder="Key"
        valuePlaceholder="Value"
        showDescription
      />
    </div>
  );
}
