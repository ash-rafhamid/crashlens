import { forwardPublicAuth } from "@/lib/auth-route";
export async function POST(request: Request) {
  return forwardPublicAuth(request, "/api/v1/auth/signup");
}
