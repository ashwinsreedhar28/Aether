/**
 * useHttpClient Hook
 * Handles HTTP request execution
 */

import { useState, useCallback, useRef } from 'react';
import type {
  ApiRequest,
  ApiResponse,
  RequestState,
  Environment,
  AuthConfig,
  RequestBody,
  OAuth2Auth,
} from '../types';
import { resolveVariables, resolveKeyValuePairs } from './useEnvironments';

interface UseHttpClientReturn {
  execute: (request: ApiRequest, environment: Environment | null) => Promise<void>;
  cancel: () => void;
  state: RequestState;
  clearResponse: () => void;
}

export function useHttpClient(): UseHttpClientReturn {
  const [state, setState] = useState<RequestState>({
    isLoading: false,
    response: null,
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const clearResponse = useCallback(() => {
    setState({
      isLoading: false,
      response: null,
      error: null,
    });
  }, []);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState((s) => ({ ...s, isLoading: false }));
  }, []);

  const execute = useCallback(
    async (request: ApiRequest, environment: Environment | null) => {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setState({
        isLoading: true,
        response: null,
        error: null,
      });

      const startTime = performance.now();

      try {
        // Resolve URL
        let url = resolveVariables(request.url, environment);

        // Add query parameters
        const enabledParams = request.queryParams.filter((p) => p.enabled);
        if (enabledParams.length > 0) {
          const resolvedParams = resolveKeyValuePairs(enabledParams, environment);
          const searchParams = new URLSearchParams();
          for (const param of resolvedParams) {
            searchParams.append(param.key, param.value);
          }
          const separator = url.includes('?') ? '&' : '?';
          url = `${url}${separator}${searchParams.toString()}`;
        }

        // Build headers
        const headers: Record<string, string> = {};
        const enabledHeaders = request.headers.filter((h) => h.enabled);
        const resolvedHeaders = resolveKeyValuePairs(enabledHeaders, environment);
        for (const header of resolvedHeaders) {
          headers[header.key] = header.value;
        }

        // Add auth headers
        const authHeaders = await buildAuthHeaders(request.auth, environment);
        Object.assign(headers, authHeaders);

        // Build body
        const { body, contentType } = buildRequestBody(request.body, environment);
        if (contentType && !headers['Content-Type']) {
          headers['Content-Type'] = contentType;
        }

        // Make request
        const response = await fetch(url, {
          method: request.method,
          headers,
          body,
          signal: abortController.signal,
        });

        const endTime = performance.now();

        // Parse response
        const responseBody = await response.text();
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        // Detect body type
        const contentTypeHeader = response.headers.get('content-type') || '';
        let bodyType: ApiResponse['bodyType'] = 'text';
        if (contentTypeHeader.includes('application/json')) {
          bodyType = 'json';
        } else if (contentTypeHeader.includes('text/html')) {
          bodyType = 'html';
        } else if (contentTypeHeader.includes('xml')) {
          bodyType = 'xml';
        }

        const apiResponse: ApiResponse = {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody,
          bodyType,
          size: new Blob([responseBody]).size,
          time: endTime - startTime,
          timestamp: new Date().toISOString(),
        };

        setState({
          isLoading: false,
          response: apiResponse,
          error: null,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setState((s) => ({ ...s, isLoading: false }));
          return;
        }

        setState({
          isLoading: false,
          response: null,
          error: err instanceof Error ? err.message : 'Request failed',
        });
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    []
  );

  return {
    execute,
    cancel,
    state,
    clearResponse,
  };
}

async function buildAuthHeaders(
  auth: AuthConfig,
  environment: Environment | null
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  switch (auth.type) {
    case 'bearer': {
      const token = resolveVariables(auth.token, environment);
      headers['Authorization'] = `Bearer ${token}`;
      break;
    }
    case 'basic': {
      const username = resolveVariables(auth.username, environment);
      const password = resolveVariables(auth.password, environment);
      const encoded = btoa(`${username}:${password}`);
      headers['Authorization'] = `Basic ${encoded}`;
      break;
    }
    case 'apikey': {
      const key = resolveVariables(auth.key, environment);
      const value = resolveVariables(auth.value, environment);
      if (auth.addTo === 'header') {
        headers[key] = value;
      }
      // Query params handled separately in URL building
      break;
    }
    case 'oauth2': {
      // Check if token needs refresh
      let accessToken = auth.accessToken;
      if (auth.expiresAt && new Date(auth.expiresAt) < new Date()) {
        // Token expired, try to refresh
        try {
          const refreshed = await refreshOAuthToken(auth, environment);
          accessToken = refreshed.accessToken;
        } catch {
          // Refresh failed, use existing token
        }
      }
      if (accessToken) {
        headers['Authorization'] = `Bearer ${resolveVariables(accessToken, environment)}`;
      }
      break;
    }
  }

  return headers;
}

async function refreshOAuthToken(
  auth: OAuth2Auth,
  environment: Environment | null
): Promise<OAuth2Auth> {
  if (!auth.refreshToken) {
    throw new Error('No refresh token available');
  }

  const tokenUrl = resolveVariables(auth.tokenUrl, environment);
  const clientId = resolveVariables(auth.clientId, environment);
  const clientSecret = resolveVariables(auth.clientSecret, environment);
  const refreshToken = resolveVariables(auth.refreshToken, environment);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error('Token refresh failed');
  }

  const data = await response.json();

  return {
    ...auth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || auth.refreshToken,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : undefined,
  };
}

function buildRequestBody(
  body: RequestBody,
  environment: Environment | null
): { body: BodyInit | null; contentType: string | null } {
  switch (body.type) {
    case 'none':
      return { body: null, contentType: null };

    case 'json': {
      const content = resolveVariables(body.json || '', environment);
      return { body: content, contentType: 'application/json' };
    }

    case 'form-urlencoded': {
      const params = new URLSearchParams();
      const resolvedPairs = resolveKeyValuePairs(body.formUrlencoded || [], environment);
      for (const pair of resolvedPairs) {
        if (pair.enabled) {
          params.append(pair.key, pair.value);
        }
      }
      return { body: params, contentType: 'application/x-www-form-urlencoded' };
    }

    case 'form-data': {
      const formData = new FormData();
      for (const item of body.formData || []) {
        if (!item.enabled) continue;
        const key = resolveVariables(item.key, environment);
        if (item.type === 'file' && item.fileContent) {
          const blob = base64ToBlob(item.fileContent);
          formData.append(key, blob, item.fileName);
        } else {
          formData.append(key, resolveVariables(item.value, environment));
        }
      }
      // Don't set Content-Type for FormData - browser will set it with boundary
      return { body: formData, contentType: null };
    }

    case 'raw': {
      const content = resolveVariables(body.raw || '', environment);
      return { body: content, contentType: body.rawContentType || 'text/plain' };
    }

    case 'binary': {
      if (body.binary?.content) {
        const blob = base64ToBlob(body.binary.content);
        return { body: blob, contentType: 'application/octet-stream' };
      }
      return { body: null, contentType: null };
    }

    default:
      return { body: null, contentType: null };
  }
}

function base64ToBlob(base64: string, mimeType = 'application/octet-stream'): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}
