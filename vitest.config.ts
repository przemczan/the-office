import { defineConfig } from "vitest/config";
import { workersByIdleCpus } from "./idle-cpus.ts";

export default defineConfig({
  test: {
    // Each app and package is its own project, using its own vitest.config.ts when it has one.
    // tools/* stay out: they run their node:test suites on Node type stripping.
    projects: ["apps/*", "packages/*"],
    passWithNoTests: true,
    // A service test file boots a Nest app with Postgres connections and may spawn git or shells, so
    // vitest's default of a worker per core but one starves them all: timers fire seconds late and
    // tests time out. Half the idle cores keeps the run's time and leaves the CPU to what workers
    // start and to other runs beside this one (idle-cpus.ts).
    maxWorkers: workersByIdleCpus(),
    // Names every test that passed only on a retry (`npm run test` runs with `--retry=1`).
    reporters: ["default", "./retried-tests-reporter.ts"],
  },
});
