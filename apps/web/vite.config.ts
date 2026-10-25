import { designSystem } from "@the-office/ui/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), designSystem()],
  // "source" reads workspace packages such as @the-office/contracts from their src/, unbuilt.
  resolve: { conditions: ["source", ...defaultClientConditions] },
});
