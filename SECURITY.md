# Security policy

CrashLens is a portfolio MVP and should be deployed behind HTTPS and a reverse proxy.

## Report a vulnerability

Do not open a public issue containing exploit details or captured user data. Contact the repository owner privately with the affected version, reproduction steps, and impact.

## Deployment requirements

- Replace every example database password, operations key, SDK key, bootstrap password, and SMTP app password.
- Keep `CRASHLENS_ADMIN_KEY` only on the API server. The dashboard uses per-user sessions instead.
- Store Gmail app passwords only in the hosting provider's encrypted environment settings.
- Restrict `CORS_ORIGINS` to the monitored applications.
- Use HTTPS so the dashboard session cookie is transmitted securely.
- Protect and back up PostgreSQL, and define an event-retention policy before collecting real user traffic.
- Put rate limiting and request-size limits at the reverse proxy as well as the API.
- Treat captured stack traces, URLs, user IDs, and context as potentially sensitive data.

The SDK key is intentionally public because browser code cannot keep a secret. It identifies a project and permits event ingestion; it does not grant dashboard-management access.
