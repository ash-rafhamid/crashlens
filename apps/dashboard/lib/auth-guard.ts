import "server-only";
import { getDashboardSessionToken } from "./session";

export async function guardApiRequest(request: Request): Promise<Response | null> {
  if (!(await getDashboardSessionToken())) {
    return Response.json({ error: "Please sign in to CrashLens" }, { status: 401 });
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== new URL(request.url).origin) {
      return Response.json({ error: "Cross-site request blocked" }, { status: 403 });
    }
  }
  return null;
}
