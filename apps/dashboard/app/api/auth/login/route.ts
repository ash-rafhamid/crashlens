import { publicBackendRequest } from "@/lib/backend";
import { setDashboardSession } from "@/lib/session";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-site request blocked" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Enter an email and password" }, { status: 400 });
  }

  try {
    const backend = await publicBackendRequest("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(body)
    });
    const result = (await backend.json().catch(() => ({}))) as {
      token?: string;
      expiresAt?: string;
      error?: string;
      code?: string;
    };
    if (!backend.ok || !result.token || !result.expiresAt) {
      return Response.json(result, { status: backend.status });
    }
    await setDashboardSession(result.token, result.expiresAt);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "CrashLens API is temporarily unavailable." }, { status: 502 });
  }
}
