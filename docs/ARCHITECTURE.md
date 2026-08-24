# CrashLens architecture

## The problem

A customer sees a broken payment page, but the developer cannot reproduce it. CrashLens gives the developer the error message, stack trace, release, browser, user impact, and actions that happened before the failure.

## Event flow

```text
Monitored website
  └─ @crashlens/browser-sdk
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
  ├─ verifies a signed HttpOnly login session
  ├─ calls the API with a private admin key on the server
  ├─ switches between isolated projects
  └─ displays issues, stats, alerts, and event evidence
```

## Trust boundaries

| Credential | Location | Permission |
| --- | --- | --- |
| Project SDK key | Monitored browser application | Send events to one project |
| Dashboard session cookie | Developer browser, HttpOnly | Use the dashboard until expiry |
| Admin key | API and Next.js server only | Manage every project |
| Database credentials | API server only | Read and write PostgreSQL |

A browser SDK key is not treated as a secret: anything shipped to a browser can be inspected. It cannot list issues, create projects, or rotate keys. The admin key must never be placed in frontend code.

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
- Signed eight-hour session in an HttpOnly, SameSite cookie.
- Every data route verifies the session; hiding UI is not the security boundary.
- Server-side proxy keeps the private admin key out of client JavaScript.
- Project selector, create-project flow, one-time key display, and key rotation.

### Demo shop (`apps/demo-shop`)

- Separate React/Vite application that behaves like a monitored customer website.
- Eight HTTP checkout outcomes and a reliability test suite.
- Shows that CrashLens observes another application; it is not merely a dashboard with fake rows.

## Data model

- `projects`: project identity and hashed SDK key.
- `issues`: grouped error identity, status, counts, first/last seen, and release.
- `error_events`: individual occurrences with stack, browser, user, context, and breadcrumbs.
- `alerts`: new-issue and regression notifications plus webhook delivery status.

Deleting a project cascades to its issues, events, and alerts at the database layer.

## Fingerprinting and regression

The API normalizes changing line/column numbers and development cache-busting text before hashing the error type, message, and useful stack frame. Five occurrences of the same defect therefore become one issue with an occurrence count of five.

When a developer resolves an issue and the same fingerprint arrives later, the status becomes `regressed` and CrashLens creates a regression alert.

## Honest MVP boundary

This is a complete, deployable portfolio MVP—not a replacement for Sentry at global scale. A larger SaaS version would add organizations and RBAC, durable job queues, source-map processing, retention jobs, billing, SSO, audit logs, and horizontally coordinated caching.
