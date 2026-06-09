import { createHmac } from 'node:crypto'

// Canonical JSON for HMAC signing. Mirrors the Python SDK's:
//
//   json.dumps(obj, sort_keys=True, separators=(",", ":"))
//
// Python defaults to ensure_ascii=True, which escapes any code point above
// 0x7E as \uXXXX. JS's JSON.stringify emits non-ASCII as UTF-8, so we
// hand-roll the encoder here to keep signatures byte-identical to Python's.
//
// Vendored verbatim from @aether/mesh-node-sdk (core/node_sdk_ts/src/canonical.ts).

function escapeString(s: string): string {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    if (ch === 0x22) out += '\\"'
    else if (ch === 0x5c) out += '\\\\'
    else if (ch === 0x08) out += '\\b'
    else if (ch === 0x09) out += '\\t'
    else if (ch === 0x0a) out += '\\n'
    else if (ch === 0x0c) out += '\\f'
    else if (ch === 0x0d) out += '\\r'
    else if (ch < 0x20 || ch > 0x7e) out += '\\u' + ch.toString(16).padStart(4, '0')
    else out += s[i]
  }
  return out + '"'
}

function canonicalValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'null'
    return Number.isInteger(v) ? v.toFixed(0) : String(v)
  }
  if (typeof v === 'string') return escapeString(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalValue).join(',') + ']'
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return '{' + keys.map((k) => escapeString(k) + ':' + canonicalValue(obj[k])).join(',') + '}'
  }
  return 'null'
}

export function canonical(envelope: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {}
  for (const k of Object.keys(envelope)) {
    if (k !== 'signature') filtered[k] = envelope[k]
  }
  return canonicalValue(filtered)
}

export function sign(envelope: Record<string, unknown>, secret: string): string {
  return createHmac('sha256', secret).update(canonical(envelope)).digest('hex')
}
