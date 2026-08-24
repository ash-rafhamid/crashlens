import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createSessionToken, verifySessionToken } from "./session-token";

const COOKIE_NAME = "crashlens_session";
const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? "local-only-crashlens-session-secret-change-me";
}

export function dashboardIdentity() {
  return {
    userId: "admin",
    email: process.env.DASHBOARD_ADMIN_EMAIL ?? "admin@crashlens.local",
    password: process.env.DASHBOARD_ADMIN_PASSWORD ?? "crashlens-demo-admin"
  };
}

function sameValue(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyCredentials(email: string, password: string): boolean {
  const expected = dashboardIdentity();
  return sameValue(email.trim().toLowerCase(), expected.email.toLowerCase()) &&
    sameValue(password, expected.password);
}

export async function createDashboardSession(): Promise<void> {
  const identity = dashboardIdentity();
  const token = createSessionToken(sessionSecret(), identity.userId);
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_LIFETIME_SECONDS,
    path: "/",
    priority: "high"
  });
}

export async function deleteDashboardSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export async function readDashboardSession() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const payload = verifySessionToken(token, sessionSecret());
  if (!payload) return null;
  return { userId: payload.userId, email: dashboardIdentity().email };
}
