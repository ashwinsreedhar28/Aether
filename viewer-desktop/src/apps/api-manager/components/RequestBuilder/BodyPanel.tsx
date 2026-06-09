/**
 * BodyPanel Component
 * Request body editor with type selection
 */

import { useRef } from 'react';
import { Upload, X } from 'lucide-react';
import type { RequestBody, BodyType } from '../../types';
import { BODY_TYPES, generateId } from '../../constants';
import { KeyValueEditor } from '../shared/KeyValueEditor';

interface BodyPanelProps {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
}

export function BodyPanel({ body, onChange }: BodyPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTypeChange = (type: BodyType) => {
    const newBody: RequestBody = { type };

    // Preserve existing data if switching between compatible types
    switch (type) {
      case 'json':
        newBody.json = body.json || '{\n  \n}';
        break;
      case 'form-urlencoded':
        newBody.formUrlencoded = body.formUrlencoded || [];
        break;
      case 'form-data':
        newBody.formData = body.formData || [];
        break;
      case 'raw':
        newBody.raw = body.raw || '';
        newBody.rawContentType = body.rawContentType || 'text/plain';
        break;
      case 'binary':
        newBody.binary = body.binary;
        break;
    }

    onChange(newBody);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      onChange({
        ...body,
        binary: {
          fileName: file.name,
          content: base64,
        },
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFormDataFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    itemId: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      onChange({
        ...body,
        formData: (body.formData || []).map((item) =>
          item.id === itemId
            ? { ...item, type: 'file' as const, fileName: file.name, fileContent: base64 }
            : item
        ),
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      {/* Body type selector */}
      <div className="flex items-center gap-2 mb-4">
        {BODY_TYPES.map((bt) => (
          <button
            key={bt.value}
            onClick={() => handleTypeChange(bt.value)}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${
              body.type === bt.value
                ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] border border-[var(--holo-accent)]/50'
                : 'bg-[rgba(20,20,30,0.5)] text-[var(--holo-muted)] border border-[var(--holo-border)] hover:text-[var(--holo-text)]'
            }`}
          >
            {bt.label}
          </button>
        ))}
      </div>

      {/* Body content */}
      {body.type === 'none' && (
        <div className="text-center py-8 text-[var(--holo-muted)] text-sm">
          This request has no body
        </div>
      )}

      {body.type === 'json' && (
        <div>
          <textarea
            value={body.json || ''}
            onChange={(e) => onChange({ ...body, json: e.target.value })}
            placeholder="Enter JSON body"
            rows={12}
            className="w-full px-3 py-2 text-sm font-mono bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none resize-none"
          />
        </div>
      )}

      {body.type === 'form-urlencoded' && (
        <KeyValueEditor
          pairs={body.formUrlencoded || []}
          onChange={(formUrlencoded) => onChange({ ...body, formUrlencoded })}
          keyPlaceholder="Key"
          valuePlaceholder="Value"
        />
      )}

      {body.type === 'form-data' && (
        <div className="space-y-2">
          {(body.formData || []).map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 p-2 rounded bg-[rgba(20,20,30,0.5)]"
            >
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={(e) =>
                  onChange({
                    ...body,
                    formData: (body.formData || []).map((i) =>
                      i.id === item.id ? { ...i, enabled: e.target.checked } : i
                    ),
                  })
                }
                className="w-4 h-4"
              />
              <input
                type="text"
                value={item.key}
                onChange={(e) =>
                  onChange({
                    ...body,
                    formData: (body.formData || []).map((i) =>
                      i.id === item.id ? { ...i, key: e.target.value } : i
                    ),
                  })
                }
                placeholder="Key"
                className="flex-1 px-2 py-1 text-sm bg-transparent border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
              />
              <select
                value={item.type}
                onChange={(e) =>
                  onChange({
                    ...body,
                    formData: (body.formData || []).map((i) =>
                      i.id === item.id
                        ? { ...i, type: e.target.value as 'text' | 'file' }
                        : i
                    ),
                  })
                }
                className="px-2 py-1 text-sm bg-transparent border border-[var(--holo-border)] rounded"
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
              {item.type === 'text' ? (
                <input
                  type="text"
                  value={item.value}
                  onChange={(e) =>
                    onChange({
                      ...body,
                      formData: (body.formData || []).map((i) =>
                        i.id === item.id ? { ...i, value: e.target.value } : i
                      ),
                    })
                  }
                  placeholder="Value"
                  className="flex-1 px-2 py-1 text-sm bg-transparent border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
                />
              ) : (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="file"
                    onChange={(e) => handleFormDataFileSelect(e, item.id)}
                    className="hidden"
                    id={`file-${item.id}`}
                  />
                  <label
                    htmlFor={`file-${item.id}`}
                    className="px-2 py-1 text-xs rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] cursor-pointer hover:bg-[var(--holo-accent)]/30"
                  >
                    {item.fileName || 'Select file'}
                  </label>
                </div>
              )}
              <button
                onClick={() =>
                  onChange({
                    ...body,
                    formData: (body.formData || []).filter((i) => i.id !== item.id),
                  })
                }
                className="p-1 rounded hover:bg-red-500/20 text-[var(--holo-muted)] hover:text-red-400"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              onChange({
                ...body,
                formData: [
                  ...(body.formData || []),
                  {
                    id: generateId(),
                    key: '',
                    value: '',
                    enabled: true,
                    type: 'text',
                  },
                ],
              })
            }
            className="px-3 py-1.5 text-sm text-[var(--holo-muted)] hover:text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/10 rounded transition-colors"
          >
            + Add field
          </button>
        </div>
      )}

      {body.type === 'raw' && (
        <div className="space-y-2">
          <select
            value={body.rawContentType || 'text/plain'}
            onChange={(e) => onChange({ ...body, rawContentType: e.target.value })}
            className="px-3 py-1.5 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
          >
            <option value="text/plain">Text</option>
            <option value="application/json">JSON</option>
            <option value="text/html">HTML</option>
            <option value="text/xml">XML</option>
            <option value="application/javascript">JavaScript</option>
          </select>
          <textarea
            value={body.raw || ''}
            onChange={(e) => onChange({ ...body, raw: e.target.value })}
            placeholder="Enter raw body"
            rows={12}
            className="w-full px-3 py-2 text-sm font-mono bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none resize-none"
          />
        </div>
      )}

      {body.type === 'binary' && (
        <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-[var(--holo-border)] rounded-lg">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
          />
          {body.binary?.fileName ? (
            <div className="text-center">
              <p className="text-sm mb-2">{body.binary.fileName}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30"
                >
                  Change file
                </button>
                <button
                  onClick={() => onChange({ ...body, binary: undefined })}
                  className="px-3 py-1.5 text-xs rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <>
              <Upload size={32} className="text-[var(--holo-muted)] mb-2" />
              <p className="text-sm text-[var(--holo-muted)] mb-2">
                Select a file to upload
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 text-sm rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30"
              >
                Select file
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
