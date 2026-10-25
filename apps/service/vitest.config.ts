import swc from "unplugin-swc";
import { defaultServerConditions } from "vite";
import { defineProject } from "vitest/config";

export default defineProject({
  // SWC emits the decorator metadata Nest's dependency injection reads, with flags from tsconfig.json.
  plugins: [swc.vite()],
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  test: {
    name: "service",
    environment: "node",
    // The cache keys miss tsconfig.json, so a changed decorator flag would keep stale transforms.
    fsModuleCache: false,
  },
});
