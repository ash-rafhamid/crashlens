# HTTP API

## Authentication

- Event ingestion uses `x-crashlens-key: <project-sdk-key>`.
- Account login returns an opaque session token. The dashboard stores it in an HttpOnly cookie.
- User management endpoints use `Authorization: Bearer <session-token>` and authorize every project through workspace membership.
- `x-crashlens-admin-key` is reserved for maintenance endpoints and is not used by the dashboard.

## Public ingestion
## Accounts

```text
POST /api/v1/auth/signup
POST /api/v1/auth/resend-verification
POST /api/v1/auth/verify-email
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
```


### `POST /api/v1/events`

Minimal body:

```json
{
  "type": "TypeError",
  "message": "Cannot read properties of undefined",
  "stack": "TypeError: Cannot read...\n    at checkout (payment.ts:84:12)",
  "timestamp": "2026-08-24T10:00:00.000Z",
  "release": "3.2.0",
  "environment": "production"
}
```

Returns HTTP `202` with the grouped issue. Invalid payloads return `400`; missing or rotated keys return `401`.

## User project management

```text
GET   /api/v1/projects
POST  /api/v1/projects
POST  /api/v1/projects/:projectId/rotate-key
GET   /api/v1/projects/:projectId/issues
GET   /api/v1/projects/:projectId/issues/:issueId
PATCH /api/v1/projects/:projectId/issues/:issueId/status
GET   /api/v1/projects/:projectId/stats
GET   /api/v1/projects/:projectId/alerts
```

Create project body:

```json
{ "name": "Acme Banking Portal" }
```

The create and rotate responses are the only places that return a raw SDK key. Store it immediately. PostgreSQL stores only its SHA-256 hash.

Status update body:

```json
{ "status": "resolved" }
```

Allowed manual values are `unresolved`, `resolved`, and `ignored`. `regressed` is assigned automatically when a resolved issue returns.

SDK keys intentionally cannot read issues or change status. Investigation and management endpoints require a verified user session and return only projects in that user's workspaces.
