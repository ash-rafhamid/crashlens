# Free cloud deployment

This setup is intended for a portfolio demonstration:

```text
GitHub repository
├── Vercel project 1: CrashLens dashboard (Next.js)
├── Vercel project 2: Cartly test shop (Vite)
├── Render web service: CrashLens API (Express)
├── Neon project: PostgreSQL database
└── npm public package: browser SDK (optional)
```

## 1. Put the source code on GitHub

Create one repository and push the entire monorepo. Do not upload only `apps/dashboard`: Render, Vercel, and npm all use different folders from the same repository.

Never commit `.env` files or real credentials.

## 2. Create the PostgreSQL database on Neon

1. Create a Neon project.
2. Copy its PostgreSQL connection string. Keep `sslmode=require` in the URL.
3. This connection string becomes the API's `DATABASE_URL` on Render.

CrashLens creates its tables when the API starts. You do not manually upload tables or error data. Events sent by the SDK are written to Neon automatically.

## 3. Deploy the Express API on Render

The root `render.yaml` defines the API web service.

1. In Render, choose **New → Blueprint** and connect the GitHub repository.
2. Render reads `render.yaml` and creates `crashlens-api` in Singapore.
3. Enter the Neon connection string when Render asks for `DATABASE_URL`.
4. Initially set `CORS_ORIGINS` to the local/demo origins. After Vercel gives you its domains, update it to a comma-separated list such as:

   ```text
   https://crashlens-dashboard.vercel.app,https://cartly-demo.vercel.app
   ```

5. Copy the generated `CRASHLENS_ADMIN_KEY` and `CRASHLENS_DEMO_API_KEY` from Render's environment settings. You will use the same values in Vercel.

Your API receives a URL similar to `https://crashlens-api.onrender.com`.

The free Render service sleeps after inactivity, so the first request can take roughly a minute. This is acceptable for a portfolio demo but not for serious production traffic.

## 4. Deploy the dashboard on Vercel

1. Import the same GitHub repository as a new Vercel project.
2. Set **Root Directory** to `apps/dashboard`.
3. Keep the detected framework as Next.js. For a monorepo, keep **Include source files outside of the Root Directory** enabled.
4. Add these environment variables for Production, Preview, and Development:

   ```text
   CRASHLENS_API_URL=https://crashlens-api.onrender.com
   CRASHLENS_ADMIN_KEY=<copy the value from Render>
   SESSION_SECRET=<a separate random string of at least 32 characters>
   DASHBOARD_ADMIN_EMAIL=<your login email>
   DASHBOARD_ADMIN_PASSWORD=<your strong login password>
   NEXT_PUBLIC_DEMO_SHOP_URL=https://cartly-demo.vercel.app
   ```

5. Deploy. Vercel gives the dashboard a `vercel.app` URL and HTTPS automatically.

The current CV MVP has one configured dashboard administrator. It does not provide public signup. You give the dashboard URL and credentials only to the professor/reviewer who should access it.

## 5. Deploy the Cartly test shop on Vercel

Import the same repository again as a second Vercel project:

1. Set **Root Directory** to `apps/demo-shop`.
2. Framework preset: Vite.
3. Add build-time environment variables:

   ```text
   VITE_CRASHLENS_API_URL=https://crashlens-api.onrender.com
   VITE_CRASHLENS_API_KEY=<copy CRASHLENS_DEMO_API_KEY from Render>
   VITE_RELEASE=3.2.0
   ```

4. Deploy and copy its URL into the dashboard's `NEXT_PUBLIC_DEMO_SHOP_URL` variable.
5. Redeploy the dashboard after changing that public build-time variable.

## 6. Publish the SDK to npm (optional)

The source package lives in `packages/browser-sdk`. Before publishing, change the package name from the example `@crashlens/browser-sdk` scope to a scope you own, for example:

```json
{ "name": "@your-npm-username/crashlens-browser" }
```

Then review the package contents and publish it publicly:

```bash
npm login
npm run build --workspace @crashlens/browser-sdk
npm publish --workspace @crashlens/browser-sdk --access public
```

Publishing is not necessary for the hosted demo because Cartly already consumes the local workspace package during its Vercel build.

## What each person opens

- Professor/recruiter: the Vercel dashboard URL, then signs in.
- Developer testing errors: the Cartly Vercel URL.
- Monitored application: sends events to the Render API URL using its project SDK key.
- Nobody directly browses the Neon database during normal use; the API owns database access.
