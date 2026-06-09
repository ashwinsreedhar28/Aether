/**
 * API Manager Types
 */

// ============ HTTP Methods ============
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

// ============ Key-Value Pairs ============
export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export interface FormDataItem extends KeyValuePair {
  type: 'text' | 'file';
  fileName?: string;
  fileContent?: string; // Base64 encoded
}

// ============ Authentication ============
export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey' | 'oauth2';

export interface NoAuth {
  type: 'none';
}

export interface BearerAuth {
  type: 'bearer';
  token: string;
}

export interface BasicAuth {
  type: 'basic';
  username: string;
  password: string;
}

export interface ApiKeyAuth {
  type: 'apikey';
  key: string;
  value: string;
  addTo: 'header' | 'query';
}

export interface OAuth2Auth {
  type: 'oauth2';
  grantType: 'authorization_code' | 'client_credentials' | 'password';
  accessToken?: string;
  refreshToken?: string;
  tokenUrl: string;
  authUrl?: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  expiresAt?: string;
}

export type AuthConfig = NoAuth | BearerAuth | BasicAuth | ApiKeyAuth | OAuth2Auth;

// ============ Request Body ============
export type BodyType = 'none' | 'json' | 'form-urlencoded' | 'form-data' | 'raw' | 'binary';

export interface RequestBody {
  type: BodyType;
  json?: string;
  formUrlencoded?: KeyValuePair[];
  formData?: FormDataItem[];
  raw?: string;
  rawContentType?: string;
  binary?: {
    fileName: string;
    content: string; // Base64 encoded
  };
}

// ============ API Request ============
export interface ApiRequest {
  id: string;
  name: string;
  description?: string;
  method: HttpMethod;
  url: string;
  headers: KeyValuePair[];
  queryParams: KeyValuePair[];
  auth: AuthConfig;
  body: RequestBody;
  createdAt: string;
  updatedAt: string;
}

// ============ WebSocket ============
export interface WebSocketConfig {
  id: string;
  name: string;
  description?: string;
  url: string;
  headers: KeyValuePair[];
  protocols?: string[];
  createdAt: string;
  updatedAt: string;
}

// ============ Folder Structure ============
export type FolderItem = ApiFolder | ApiRequest | WebSocketConfig;

export interface ApiFolder {
  id: string;
  name: string;
  description?: string;
  items: FolderItem[];
  auth?: AuthConfig;
  headers?: KeyValuePair[];
  isExpanded?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============ Environment ============
export interface EnvironmentVariable {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  isSecret?: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
  createdAt: string;
  updatedAt: string;
}

// ============ Response ============
export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyType: 'json' | 'text' | 'binary' | 'html' | 'xml';
  size: number;
  time: number;
  timestamp: string;
}

// ============ WebSocket State ============
export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WebSocketMessage {
  id: string;
  direction: 'sent' | 'received';
  data: string;
  timestamp: string;
  type: 'text' | 'binary';
}

// ============ Workspace ============
export interface ApiWorkspace {
  name: string;
  description?: string;
  version: '1.0';
  folders: ApiFolder[];
  requests: ApiRequest[];
  websockets: WebSocketConfig[];
  environments: Environment[];
  activeEnvironmentId?: string;
  createdAt: string;
  updatedAt: string;
}

// ============ UI State ============
export interface RequestState {
  isLoading: boolean;
  response: ApiResponse | null;
  error: string | null;
}

export interface WebSocketState {
  status: WebSocketStatus;
  messages: WebSocketMessage[];
  error: string | null;
}

// ============ Selection State ============
export type SelectedItem =
  | { type: 'request'; id: string }
  | { type: 'websocket'; id: string }
  | { type: 'folder'; id: string }
  | null;

// ============ Type Guards ============
export function isApiRequest(item: FolderItem): item is ApiRequest {
  return 'method' in item && 'url' in item && !('items' in item);
}

export function isWebSocketConfig(item: FolderItem): item is WebSocketConfig {
  return 'url' in item && !('method' in item) && !('items' in item);
}

export function isApiFolder(item: FolderItem): item is ApiFolder {
  return 'items' in item;
}
