import { detectBrowserInfo, type BrowserInfo } from "./browser-info.js";
export type { BrowserInfo } from "./browser-info.js";

export interface CrashLensOptions {
  apiKey: string;
  dsn: string;
  release?: string;
  environment?: string;
  debug?: boolean;
  maxBreadcrumbs?: number;
}

export interface CaptureContext {
  userId?: string;
  extra?: Record<string, unknown>;
}

interface Breadcrumb {
  type: string;
  message: string;
  timestamp: string;
}

class CrashLensClient {
  private options?: CrashLensOptions;
  private breadcrumbs: Breadcrumb[] = [];
  private userId?: string;
  private globalContext: Record<string, unknown> = {};

  private readonly errorHandler = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message);
    void this.captureException(error, {
      extra: {
        filename: event.filename,
        line: event.lineno,
        column: event.colno
      }
    });
  };

  private readonly rejectionHandler = (event: PromiseRejectionEvent) => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(`Unhandled promise rejection: ${String(event.reason)}`);
    void this.captureException(error);
  };

  private readonly clickHandler = (event: MouseEvent) => {
    const clickedElement = event.target instanceof Element ? event.target : null;
    if (!clickedElement) return;
    const target =
      clickedElement.closest("button, a, input, select, textarea, [role]") ?? clickedElement;
    const identity = [
      target.tagName.toLowerCase(),
      target.id ? `#${target.id}` : "",
      target.getAttribute("role") ? `[role=${target.getAttribute("role")}]` : "",
      target.getAttribute("aria-label") ? `[aria-label=${target.getAttribute("aria-label")}]` : ""
    ].join("");
    this.addBreadcrumb("ui.click", identity);
  };

  init(options: CrashLensOptions): void {
    if (!options.apiKey.trim()) throw new Error("CrashLens requires an apiKey");
    if (!options.dsn.trim()) throw new Error("CrashLens requires a dsn");

    this.close();
    this.options = { maxBreadcrumbs: 20, ...options };

    if (typeof window !== "undefined") {
      window.addEventListener("error", this.errorHandler);
      window.addEventListener("unhandledrejection", this.rejectionHandler);
      document.addEventListener("click", this.clickHandler, true);
    }
    this.log("initialized");
  }

  close(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("error", this.errorHandler);
      window.removeEventListener("unhandledrejection", this.rejectionHandler);
      document.removeEventListener("click", this.clickHandler, true);
    }
    this.options = undefined;
    this.breadcrumbs = [];
    this.userId = undefined;
    this.globalContext = {};
  }

  setUser(userId?: string): void {
    this.userId = userId;
  }

  setContext(context: Record<string, unknown>): void {
    this.globalContext = { ...this.globalContext, ...context };
  }

  addBreadcrumb(type: string, message: string): void {
    const maximum = this.options?.maxBreadcrumbs ?? 20;
    this.breadcrumbs.push({ type, message: message.slice(0, 500), timestamp: new Date().toISOString() });
    this.breadcrumbs = this.breadcrumbs.slice(-maximum);
  }

  getBrowserInfo(): Promise<BrowserInfo | undefined> {
    return detectBrowserInfo();
  }

  async captureException(error: unknown, context: CaptureContext = {}): Promise<boolean> {
    if (!this.options) {
      return false;
    }

    const normalized = this.normalizeError(error);
    const browser = await detectBrowserInfo();
    const payload = {
      type: normalized.name,
      message: normalized.message,
      stack: normalized.stack,
      timestamp: new Date().toISOString(),
      release: this.options.release,
      environment: this.options.environment,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      browser,
      userId: context.userId ?? this.userId,
      context: this.makeSerializable({ ...this.globalContext, ...context.extra }),
      breadcrumbs: [...this.breadcrumbs]
    };

    const endpoint = this.options.dsn.endsWith("/api/v1/events")
      ? this.options.dsn
      : `${this.options.dsn.replace(/\/$/, "")}/api/v1/events`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-crashlens-key": this.options.apiKey
        },
        body: JSON.stringify(payload),
        keepalive: true
      });
      if (!response.ok) {
        this.log(`server returned ${response.status}`);
        return false;
      }
      this.log(`captured ${normalized.name}: ${normalized.message}`);
      return true;
    } catch (sendError) {
      this.log(`could not send event: ${String(sendError)}`);
      return false;
    }
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    if (typeof error === "string") {
      return new Error(error);
    }
    try {
      return new Error(JSON.stringify(error));
    } catch {
      return new Error(String(error));
    }
  }

  private makeSerializable(value: Record<string, unknown>): Record<string, unknown> {
    const seen = new WeakSet<object>();
    try {
      return JSON.parse(
        JSON.stringify(value, (_key, item: unknown) => {
          if (typeof item === "object" && item !== null) {
            if (seen.has(item)) return "[Circular]";
            seen.add(item);
          }
          return item;
        })
      ) as Record<string, unknown>;
    } catch {
      return { serializationError: true };
    }
  }

  private log(message: string): void {
    if (this.options?.debug) {
      console.info(`[CrashLens] ${message}`);
    }
  }
}

export const CrashLens = new CrashLensClient();
export default CrashLens;
