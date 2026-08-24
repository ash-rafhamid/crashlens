import { randomBytes, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { deliverAlert } from "./alert-service.js";
import { createFingerprint, findCulprit } from "./fingerprint.js";
import { redactSensitiveData, removeQueryString } from "./redact.js";
import type { IssueRepository } from "./repository.js";
import {
  capturedEventSchema,
  demoCheckoutSchema,
  projectCreateSchema,
  statusUpdateSchema
} from "./validation.js";
import type { CapturedEvent, Project } from "./domain.js";

type HelmetMiddlewareFactory = (options: Record<string, unknown>) => ReturnType<typeof express.json>;
const createHelmetMiddleware = helmet as unknown as HelmetMiddlewareFactory;

interface BuildAppOptions {
  adminApiKey?: string;
  alertWebhookUrl?: string;
  alertWebhookSecret?: string;
}

function getApiKey(request: Request): string | null {
  const value = request.header("x-crashlens-key");
  return value?.trim() || null;
}

function valuesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function createProjectApiKey(): string {
  return `cl_live_${randomBytes(24).toString("base64url")}`;
}

function createSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "project";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export function buildApp(repository: IssueRepository, options: BuildAppOptions = {}) {
  const app = express();
  const adminApiKey =
    options.adminApiKey ?? process.env.CRASHLENS_ADMIN_KEY ?? "crashlens_admin_key_change_me";
  const alertOptions = {
    webhookUrl: options.alertWebhookUrl ?? process.env.CRASHLENS_ALERT_WEBHOOK_URL,
    webhookSecret: options.alertWebhookSecret ?? process.env.CRASHLENS_ALERT_WEBHOOK_SECRET
  };
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim());

  app.disable("x-powered-by");
  app.use(createHelmetMiddleware({ crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin is not allowed"));
      }
    })
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 1_000,
      standardHeaders: "draft-8",
      legacyHeaders: false
    })
  );

  async function requireProject(
    request: Request,
    response: Response
  ): Promise<Project | null> {
    const apiKey = getApiKey(request);
    if (!apiKey) {
      response.status(401).json({ error: "Missing x-crashlens-key header" });
      return null;
    }

    const project = await repository.findProjectByApiKey(apiKey);
    if (!project) {
      response.status(401).json({ error: "Invalid project API key" });
      return null;
    }
    return project;
  }

  function requireAdmin(request: Request, response: Response): boolean {
    const suppliedKey = request.header("x-crashlens-admin-key")?.trim();
    if (!suppliedKey || !valuesMatch(suppliedKey, adminApiKey)) {
      response.status(401).json({ error: "Invalid dashboard admin key" });
      return false;
    }
    return true;
  }

  async function requireManagedProject(
    request: Request,
    response: Response
  ): Promise<Project | null> {
    if (!requireAdmin(request, response)) return null;
    const project = await repository.getProject(String(request.params.projectId ?? ""));
    if (!project) {
      response.status(404).json({ error: "Project not found" });
      return null;
    }
    return project;
  }

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", storage: repository.storageName });
  });

  app.post("/demo/checkout", async (request, response) => {
    const result = demoCheckoutSchema.safeParse(request.body);
    if (!result.success) {
      response.status(400).json({ code: "INVALID_TEST", message: "Invalid checkout test" });
      return;
    }

    const { scenario, product, paymentMethod, customerId } = result.data;
    const delay = scenario === "timeout" ? 2_500 : 180;
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (scenario === "success") {
      response.json({
        ok: true,
        orderId: `CARTLY-${Date.now().toString().slice(-8)}`,
        product,
        paymentMethod,
        customerId
      });
      return;
    }
    if (scenario === "malformed-response") {
      response.json({ ok: true, paymentStatus: "paid" });
      return;
    }

    const failures = {
      "payment-declined": [402, "PAYMENT_DECLINED", "Payment was declined by the sandbox bank"],
      "gateway-down": [503, "GATEWAY_UNAVAILABLE", "bKash payment gateway is unavailable"],
      timeout: [504, "CHECKOUT_TIMEOUT", "Checkout server took too long to respond"],
      "out-of-stock": [409, "OUT_OF_STOCK", `${product} became out of stock during checkout`],
      "session-expired": [401, "SESSION_EXPIRED", "Customer checkout session expired"],
      "invalid-coupon": [422, "INVALID_COUPON", "Coupon SAVE50 is no longer valid"]
    } as const;
    const [status, code, message] = failures[scenario];
    response.status(status).json({ ok: false, code, message });
  });

  app.post("/api/v1/events", async (request, response) => {
    const project = await requireProject(request, response);
    if (!project) return;

    const result = capturedEventSchema.safeParse(request.body);
    if (!result.success) {
      response.status(400).json({
        error: "Invalid error event",
        details: result.error.flatten()
      });
      return;
    }

    const event: CapturedEvent = {
      ...result.data,
      timestamp: result.data.timestamp ?? new Date().toISOString(),
      url: removeQueryString(result.data.url),
      context: redactSensitiveData(result.data.context ?? {}) as Record<string, unknown>
    };
    const fingerprint = createFingerprint(event.type, event.message, event.stack);
    const { issue, transition } = await repository.recordEvent(
      project,
      event,
      fingerprint,
      findCulprit(event.stack)
    );

    if (transition) {
      const isRegression = transition === "regression";
      const alert = await repository.createAlert(
        project.id,
        issue.id,
        transition,
        isRegression ? `Regression: ${issue.title}` : `New issue: ${issue.title}`,
        isRegression
          ? `A resolved issue returned in ${issue.latestRelease ?? "an unknown release"}.`
          : `CrashLens grouped the first occurrence from ${issue.culprit ?? "an unknown source"}.`
      );
      void deliverAlert(repository, alert, alertOptions);
    }

    response.status(202).json({ accepted: true, issue });
  });

  app.get("/api/v1/admin/projects", async (request, response) => {
    if (!requireAdmin(request, response)) return;
    response.json({ projects: await repository.listProjects() });
  });

  app.post("/api/v1/admin/projects", async (request, response) => {
    if (!requireAdmin(request, response)) return;
    const result = projectCreateSchema.safeParse(request.body);
    if (!result.success) {
      response.status(400).json({ error: "Project name must contain 2 to 100 characters" });
      return;
    }
    const apiKey = createProjectApiKey();
    const project = await repository.createProject(
      result.data.name,
      createSlug(result.data.name),
      apiKey
    );
    response.status(201).json({ project, apiKey });
  });

  app.post("/api/v1/admin/projects/:projectId/rotate-key", async (request, response) => {
    if (!requireAdmin(request, response)) return;
    const apiKey = createProjectApiKey();
    const rotated = await repository.rotateProjectApiKey(request.params.projectId, apiKey);
    if (!rotated) {
      response.status(404).json({ error: "Project not found" });
      return;
    }
    response.json({ apiKey });
  });

  app.get("/api/v1/admin/projects/:projectId/issues", async (request, response) => {
    const project = await requireManagedProject(request, response);
    if (!project) return;
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    const allowedStatus = ["unresolved", "resolved", "ignored", "regressed"].includes(status ?? "")
      ? (status as "unresolved" | "resolved" | "ignored" | "regressed")
      : undefined;
    response.json({ project, issues: await repository.listIssues(project.id, allowedStatus) });
  });

  app.get("/api/v1/admin/projects/:projectId/issues/:issueId", async (request, response) => {
    const project = await requireManagedProject(request, response);
    if (!project) return;
    const issue = await repository.getIssue(project.id, request.params.issueId);
    if (!issue) {
      response.status(404).json({ error: "Issue not found" });
      return;
    }
    response.json({ project, issue });
  });

  app.patch(
    "/api/v1/admin/projects/:projectId/issues/:issueId/status",
    async (request, response) => {
      const project = await requireManagedProject(request, response);
      if (!project) return;
      const result = statusUpdateSchema.safeParse(request.body);
      if (!result.success) {
        response.status(400).json({ error: "Invalid issue status" });
        return;
      }
      const issue = await repository.updateIssueStatus(
        project.id,
        request.params.issueId,
        result.data.status
      );
      if (!issue) {
        response.status(404).json({ error: "Issue not found" });
        return;
      }
      response.json({ issue });
    }
  );

  app.get("/api/v1/admin/projects/:projectId/stats", async (request, response) => {
    const project = await requireManagedProject(request, response);
    if (!project) return;
    response.json({ project, stats: await repository.getStats(project.id) });
  });

  app.get("/api/v1/admin/projects/:projectId/alerts", async (request, response) => {
    const project = await requireManagedProject(request, response);
    if (!project) return;
    response.json({ project, alerts: await repository.listAlerts(project.id) });
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "Route not found" });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "Internal server error" });
  });

  return app;
}
