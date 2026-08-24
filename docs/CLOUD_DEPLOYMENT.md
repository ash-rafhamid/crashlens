# Free cloud deployment

CrashLens uses one GitHub monorepo and four independent services:

```text
GitHub repository
├── Vercel project 1: CrashLens API (Express)
├── Vercel project 2: CrashLens dashboard (Next.js)
├── Vercel project 3: Cartly demo shop (Vite, optional)
├── Neon project: PostgreSQL database
└── npm public package: browser SDK (optional)
```

Never commit a real `.env` file, database URL, Gmail app password, API key, or account password.

## 1. Create Neon PostgreSQL

1. Create a Neon project in a region near the Vercel functions.
2. Open **Connect** and copy the pooled PostgreSQL connection string.
3. Keep `sslmode=require` in the URL.
4. Store this value as `DATABASE_URL` in the API project only.

CrashLens creates and upgrades its tables when the API starts. The schema includes users, workspaces, memberships, sessions, projects, issues, events, and alerts.

## 2. Deploy the API on Vercel

Import the GitHub repository and select the detected **api** application.

- Root Directory: `apps/api`
- Framework preset: Express
- Build command: `npm run build`

Add these environment variables to Production and Preview:

```text
DATABASE_URL=<Neon pooled connection string>
CRASHLENS_DEMO_API_KEY=<long random demo SDK key>
CRASHLENS_ADMIN_KEY=<different long random operations key>
CRASHLENS_BOOTSTRAP_NAME=Ashraf
CRASHLENS_BOOTSTRAP_EMAIL=<your admin email>
CRASHLENS_BOOTSTRAP_PASSWORD=<your strong admin password>
CRASHLENS_BOOTSTRAP_WORKSPACE=CrashLens Workspace
DASHBOARD_URL=https://your-dashboard.vercel.app
CORS_ORIGINS=https://your-dashboard.vercel.app,https://your-demo-shop.vercel.app

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<the Gmail address that created the app password>
SMTP_APP_PASSWORD=<your Google app password>
EMAIL_FROM=CrashLens <the-same-gmail-address>
```

The app password is a secret value. Paste it only into Vercel's environment-variable value field. Do not send it in chat or commit it to GitHub.

Deploy and verify:

```text
https://your-api.vercel.app/health
```

The expected result includes `"status": "ok"` and `"storage": "postgresql"`.

## 3. Deploy the dashboard on Vercel

Import the same GitHub repository again and select **dashboard**.

- Root Directory: `apps/dashboard`
- Framework preset: Next.js

The dashboard needs only:

```text
CRASHLENS_API_URL=https://your-api.vercel.app
NEXT_PUBLIC_DEMO_SHOP_URL=https://your-demo-shop.vercel.app
```

It does not need the operations admin key, a session secret, or one hard-coded dashboard password. Each person creates an account, verifies their email, and receives an isolated workspace.

After the first dashboard deployment:

1. Copy its final Vercel URL.
2. Update `DASHBOARD_URL` and `CORS_ORIGINS` in the API project.
3. Redeploy the API so verification and reset emails use the correct URL.

The bootstrap account is verified automatically and owns any project that existed before the multi-user migration.

## 4. Deploy the demo shop (optional)

Import the repository a third time and select **demo-shop**.

- Root Directory: `apps/demo-shop`
- Framework preset: Vite

Add:

```text
VITE_CRASHLENS_API_URL=https://your-api.vercel.app
VITE_CRASHLENS_API_KEY=<same value as CRASHLENS_DEMO_API_KEY>
VITE_RELEASE=3.2.0
```

Copy the demo URL into `NEXT_PUBLIC_DEMO_SHOP_URL` on the dashboard and add it to `CORS_ORIGINS` on the API, then redeploy both affected projects.

The demo shop is optional. Real users create a project in their own dashboard, copy its SDK key once, and install the SDK in their own website.

## 5. Test two real users

1. Open `/signup` in a private browser window.
2. Register User A, open the verification email, and sign in.
3. Create a project named **User A App**.
4. Sign out and register User B with a different email.
5. Confirm User B sees an empty workspace and cannot see User A's project.
6. Use **Forgot password** and confirm the Gmail reset message opens the deployed dashboard.
7. Send a test SDK event and confirm only the owning account sees it.

The API also has an automated test that performs this cross-account isolation check.

## 6. Publish the SDK to npm (optional)

Before publishing, change the package scope to an npm username or organization you own. Then run:

```bash
npm login
npm run build --workspace @crashlens/browser-sdk
npm publish --workspace @crashlens/browser-sdk --access public
```

Publishing is not required for the hosted demo because the demo shop consumes the workspace package from the monorepo.
