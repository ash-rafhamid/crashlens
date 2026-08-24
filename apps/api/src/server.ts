import "dotenv/config";
import { buildApp } from "./app.js";
import { createRepository } from "./create-repository.js";

const port = Number(process.env.PORT ?? 4000);
const repository = await createRepository();
const app = buildApp(repository);

const server = app.listen(port, () => {
  console.log(`CrashLens API listening on http://localhost:${port}`);
  console.log(`Storage: ${repository.storageName}`);
});

async function shutdown() {
  server.close(async () => {
    await repository.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
