import { mergeConfig } from "vite";
import { defineProject } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineProject({
    test: { name: "web", environment: "jsdom", setupFiles: ["./vitest.setup.ts"] },
  }),
);
