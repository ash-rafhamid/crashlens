import "server-only";
import { getDashboardSessionToken } from "./session";

const apiUrl = process.env.CRASHLENS_API_URL ?? "http://localhost:4000";

export async function publicBackendRequest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl + path, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
}

export async function backendRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getDashboardSessionToken();
  return publicBackendRequest(path, {
    ...init,
    headers: {
      authorization: token ? "Bearer " + token : "",
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
      { error: "CrashLens API is temporarily unavailable." },
      { status: 502 }
    );
  }
}
