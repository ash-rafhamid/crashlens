import "dotenv/config";
import express from "express";
import { buildApp } from "./build-app.js";
import { createRepository } from "./create-repository.js";

const repository = await createRepository();
const app: ReturnType<typeof express> = buildApp(repository);

export { repository };
export default app;
