import { guardApiRequest } from "@/lib/auth-guard";
import { proxyBackend } from "@/lib/backend";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const blocked = await guardApiRequest(request);
  if (blocked) return blocked;
  const { id } = await context.params;
  return proxyBackend(`/api/v1/projects/${encodeURIComponent(id)}/rotate-key`, {
    method: "POST"
  });
}
