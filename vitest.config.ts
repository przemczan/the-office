import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each app and package is its own project, using its own vitest.config.ts when it has one.
    // tools/* stay out: the engine check runs its node:test suite on Node type stripping.
    projects: ["apps/*", "packages/*"],
    passWithNoTests: true,
  },
});
