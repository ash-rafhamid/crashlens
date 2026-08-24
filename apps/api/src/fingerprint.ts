import { createHash } from "node:crypto";

function normalizeStack(stack?: string): string {
  if (!stack) {
    return "no-stack";
  }

  return stack
    .split("\n")
    .slice(0, 5)
    .map((line) =>
      line
        .trim()
        .replace(/https?:\/\/[^/\s]+/gi, "<origin>")
        .replace(/[?#][^:\s)]+/g, "")
        .replace(/:\d+:\d+/g, ":#:#")
        .replace(/[a-f0-9]{8,}/gi, "<hash>")
    )
    .join("|");
}

export function createFingerprint(type: string, message: string, stack?: string): string {
  const input = `${type.trim()}|${message.trim()}|${normalizeStack(stack)}`;
  return createHash("sha256").update(input).digest("hex");
}

export function findCulprit(stack?: string): string | null {
  if (!stack) {
    return null;
  }

  const usefulLine = stack
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("at ") || /\.[cm]?[jt]sx?:\d+/i.test(line));

  return usefulLine?.replace(/[?#][^:\s)]+/g, "").slice(0, 500) ?? null;
}
