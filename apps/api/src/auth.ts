import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_BYTES = 64;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, PASSWORD_KEY_BYTES)) as Buffer;
  return ["scrypt", salt, derived.toString("base64url")].join(":");
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [scheme, salt, encoded, extra] = storedHash.split(":");
  if (scheme !== "scrypt" || !salt || !encoded || extra) return false;

  try {
    const expected = Buffer.from(encoded, "base64url");
    const supplied = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  } catch {
    return false;
  }
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
