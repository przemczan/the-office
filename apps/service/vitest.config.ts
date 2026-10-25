import swc from "unplugin-swc";
import { defaultServerConditions } from "vite";
import { defineProject } from "vitest/config";

export default defineProject({
  // SWC emits the decorator metadata Nest's dependency injection reads, with flags from tsconfig.json.
  plugins: [swc.vite()],
  ssr: {
    resolve: {
      // "source" reads workspace packages from src/. "module" goes: Vite resolves externalized
      // packages with these conditions too, and some "module" builds are for bundlers only
      // (@opentelemetry/semantic-conventions imports directories), which Node then fails to load.
      conditions: [
        "source",
        ...defaultServerConditions.filter((condition) => condition !== "module"),
      ],
    },
  },
  test: {
    name: "service",
    environment: "node",
    // The cache keys miss tsconfig.json, so a changed decorator flag would keep stale transforms.
    fsModuleCache: false,
    // A throwaway database for the run, on the Postgres DATABASE_URL names (test/test-database.ts).
    globalSetup: ["./test/test-database.global-setup.ts"],
  },
});
