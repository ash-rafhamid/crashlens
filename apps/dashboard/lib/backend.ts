import "server-only";

const apiUrl = process.env.CRASHLENS_API_URL ?? "http://localhost:4000";
const adminApiKey = process.env.CRASHLENS_ADMIN_KEY ?? "crashlens_admin_key_change_me";

export async function backendRequest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${apiUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-crashlens-admin-key": adminApiKey,
      ...init.headers
    }
  });
}

export async function proxyBackend(path: string, init?: RequestInit): Promise<Response> {
  try {
    const backend = await backendRequest(path, init);
    const body = await backend.text();
    return new Response(body, {
      status: backend.status,
      headers: { "content-type": backend.headers.get("content-type") ?? "application/json" }
    });
  } catch {
    return Response.json(
      { error: "CrashLens API is unavailable. Start the API on port 4000." },
      { status: 502 }
    );
  }
}
