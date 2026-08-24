# CrashLens architecture

## The problem

A customer sees a broken payment page, but the developer cannot reproduce it. CrashLens gives the developer the error message, stack trace, release, browser, user impact, and actions that happened before the failure.

## Event flow

```text
Monitored website
  └─ @ash_rafhamid/crashlens-browser-sdk
       ├─ watches window.error and unhandledrejection
       ├─ records recent click breadcrumbs
       └─ POST /api/v1/events + public project SDK key
             │
             ▼
Express API
  ├─ authenticates the project key
  ├─ validates and redacts the payload
  ├─ creates a stable error fingerprint
  ├─ groups a repeat into its existing issue
  ├─ marks a resolved issue as regressed if it returns
  └─ stores the event, issue, and alert in PostgreSQL
             │
             ▼
Next.js dashboard
  ├─ stores an opaque API session in an HttpOnly cookie
  ├─ proxies requests with that user's bearer session
  ├─ switches only between projects in the user's workspace
  └─ displays issues, stats, alerts, and event evidence
```

## Trust boundaries

| Credential | Location | Permission |
| --- | --- | --- |
| Project SDK key | Monitored browser application | Send events to one project |
| Account session | Developer browser, HttpOnly | Manage projects in joined workspaces |
| Operations admin key | API operators only | Maintenance and emergency administration |
| Database credentials | API server only | Read and write PostgreSQL |

A browser SDK key is not treated as a secret: anything shipped to a browser can be inspected. It cannot list issues, create projects, or rotate keys. Account tokens and the operations key must never be placed in frontend JavaScript.

## Main components

### Browser SDK (`packages/browser-sdk`)

- Framework-independent TypeScript package.
- Automatically captures uncaught errors and rejected promises.
- Supports manual capture for errors an application catches itself.
- Detects common browsers, operating systems, and device classes.
- Sends breadcrumbs and context without blocking the monitored application.

### API (`apps/api`)

- Express 5 service with Zod validation, Helmet, CORS, body limits, and rate limiting.
- Repository interface keeps business logic independent of PostgreSQL.
- Memory repository makes local development and unit tests fast.
- PostgreSQL repository provides durable, isolated project data.
- SHA-256 hashes SDK keys; raw keys are returned only when created or rotated.
- An advisory transaction lock prevents concurrent first events from creating duplicate issues.

### Dashboard (`apps/dashboard`)

- Next.js App Router application.
- Signup, email verification, login, logout, and password recovery pages.
- Opaque seven-day API session in an HttpOnly, Secure, SameSite cookie.
- Every API query joins project ownership through workspace membership.
- Project selector, create-project flow, one-time key display, and key rotation.

### Demo shop (`apps/demo-shop`)

- Separate React/Vite application that behaves like a monitored customer website.
- Eight HTTP checkout outcomes and a reliability test suite.
- Shows that CrashLens observes another application; it is not merely a dashboard with fake rows.

## Data model

- `users`: account profile, verification state, and scrypt password hash.
- `workspaces` and `workspace_members`: ownership boundary and member role.
- `auth_sessions` and `auth_tokens`: hashed sessions, verification, and reset tokens.
- `projects`: project identity, workspace ownership, and hashed SDK key.
- `issues`: grouped error identity, status, counts, first/last seen, and release.
- `error_events`: individual occurrences with stack, browser, user, context, and breadcrumbs.
- `alerts`: new-issue and regression notifications plus webhook delivery status.

Deleting a project cascades to its issues, events, and alerts at the database layer.

## Fingerprinting and regression

The API normalizes changing line/column numbers and development cache-busting text before hashing the error type, message, and useful stack frame. Five occurrences of the same defect therefore become one issue with an occurrence count of five.

When a developer resolves an issue and the same fingerprint arrives later, the status becomes `regressed` and CrashLens creates a regression alert.

## Honest MVP boundary

This is a complete, deployable multi-user portfolio product, not a replacement for Sentry at global scale. A larger SaaS version would add workspace invitations in the UI, richer RBAC, durable job queues, source-map processing, retention jobs, billing, SSO, audit logs, and horizontally coordinated caching.
