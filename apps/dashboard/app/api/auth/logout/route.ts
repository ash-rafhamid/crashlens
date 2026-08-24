import { guardApiRequest } from "@/lib/auth-guard";
import { deleteDashboardSession } from "@/lib/session";

export async function POST(request: Request) {
  const blocked = await guardApiRequest(request);
  if (blocked) return blocked;
  await deleteDashboardSession();
  return Response.json({ ok: true });
}
