import type { Check } from "../check.ts";
import { engineChecks } from "./engine/index.ts";
import { fallbackChecks } from "./fallback/index.ts";
import { permissionsChecks } from "./permissions/index.ts";
import { skillsChecks } from "./skills/index.ts";

/** Every check, in run order. */
export const checks: readonly Check[] = [
  ...skillsChecks,
  ...permissionsChecks,
  ...engineChecks,
  ...fallbackChecks,
];
