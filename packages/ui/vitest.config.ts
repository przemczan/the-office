import { defineConfig } from "vitest/config";
import { designSystem } from "./src/vite.js";

export default defineConfig({
  plugins: [designSystem()],
  test: { environment: "jsdom" },
});
