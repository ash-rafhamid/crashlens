import "server-only";
import { publicBackendRequest } from "./backend";

export async function forwardPublicAuth(request: Request, path: string): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-site request blocked" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const backend = await publicBackendRequest(path, {
      method: "POST",
      body: JSON.stringify(body)
    });
    const text = await backend.text();
    return new Response(text, {
      status: backend.status,
      headers: { "content-type": backend.headers.get("content-type") ?? "application/json" }
    });
  } catch {
    return Response.json({ error: "CrashLens API is temporarily unavailable." }, { status: 502 });
  }
}
