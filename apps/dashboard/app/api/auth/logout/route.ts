import { guardApiRequest } from "@/lib/auth-guard";
import { backendRequest } from "@/lib/backend";
import { deleteDashboardSession } from "@/lib/session";

export async function POST(request: Request) {
  const blocked = await guardApiRequest(request);
  if (blocked) return blocked;
  try {
    await backendRequest("/api/v1/auth/logout", { method: "POST" });
  } finally {
    await deleteDashboardSession();
  }
  return Response.json({ ok: true });
}
