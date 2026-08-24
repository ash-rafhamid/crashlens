# Contributing to CrashLens

Thanks for taking the time to improve CrashLens. Small, focused changes are easiest to review.

## Development setup

You need Node.js 22 or newer and npm.

```bash
npm install
npm run dev
```

The API uses in-memory storage when `DATABASE_URL` is not set. PostgreSQL is only required when working on database-specific behavior.

## Before opening a pull request

Run the same verification used by CI:

```bash
npm run check
```

When changing the browser SDK, also inspect the package contents:

```bash
npm pack --workspace @ash_rafhamid/crashlens-browser-sdk --dry-run
```

Please include tests for behavior changes and update the relevant documentation when an API, environment variable, or deployment step changes.

## Project guidelines

- Keep the SDK small and framework-independent.
- Monitoring failures must not break the monitored application.
- Treat stack traces, URLs, user IDs, and context as potentially sensitive.
- Never expose the dashboard admin key to browser code.
- Keep project data isolated at the repository and API boundaries.
- Prefer an explicit limitation over a feature claim the project cannot support.

## Reporting security problems

Do not open a public issue for vulnerabilities or captured private data. Follow [SECURITY.md](SECURITY.md) instead.
