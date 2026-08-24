import { guardApiRequest } from "@/lib/auth-guard";
import { proxyBackend } from "@/lib/backend";

export async function GET(request: Request) {
  const blocked = await guardApiRequest(request);
  if (blocked) return blocked;
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "Choose a project" }, { status: 400 });
  return proxyBackend(`/api/v1/admin/projects/${encodeURIComponent(projectId)}/alerts`);
}
