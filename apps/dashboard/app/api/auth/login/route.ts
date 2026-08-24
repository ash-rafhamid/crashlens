import { createDashboardSession, verifyCredentials } from "@/lib/session";

const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(request: Request): boolean {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 8;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-site request blocked" }, { status: 403 });
  }
  if (isRateLimited(request)) {
    return Response.json({ error: "Too many attempts. Try again in one minute." }, { status: 429 });
  }

  let input: { email?: unknown; password?: unknown };
  try {
    input = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return Response.json({ error: "Enter an email and password" }, { status: 400 });
  }

  if (
    typeof input.email !== "string" ||
    typeof input.password !== "string" ||
    !verifyCredentials(input.email, input.password)
  ) {
    return Response.json({ error: "Email or password is incorrect" }, { status: 401 });
  }

  await createDashboardSession();
  return Response.json({ ok: true });
}
