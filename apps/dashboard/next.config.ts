import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(currentDirectory, "../.."),
  ...(process.env.VERCEL ? {} : { output: "standalone" as const })
};

export default nextConfig;
