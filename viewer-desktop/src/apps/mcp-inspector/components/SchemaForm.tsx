/**
 * SchemaForm Component
 *
 * Dynamically generates a form from JSON Schema for tool inputs.
 */

import { useState, useCallback, useEffect, memo } from 'react';

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

interface SchemaFormProps {
  schema?: JsonSchema;
  onSubmit: (values: Record<string, unknown>) => void;
  submitLabel?: string;
  loading?: boolean;
}

interface FieldProps {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
  required?: boolean;
}

const Field = memo(function Field({ name, schema, value, onChange, required }: FieldProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      let newValue: unknown = e.target.value;

      // Type coercion based on schema
      if (schema.type === 'number' || schema.type === 'integer') {
        newValue = e.target.value === '' ? undefined : Number(e.target.value);
      } else if (schema.type === 'boolean') {
        newValue = (e.target as HTMLInputElement).checked;
      }

      onChange(name, newValue);
    },
    [name, schema.type, onChange]
  );

  const handleJsonChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      try {
        const parsed = JSON.parse(e.target.value);
        onChange(name, parsed);
      } catch {
        // Keep raw string if not valid JSON
        onChange(name, e.target.value);
      }
    },
    [name, onChange]
  );

  const label = (
    <label className="block text-xs text-gray-400 mb-1">
      {name}
      {required && <span className="text-red-400 ml-0.5">*</span>}
      {schema.description && (
        <span className="text-gray-500 ml-2">{schema.description}</span>
      )}
    </label>
  );

  const inputClass =
    'w-full px-2 py-1.5 bg-[rgba(0,0,0,0.3)] border border-[var(--holo-accent)]/20 rounded text-sm text-[var(--holo-text)] focus:outline-none focus:border-[var(--holo-accent)]/50';

  // Enum field - render as select
  if (schema.enum && schema.enum.length > 0) {
    return (
      <div className="mb-3">
        {label}
        <select
          value={String(value ?? '')}
          onChange={handleChange}
          className={inputClass}
        >
          <option value="">-- Select --</option>
          {schema.enum.map((option, i) => (
            <option key={i} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Boolean field
  if (schema.type === 'boolean') {
    return (
      <div className="mb-3 flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={handleChange}
          className="w-4 h-4 rounded bg-[rgba(0,0,0,0.3)] border border-[var(--holo-accent)]/20"
        />
        <label className="text-xs text-gray-400">
          {name}
          {required && <span className="text-red-400 ml-0.5">*</span>}
          {schema.description && (
            <span className="text-gray-500 ml-2">{schema.description}</span>
          )}
        </label>
      </div>
    );
  }

  // Number field
  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <div className="mb-3">
        {label}
        <input
          type="number"
          value={value === undefined ? '' : String(value)}
          onChange={handleChange}
          step={schema.type === 'integer' ? 1 : 'any'}
          className={inputClass}
          placeholder={schema.default !== undefined ? `Default: ${schema.default}` : undefined}
        />
      </div>
    );
  }

  // Array or object - render as JSON textarea
  if (schema.type === 'array' || schema.type === 'object') {
    const jsonValue = value === undefined || value === '' ? '' : JSON.stringify(value, null, 2);
    return (
      <div className="mb-3">
        {label}
        <textarea
          value={typeof value === 'string' ? value : jsonValue}
          onChange={handleJsonChange}
          className={`${inputClass} font-mono text-xs`}
          rows={4}
          placeholder={`Enter ${schema.type} as JSON`}
        />
      </div>
    );
  }

  // Default: string field
  return (
    <div className="mb-3">
      {label}
      <input
        type="text"
        value={String(value ?? '')}
        onChange={handleChange}
        className={inputClass}
        placeholder={schema.default !== undefined ? `Default: ${schema.default}` : undefined}
      />
    </div>
  );
});

export function SchemaForm({ schema, onSubmit, submitLabel = 'Submit', loading }: SchemaFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});

  // Reset form when schema changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues({});
  }, [schema]);

  const handleFieldChange = useCallback((name: string, value: unknown) => {
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Filter out empty values
      const cleanValues: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(values)) {
        if (val !== undefined && val !== '') {
          cleanValues[key] = val;
        }
      }

      onSubmit(cleanValues);
    },
    [values, onSubmit]
  );

  // No schema - just show submit button
  if (!schema || !schema.properties || Object.keys(schema.properties).length === 0) {
    return (
      <form onSubmit={handleSubmit}>
        <p className="text-xs text-gray-500 mb-3">No parameters required</p>
        <button
          type="submit"
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] rounded hover:bg-[var(--holo-accent)]/30 transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : submitLabel}
        </button>
      </form>
    );
  }

  const properties = schema.properties;
  const required = schema.required || [];

  return (
    <form onSubmit={handleSubmit}>
      {Object.entries(properties).map(([name, fieldSchema]) => (
        <Field
          key={name}
          name={name}
          schema={fieldSchema}
          value={values[name]}
          onChange={handleFieldChange}
          required={required.includes(name)}
        />
      ))}
      <button
        type="submit"
        disabled={loading}
        className="px-3 py-1.5 text-sm bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] rounded hover:bg-[var(--holo-accent)]/30 transition-colors disabled:opacity-50"
      >
        {loading ? 'Loading...' : submitLabel}
      </button>
    </form>
  );
}
