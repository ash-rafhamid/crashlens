# CrashLens browser SDK

The CrashLens browser SDK watches a web application for JavaScript failures and sends structured error events to a CrashLens API.

It captures uncaught errors and unhandled promise rejections automatically. Applications can also report caught exceptions manually. Each event may contain the stack trace, current page, release, environment, browser information, user ID, custom context, and recent click breadcrumbs.

## Installation

Install the public package with:

```bash
npm install @ash_rafhamid/crashlens-browser-sdk
```

## Setup

```ts
import CrashLens from "@ash_rafhamid/crashlens-browser-sdk";

CrashLens.init({
  apiKey: "cl_live_project_key",
  dsn: "https://your-crashlens-api.example",
  release: "1.4.0",
  environment: "production"
});
```

`dsn` may be the API origin or the complete `/api/v1/events` endpoint.

## Add user and application context

```ts
CrashLens.setUser("customer-42");
CrashLens.setContext({ region: "BD", checkoutVersion: 3 });
CrashLens.addBreadcrumb("checkout", "Customer selected bKash");
```

Avoid sending passwords, access tokens, payment details, or other private data. The API redacts common sensitive key names, but applications should still collect only the context developers actually need.

## Report a caught exception

```ts
try {
  await reserveInventory();
} catch (error) {
  const accepted = await CrashLens.captureException(error, {
    extra: { sku: "CLOUD-RUNNER-42" }
  });

  if (!accepted) {
    console.warn("CrashLens could not send the event");
  }
}
```

`captureException` never throws because monitoring should not break the monitored application. It returns `true` when the API accepts the event and `false` when reporting is unavailable.

## Publishing

Build and test the workspace, review the package files, and publish it publicly.

```bash
cd packages/browser-sdk
npm run build
npm test
npm pack --dry-run
npm publish --access public
```

Never include the private `CRASHLENS_ADMIN_KEY` in this package or in browser code. A browser application receives only its project SDK key, which permits event ingestion but cannot read or manage issues.
