# Deployment guide

## Fast local development

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev
```

The API uses memory when `DATABASE_URL` is absent. Restarting it clears the data.

## Full PostgreSQL deployment with Docker

1. Copy the root environment template.

   PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Replace every `replace-with-...` value in `.env`. Generate long random values for the session secret, admin key, SDK key, and passwords. Compose intentionally refuses to start when a required value is missing.

3. Build and start the four services.

   ```bash
   docker compose up --build -d
   ```

4. Check service health.

   ```bash
   docker compose ps
   ```

5. Open:

   - Dashboard: <http://localhost:3000>
   - Test shop: <http://localhost:3001>
   - API health: <http://localhost:4000/health>

The default local login is `admin@crashlens.local` / `crashlens-demo-admin` only when no custom values are supplied.

Stop the services without deleting database data:

```bash
docker compose down
```

## Optional webhook alerts

Set `CRASHLENS_ALERT_WEBHOOK_URL`. CrashLens sends JSON whenever a new issue appears or a resolved issue regresses. If `CRASHLENS_ALERT_WEBHOOK_SECRET` is set, the request includes `x-crashlens-signature`, an HMAC-SHA256 hex digest of the exact request body.

Webhook failure never prevents event ingestion. The alert stays in PostgreSQL with `failed` status and is visible in the dashboard.

## Public deployment checklist

- Put nginx, Caddy, Cloudflare, or a cloud load balancer in front of the dashboard and API.
- Enable HTTPS. The production dashboard cookie uses the `Secure` flag.
- Route a dashboard domain to port 3000 and an API domain to port 4000.
- Set `CORS_ORIGINS` to exact monitored-application origins.
- Build the demo shop with its public API URL and SDK key as Vite build arguments.
- Use managed PostgreSQL or a backed-up persistent volume.
- Do not expose port 5432 publicly.
- Store secrets in the hosting platform's secret manager, not in the repository.
- Define retention/deletion rules before accepting real personal data.
- Use at least two distinct credentials: one public project SDK key and one private admin key.

The Next.js service uses standalone output so its production image contains traced runtime files instead of the full development workspace.

## CI/CD

`.github/workflows/ci.yml` runs locked dependency installation, strict TypeScript checks, all tests, all production builds, and a high-severity production dependency audit on pushes and pull requests.
