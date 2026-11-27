import { mergeConfig } from "vite";
import { defineProject } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  // Isolated, unlike the service's tests: files swap shared modules with vi.mock, which a module
  // another file already loaded in the same worker wouldn't see (apps/service/docs/testing.md).
  defineProject({
    test: {
      name: "web",
      environment: "jsdom",
      setupFiles: ["./vitest.setup.ts"],
      // As the service's: a busy workstation slows tests past vitest's defaults.
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  }),
);
