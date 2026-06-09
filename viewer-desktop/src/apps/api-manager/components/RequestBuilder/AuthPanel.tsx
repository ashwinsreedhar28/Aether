/**
 * AuthPanel Component
 * Authentication configuration
 */

import { useState } from 'react';
import { Eye, EyeOff, Key } from 'lucide-react';
import type { AuthConfig, AuthType, OAuth2Auth } from '../../types';
import { AUTH_TYPES } from '../../constants';

interface AuthPanelProps {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
}

export function AuthPanel({ auth, onChange }: AuthPanelProps) {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const toggleSecret = (field: string) => {
    setShowSecrets((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleTypeChange = (type: AuthType) => {
    switch (type) {
      case 'none':
        onChange({ type: 'none' });
        break;
      case 'bearer':
        onChange({ type: 'bearer', token: '' });
        break;
      case 'basic':
        onChange({ type: 'basic', username: '', password: '' });
        break;
      case 'apikey':
        onChange({ type: 'apikey', key: '', value: '', addTo: 'header' });
        break;
      case 'oauth2':
        onChange({
          type: 'oauth2',
          grantType: 'client_credentials',
          tokenUrl: '',
          clientId: '',
          clientSecret: '',
        });
        break;
    }
  };

  return (
    <div className="space-y-4">
      {/* Auth type selector */}
      <div>
        <label className="block text-sm font-medium mb-2">Type</label>
        <div className="flex flex-wrap gap-2">
          {AUTH_TYPES.map((at) => (
            <button
              key={at.value}
              onClick={() => handleTypeChange(at.value)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                auth.type === at.value
                  ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] border border-[var(--holo-accent)]/50'
                  : 'bg-[rgba(20,20,30,0.5)] text-[var(--holo-muted)] border border-[var(--holo-border)] hover:text-[var(--holo-text)]'
              }`}
            >
              {at.label}
            </button>
          ))}
        </div>
      </div>

      {/* Auth configuration */}
      {auth.type === 'none' && (
        <div className="text-center py-8 text-[var(--holo-muted)] text-sm">
          <Key size={32} className="mx-auto mb-2 opacity-50" />
          <p>No authentication</p>
        </div>
      )}

      {auth.type === 'bearer' && (
        <div>
          <label className="block text-sm font-medium mb-2">Token</label>
          <div className="relative">
            <input
              type={showSecrets['token'] ? 'text' : 'password'}
              value={auth.token}
              onChange={(e) => onChange({ ...auth, token: e.target.value })}
              placeholder="Enter bearer token"
              className="w-full px-3 py-2 pr-10 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => toggleSecret('token')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
            >
              {showSecrets['token'] ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--holo-muted)]">
            The token will be sent as: Authorization: Bearer {'<token>'}
          </p>
        </div>
      )}

      {auth.type === 'basic' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-2">Username</label>
            <input
              type="text"
              value={auth.username}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
              placeholder="Enter username"
              className="w-full px-3 py-2 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Password</label>
            <div className="relative">
              <input
                type={showSecrets['password'] ? 'text' : 'password'}
                value={auth.password}
                onChange={(e) => onChange({ ...auth, password: e.target.value })}
                placeholder="Enter password"
                className="w-full px-3 py-2 pr-10 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => toggleSecret('password')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
              >
                {showSecrets['password'] ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {auth.type === 'apikey' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-2">Key</label>
            <input
              type="text"
              value={auth.key}
              onChange={(e) => onChange({ ...auth, key: e.target.value })}
              placeholder="e.g., X-API-Key"
              className="w-full px-3 py-2 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Value</label>
            <div className="relative">
              <input
                type={showSecrets['apikey'] ? 'text' : 'password'}
                value={auth.value}
                onChange={(e) => onChange({ ...auth, value: e.target.value })}
                placeholder="Enter API key value"
                className="w-full px-3 py-2 pr-10 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => toggleSecret('apikey')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
              >
                {showSecrets['apikey'] ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Add to</label>
            <div className="flex gap-2">
              <button
                onClick={() => onChange({ ...auth, addTo: 'header' })}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  auth.addTo === 'header'
                    ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] border border-[var(--holo-accent)]/50'
                    : 'bg-[rgba(20,20,30,0.5)] text-[var(--holo-muted)] border border-[var(--holo-border)]'
                }`}
              >
                Header
              </button>
              <button
                onClick={() => onChange({ ...auth, addTo: 'query' })}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  auth.addTo === 'query'
                    ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] border border-[var(--holo-accent)]/50'
                    : 'bg-[rgba(20,20,30,0.5)] text-[var(--holo-muted)] border border-[var(--holo-border)]'
                }`}
              >
                Query Param
              </button>
            </div>
          </div>
        </div>
      )}

      {auth.type === 'oauth2' && (
        <OAuth2Config
          auth={auth}
          onChange={onChange}
          showSecrets={showSecrets}
          toggleSecret={toggleSecret}
        />
      )}
    </div>
  );
}

function OAuth2Config({
  auth,
  onChange,
  showSecrets,
  toggleSecret,
}: {
  auth: OAuth2Auth;
  onChange: (auth: AuthConfig) => void;
  showSecrets: Record<string, boolean>;
  toggleSecret: (field: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-2">Grant Type</label>
        <select
          value={auth.grantType}
          onChange={(e) =>
            onChange({
              ...auth,
              grantType: e.target.value as OAuth2Auth['grantType'],
            })
          }
          className="w-full px-3 py-2 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
        >
          <option value="client_credentials">Client Credentials</option>
          <option value="authorization_code">Authorization Code</option>
          <option value="password">Password</option>
        </select>
      </div>

      {auth.grantType === 'authorization_code' && (
        <div>
          <label className="block text-sm font-medium mb-2">Auth URL</label>
          <input
            type="text"
            value={auth.authUrl || ''}
            onChange={(e) => onChange({ ...auth, authUrl: e.target.value })}
            placeholder="https://example.com/oauth/authorize"
            className="w-full px-3 py-2 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-2">Token URL</label>
        <input
          type="text"
          value={auth.tokenUrl}
          onChange={(e) => onChange({ ...auth, tokenUrl: e.target.value })}
          placeholder="https://example.com/oauth/token"
          className="w-full px-3 py-2 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Client ID</label>
        <input
          type="text"
          value={auth.clientId}
          onChange={(e) => onChange({ ...auth, clientId: e.target.value })}
          placeholder="Enter client ID"
          className="w-full px-3 py-2 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Client Secret</label>
        <div className="relative">
          <input
            type={showSecrets['clientSecret'] ? 'text' : 'password'}
            value={auth.clientSecret}
            onChange={(e) => onChange({ ...auth, clientSecret: e.target.value })}
            placeholder="Enter client secret"
            className="w-full px-3 py-2 pr-10 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => toggleSecret('clientSecret')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
          >
            {showSecrets['clientSecret'] ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Scope (optional)</label>
        <input
          type="text"
          value={auth.scope || ''}
          onChange={(e) => onChange({ ...auth, scope: e.target.value })}
          placeholder="e.g., read write"
          className="w-full px-3 py-2 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
        />
      </div>

      {/* Token status */}
      {auth.accessToken && (
        <div className="p-3 rounded bg-green-500/10 border border-green-500/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-green-400">Token acquired</span>
            {auth.expiresAt && (
              <span className="text-xs text-[var(--holo-muted)]">
                Expires: {new Date(auth.expiresAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--holo-muted)] font-mono truncate">
            {auth.accessToken.slice(0, 20)}...
          </div>
        </div>
      )}

      <button
        onClick={() => {
          // Token fetch would happen here
          // For now, this is a placeholder
          alert('Token fetch not implemented in this demo');
        }}
        className="w-full py-2 text-sm font-medium rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 transition-colors"
      >
        Get New Access Token
      </button>
    </div>
  );
}
