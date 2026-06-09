# .api File Format

This document describes the `.api` file format used by the API Manager app. Use this reference when creating or editing API workspace files programmatically.

## File Extension

API workspaces use the `.api` extension (e.g., `my-project.api`).

## Root Structure

```json
{
  "name": "Workspace Name",
  "description": "Optional description",
  "version": "1.0",
  "folders": [],
  "requests": [],
  "websockets": [],
  "environments": [],
  "activeEnvironmentId": "env-id-here",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Workspace display name |
| `description` | string | No | Optional description |
| `version` | string | Yes | Always `"1.0"` |
| `folders` | array | Yes | Root-level folders (can be empty) |
| `requests` | array | Yes | Root-level requests not in folders |
| `websockets` | array | Yes | Root-level WebSocket configs |
| `environments` | array | Yes | Environment definitions |
| `activeEnvironmentId` | string | No | ID of the active environment |
| `createdAt` | string | Yes | ISO 8601 timestamp |
| `updatedAt` | string | Yes | ISO 8601 timestamp |

## Request Object

```json
{
  "id": "unique-uuid",
  "name": "Get Users",
  "description": "Fetches all users",
  "method": "GET",
  "url": "{{baseUrl}}/users",
  "headers": [],
  "queryParams": [],
  "auth": { "type": "none" },
  "body": { "type": "none" },
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (UUID) |
| `name` | string | Yes | Display name |
| `description` | string | No | Optional description |
| `method` | string | Yes | `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS` |
| `url` | string | Yes | URL (supports `{{variables}}`) |
| `headers` | array | Yes | Key-value pairs for headers |
| `queryParams` | array | Yes | Key-value pairs for query params |
| `auth` | object | Yes | Authentication config |
| `body` | object | Yes | Request body config |
| `createdAt` | string | Yes | ISO 8601 timestamp |
| `updatedAt` | string | Yes | ISO 8601 timestamp |

## Key-Value Pair

Used for headers, query params, and form data:

```json
{
  "id": "unique-uuid",
  "key": "Content-Type",
  "value": "application/json",
  "enabled": true,
  "description": "Optional description"
}
```

## Authentication Types

### No Auth
```json
{ "type": "none" }
```

### Bearer Token
```json
{
  "type": "bearer",
  "token": "your-token-here"
}
```

### Basic Auth
```json
{
  "type": "basic",
  "username": "user",
  "password": "pass"
}
```

### API Key
```json
{
  "type": "apikey",
  "key": "X-API-Key",
  "value": "your-api-key",
  "addTo": "header"
}
```
`addTo` can be `"header"` or `"query"`.

### OAuth 2.0
```json
{
  "type": "oauth2",
  "grantType": "client_credentials",
  "tokenUrl": "https://auth.example.com/token",
  "authUrl": "https://auth.example.com/authorize",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "scope": "read write",
  "accessToken": "cached-token",
  "refreshToken": "refresh-token",
  "expiresAt": "2024-01-01T12:00:00.000Z"
}
```
`grantType` can be `"client_credentials"`, `"authorization_code"`, or `"password"`.

## Body Types

### No Body
```json
{ "type": "none" }
```

### JSON
```json
{
  "type": "json",
  "json": "{\n  \"name\": \"John\"\n}"
}
```

### Form URL Encoded
```json
{
  "type": "form-urlencoded",
  "formUrlencoded": [
    { "id": "uuid", "key": "username", "value": "john", "enabled": true }
  ]
}
```

### Form Data (Multipart)
```json
{
  "type": "form-data",
  "formData": [
    { "id": "uuid", "key": "name", "value": "John", "enabled": true, "type": "text" },
    { "id": "uuid", "key": "avatar", "value": "", "enabled": true, "type": "file", "fileName": "photo.jpg", "fileContent": "base64..." }
  ]
}
```

### Raw
```json
{
  "type": "raw",
  "raw": "plain text content",
  "rawContentType": "text/plain"
}
```

### Binary
```json
{
  "type": "binary",
  "binary": {
    "fileName": "file.pdf",
    "content": "base64-encoded-content"
  }
}
```

## Folder Object

Folders can contain requests, websockets, and nested folders:

```json
{
  "id": "unique-uuid",
  "name": "User Endpoints",
  "description": "All user-related API calls",
  "items": [],
  "isExpanded": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

The `items` array can contain request objects, websocket objects, or nested folder objects.

## WebSocket Object

```json
{
  "id": "unique-uuid",
  "name": "Live Updates",
  "description": "Real-time notifications",
  "url": "wss://{{baseUrl}}/ws",
  "headers": [],
  "protocols": ["graphql-ws"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

## Environment Object

```json
{
  "id": "unique-uuid",
  "name": "Development",
  "variables": [
    {
      "id": "unique-uuid",
      "key": "baseUrl",
      "value": "http://localhost:3000",
      "enabled": true,
      "isSecret": false
    },
    {
      "id": "unique-uuid",
      "key": "apiKey",
      "value": "dev-key-123",
      "enabled": true,
      "isSecret": true
    }
  ],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

Variables with `isSecret: true` are masked in the UI.

## Variable Substitution

Use `{{variableName}}` syntax anywhere in URLs, headers, body, or auth fields. Variables are resolved from the active environment.

Example:
- URL: `{{baseUrl}}/api/users`
- Header: `Authorization: Bearer {{authToken}}`
- Body: `{"apiKey": "{{apiKey}}"}`

## Complete Example

See `jsonplaceholder.api` for a complete working example that demonstrates all features.

## Tips for AI Agents

1. **Always generate UUIDs** for all `id` fields (use `crypto.randomUUID()` format)
2. **Set timestamps** on creation (`createdAt` and `updatedAt`)
3. **Create at least one environment** with common variables like `baseUrl`
4. **Organize related requests** into folders
5. **Use variables** for values that change between environments
6. **Set `enabled: true`** on headers/params that should be sent
7. **Use descriptive names** for requests that explain what they do
