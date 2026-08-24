const sensitiveKey = /password|passwd|secret|token|authorization|cookie|card|cvv|cvc/i;

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return "[Max depth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactSensitiveData(item, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          sensitiveKey.test(key) ? "[Redacted]" : redactSensitiveData(item, depth + 1)
        ])
    );
  }

  if (typeof value === "string") {
    return value.slice(0, 5_000);
  }

  return value;
}

export function removeQueryString(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split(/[?#]/, 1)[0];
  }
}
