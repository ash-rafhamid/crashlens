import { guardApiRequest } from "@/lib/auth-guard";
import { proxyBackend } from "@/lib/backend";

export async function GET(request: Request) {
  const blocked = await guardApiRequest(request);
  if (blocked) return blocked;
  return proxyBackend("/api/v1/admin/projects");
}

export async function POST(request: Request) {
  const blocked = await guardApiRequest(request);
  if (blocked) return blocked;
  return proxyBackend("/api/v1/admin/projects", {
    method: "POST",
    body: await request.text()
  });
}
