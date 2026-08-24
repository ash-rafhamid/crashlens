import { guardApiRequest } from "@/lib/auth-guard";
import { proxyBackend } from "@/lib/backend";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function projectIdFrom(request: Request): string | null {
  return new URL(request.url).searchParams.get("projectId");
}

export async function GET(request: Request, context: RouteContext) {
  const blocked = await guardApiRequest(request);
  if (blocked) return blocked;
  const { id } = await context.params;
  const projectId = projectIdFrom(request);
  if (!projectId) return Response.json({ error: "Choose a project" }, { status: 400 });
  return proxyBackend(
    `/api/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(id)}`
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const blocked = await guardApiRequest(request);
  if (blocked) return blocked;
  const { id } = await context.params;
  const projectId = projectIdFrom(request);
  if (!projectId) return Response.json({ error: "Choose a project" }, { status: 400 });
  const body = await request.text();
  return proxyBackend(
    `/api/v1/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(id)}/status`,
    { method: "PATCH", body }
  );
}
