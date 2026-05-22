import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shri/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
      "@shri/storage": path.resolve(__dirname, "../../packages/storage/src/index.ts"),
      "@shri/ai": path.resolve(__dirname, "../../packages/ai/src/index.ts"),
      "@shri/prompts-fs": path.resolve(__dirname, "../../packages/prompts-fs/src/index.ts"),
      "@shri/tools": path.resolve(__dirname, "../../packages/tools/index.ts"),
      "@shri/orchestrator": path.resolve(__dirname, "../../packages/orchestrator/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
