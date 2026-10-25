import { defineConfig } from "drizzle-kit";

// drizzle-kit only generates migrations (npm run db:generate); the service applies them at start.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/modules/*/adapters/**/*.schema.ts",
  out: "./drizzle",
});
