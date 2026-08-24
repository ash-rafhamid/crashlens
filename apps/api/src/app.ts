import "dotenv/config";
import { buildApp } from "./build-app.js";
import { createRepository } from "./create-repository.js";

const repository = await createRepository();
const app = buildApp(repository);

export { repository };
export default app;
