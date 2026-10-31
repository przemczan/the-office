import { designSystem } from "@the-office/ui/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), designSystem()],
  // "the-office-source" reads workspace packages such as @the-office/contracts from their src/,
  // unbuilt. A name of The Office's own: some packages offer a plain "source" too.
  resolve: { conditions: ["the-office-source", ...defaultClientConditions] },
});
