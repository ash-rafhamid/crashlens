# HTTP API

## Authentication

- Event ingestion uses `x-crashlens-key: <project-sdk-key>`.
- Management endpoints use `x-crashlens-admin-key: <private-admin-key>`.
- Dashboard clients do not call the API directly; Next.js verifies their login cookie and adds the private admin key server-side.

## Public ingestion

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

## Admin management

```text
GET   /api/v1/admin/projects
POST  /api/v1/admin/projects
POST  /api/v1/admin/projects/:projectId/rotate-key
GET   /api/v1/admin/projects/:projectId/issues
GET   /api/v1/admin/projects/:projectId/issues/:issueId
PATCH /api/v1/admin/projects/:projectId/issues/:issueId/status
GET   /api/v1/admin/projects/:projectId/stats
GET   /api/v1/admin/projects/:projectId/alerts
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

SDK keys intentionally cannot read issues or change status. All investigation and management endpoints require the private admin key.
