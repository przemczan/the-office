import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each app and package is its own project, using its own vitest.config.ts when it has one.
    // tools/* stay out: they run their node:test suites on Node type stripping.
    projects: ["apps/*", "packages/*"],
    passWithNoTests: true,
    // A service test file boots a Nest app with Postgres connections and may spawn git or shells, so
    // vitest's default of a worker per core but one starves them all: timers fire seconds late and
    // tests time out. Half the cores keeps the run's time and leaves the CPU to what workers start.
    maxWorkers: "50%",
  },
});
