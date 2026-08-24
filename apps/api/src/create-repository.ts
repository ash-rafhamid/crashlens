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
  return repository;
}
