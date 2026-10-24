import type { Check } from "../check.ts";
import { permissionsChecks } from "./permissions/index.ts";
import { skillsChecks } from "./skills/index.ts";

/** Every check, in run order. */
export const checks: readonly Check[] = [...skillsChecks, ...permissionsChecks];
