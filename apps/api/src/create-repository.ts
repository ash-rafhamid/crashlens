import { hashPassword, normalizeEmail } from "./auth.js";
import { MemoryIssueRepository } from "./memory-repository.js";
import { PostgresIssueRepository } from "./postgres-repository.js";
import type { IssueRepository } from "./repository.js";

const DEFAULT_DEMO_KEY = "crashlens_demo_key_12345";

export async function createRepository(): Promise<IssueRepository> {
  const demoApiKey = process.env.CRASHLENS_DEMO_API_KEY ?? DEFAULT_DEMO_KEY;
  const repository: IssueRepository = process.env.DATABASE_URL
    ? new PostgresIssueRepository(process.env.DATABASE_URL, demoApiKey)
    : new MemoryIssueRepository(demoApiKey);

  await repository.initialize();

  const localDevelopment = !process.env.DATABASE_URL && process.env.NODE_ENV !== "production";
  const bootstrapEmail =
    process.env.CRASHLENS_BOOTSTRAP_EMAIL ?? (localDevelopment ? "admin@crashlens.local" : undefined);
  const bootstrapPassword =
    process.env.CRASHLENS_BOOTSTRAP_PASSWORD ?? (localDevelopment ? "crashlens-demo-admin" : undefined);
  if (bootstrapEmail && bootstrapPassword) {
    await repository.ensureBootstrapIdentity({
      name: process.env.CRASHLENS_BOOTSTRAP_NAME?.trim() || "CrashLens Admin",
      email: normalizeEmail(bootstrapEmail),
      passwordHash: await hashPassword(bootstrapPassword),
      workspaceName: process.env.CRASHLENS_BOOTSTRAP_WORKSPACE?.trim() || "CrashLens Workspace",
      workspaceSlug: "crashlens-workspace"
    });
  }

  return repository;
}
