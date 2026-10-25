import { defineConfig } from "vitest/config";
import { designSystem } from "./src/vite.ts";

export default defineConfig({
  plugins: [designSystem()],
  test: { environment: "jsdom" },
});
