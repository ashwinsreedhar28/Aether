import type {
  HttpMethod,
  AuthType,
  BodyType,
  ApiWorkspace,
  ApiRequest,
  ApiFolder,
  Environment,
  WebSocketConfig,
  KeyValuePair,
  RequestBody,
} from './types';

export const HTTP_METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
];

export const HTTP_METHOD_COLORS: Record<HttpMethod, string> = {
  GET: '#61affe',
  POST: '#49cc90',
  PUT: '#fca130',
  DELETE: '#f93e3e',
  PATCH: '#50e3c2',
  HEAD: '#9012fe',
  OPTIONS: '#0d5aa7',
};

export const AUTH_TYPES: { value: AuthType; label: string }[] = [
  { value: 'none', label: 'No Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'apikey', label: 'API Key' },
  { value: 'oauth2', label: 'OAuth 2.0' },
];

export const BODY_TYPES: { value: BodyType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'form-urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'form-data', label: 'form-data' },
  { value: 'raw', label: 'Raw' },
  { value: 'binary', label: 'Binary' },
];

export const COMMON_CONTENT_TYPES = [
  'application/json',
  'text/plain',
  'text/html',
  'text/xml',
  'application/xml',
  'application/javascript',
];

export function generateId(): string {
  return crypto.randomUUID();
}

export function createEmptyWorkspace(name: string): ApiWorkspace {
  const now = new Date().toISOString();
  return {
    name,
    version: '1.0',
    folders: [],
    requests: [],
    websockets: [],
    environments: [
      {
        id: generateId(),
        name: 'Default',
        variables: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyRequest(name = 'New Request'): ApiRequest {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    method: 'GET',
    url: '',
    headers: [],
    queryParams: [],
    auth: { type: 'none' },
    body: { type: 'none' },
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyFolder(name = 'New Folder'): ApiFolder {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    items: [],
    isExpanded: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyEnvironment(name = 'New Environment'): Environment {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    variables: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyWebSocket(name = 'New WebSocket'): WebSocketConfig {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    url: '',
    headers: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createKeyValuePair(key = '', value = ''): KeyValuePair {
  return {
    id: generateId(),
    key,
    value,
    enabled: true,
  };
}

export function createEmptyBody(): RequestBody {
  return { type: 'none' };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
