# CrashLens

CrashLens is a small, self-hosted error-monitoring system for browser applications. Add the SDK to a website and CrashLens will collect JavaScript failures, group repeated occurrences, and show the evidence needed to reproduce them.

The repository includes the SDK, ingestion API, dashboard, and an optional demo shop. The demo shop is only a test client; real applications connect to CrashLens in the same way through the SDK.

## What it captures

- Uncaught JavaScript errors and unhandled promise rejections
- Errors reported manually from `try/catch` blocks
- Stack traces, releases, environments, URLs, and user IDs
- Browser, operating-system, and device information
- Recent click breadcrumbs leading up to a failure
- Custom context, with common sensitive fields redacted by the API

Repeated events are grouped by a stable fingerprint instead of appearing as separate issues. An issue can be resolved or ignored, and a resolved issue is marked as regressed when the same failure returns.

## How it works

```text
Your web application
        │
        │  browser error + project SDK key
        ▼
Browser SDK
        │
        │  POST /api/v1/events
        ▼
Express API ─── validates, redacts, fingerprints and groups
        │
        ▼
PostgreSQL
        │
        ▼
Next.js dashboard ─── issue list, stack trace, context and breadcrumbs
```

The project SDK key may be included in browser code because it can only submit events to one project. Dashboard users authenticate with an opaque server-side session; every read and management request is limited to projects in that user's workspace.
The operations admin key is retained only for maintenance endpoints and is never used by browser clients.

## Repository layout

```text
apps/api/                 Express ingestion and management API
apps/dashboard/           Authenticated Next.js dashboard
apps/demo-shop/           Optional React/Vite test application
packages/browser-sdk/     Framework-independent TypeScript SDK
docs/                     Architecture, API and deployment notes
```

## Run it locally

You need Node.js 22 or newer and npm.

```bash
npm install
npm run dev
```

The development services start at:

- Dashboard: <http://localhost:3000>
- Demo shop: <http://localhost:3001>
- API health check: <http://localhost:4000/health>

For the built-in local workspace, use:

```text
Email:    admin@crashlens.local
Password: crashlens-demo-admin
```

You can also create a separate account from `/signup`. In development, CrashLens shows a local verification link when SMTP is not configured.

Without `DATABASE_URL`, the API uses in-memory storage. This is convenient for development, but the data is cleared whenever the API restarts.

### Run with PostgreSQL

Copy the example environment file, replace its placeholder secrets, and start the Compose stack:

```bash
cp .env.example .env
docker compose up --build
```

See [the deployment guide](docs/DEPLOYMENT.md) for the complete environment and container setup.

## Connect a web application

Create a project from **Project settings** in the dashboard and copy the SDK key when it is shown. Then initialize the SDK in the application you want to monitor:

```ts
import CrashLens from "@crashlens/browser-sdk";

CrashLens.init({
  apiKey: "cl_live_project_key",
  dsn: "https://your-crashlens-api.example",
  release: "1.4.0",
  environment: "production"
});

CrashLens.setUser("customer-42");
CrashLens.setContext({ region: "BD" });
```

Unhandled errors are captured automatically. Report an error that the application catches itself with `captureException`:

```ts
try {
  await submitPayment();
} catch (error) {
  await CrashLens.captureException(error, {
    extra: { paymentMethod: "bKash" }
  });
}
```

The SDK currently ships as a workspace package in this repository. Before publishing it to npm, change the package scope to an npm username or organization you own. The package-specific notes are in [packages/browser-sdk/README.md](packages/browser-sdk/README.md).

## Verify the event flow

The demo shop provides a quick end-to-end check:

1. Sign in to the dashboard.
2. Open the demo shop and run a failing checkout scenario.
3. Return to the dashboard and open the new issue.
4. Repeat the same failure and confirm the occurrence count increases instead of creating a duplicate issue.
5. Resolve the issue, trigger it again, and confirm it changes to `regressed`.

The demo shop is not required in a deployed CrashLens installation. It exists so contributors and reviewers can produce predictable test events.

## Tests and builds

```bash
npm run typecheck
npm test
npm run build
```

Run the complete verification used by CI with:

```bash
npm run check
```

The test suite covers signup, verification, login, password reset, cross-account project isolation, event ingestion, grouping, SDK-key rotation, status changes, alert delivery, browser detection, and SDK reporting.

## Deployment

The simplest hosted arrangement for this repository is:

```text
Dashboard       Vercel
API             Vercel
Database        Neon PostgreSQL
Demo shop       Vercel (optional)
Browser SDK     npm (optional until public use)
```

All applications can be built from the same GitHub repository. Vercel treats the dashboard, API, and demo shop as separate projects with different root directories.

Follow [the cloud deployment guide](docs/CLOUD_DEPLOYMENT.md) for the required root directories and environment variables.

## Current scope

CrashLens is a working multi-user portfolio product. It provides public registration, email verification, password recovery, private workspaces, per-user project isolation, and multiple monitored projects.

The next SaaS-level features would be workspace invitations and role management in the UI, billing, source-map processing, audit logs, SSO, and configurable data retention.

## Documentation

- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [HTTP API](docs/API.md)
- [Docker deployment](docs/DEPLOYMENT.md)
- [Vercel, Render, Neon and npm deployment](docs/CLOUD_DEPLOYMENT.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
