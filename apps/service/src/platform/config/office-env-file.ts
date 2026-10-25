import { fileURLToPath } from "node:url";

/**
 * The `.env` at The Office's root, which holds its config, the database credentials among it
 * (spec §6); the service's npm scripts load it. Five folders up from this file, in src/ and in
 * dist/ alike.
 */
export const OFFICE_ENV_FILE = fileURLToPath(new URL("../../../../../.env", import.meta.url));
