import swc from "unplugin-swc";
import { defaultServerConditions } from "vite";
import { defineProject } from "vitest/config";

export default defineProject({
  // SWC emits the decorator metadata Nest's dependency injection reads, with flags from tsconfig.json.
  plugins: [swc.vite()],
  ssr: {
    resolve: {
      // "the-office-source" reads workspace packages from src/; a name of The Office's own, since
      // Vite resolves externalized packages with these conditions too and some offer a plain
      // "source" in TypeScript (eventsource-parser), which Node won't strip under node_modules.
      // "module" goes for the same reason: some "module" builds are for bundlers only
      // (@opentelemetry/semantic-conventions imports directories), which Node then fails to load.
      conditions: [
        "the-office-source",
        ...defaultServerConditions.filter((condition) => condition !== "module"),
      ],
    },
  },
  test: {
    name: "service",
    environment: "node",
    // A busy workstation slows a test that takes seconds alone (a Nest app booting, git, Postgres)
    // past vitest's 5 s and 10 s defaults.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // A worker keeps the modules it loaded from one test file to the next: reloading Nest, the
    // engine SDKs and the app for every file was over half of the run. A test file must therefore
    // undo what it changes in a module's state (mocks, stubs, fake timers) before it ends.
    isolate: false,
    // A worker living the whole run lets V8 grow its heap toward its default limit before
    // collecting: workers reached 1.4 GB each and the run environment killed them for memory.
    // Most of it was garbage; at this limit a worker peaks near 600 MB.
    execArgv: ["--max-old-space-size=768"],
    // The cache keys miss tsconfig.json, so a changed decorator flag would keep stale transforms.
    fsModuleCache: false,
    // A throwaway database for the run, on the Postgres DATABASE_URL names (test/test-database.ts).
    globalSetup: ["./test/test-database.global-setup.ts"],
  },
});
