import "server-only";
import { cookies } from "next/headers";

const COOKIE_NAME = "crashlens_session";
const apiUrl = process.env.CRASHLENS_API_URL ?? "http://localhost:4000";

export interface DashboardUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface DashboardWorkspace {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "developer" | "viewer";
  createdAt: string;
}

export async function setDashboardSession(token: string, expiresAt: string): Promise<void> {
  const seconds = Math.max(60, Math.floor((Date.parse(expiresAt) - Date.now()) / 1_000));
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: seconds,
    path: "/",
    priority: "high"
  });
}

export async function getDashboardSessionToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE_NAME)?.value ?? null;
}

export async function deleteDashboardSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export async function readDashboardSession(): Promise<{
  user: DashboardUser;
  workspaces: DashboardWorkspace[];
} | null> {
  const token = await getDashboardSessionToken();
  if (!token) return null;
  try {
    const response = await fetch(apiUrl + "/api/v1/auth/me", {
      cache: "no-store",
      headers: { authorization: "Bearer " + token }
    });
    if (!response.ok) return null;
    return (await response.json()) as {
      user: DashboardUser;
      workspaces: DashboardWorkspace[];
    };
  } catch {
    return null;
  }
}
