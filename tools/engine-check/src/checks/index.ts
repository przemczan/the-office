import type { Check } from "../check.ts";
import { skillsChecks } from "./skills/index.ts";

/** Every check, in run order. */
export const checks: readonly Check[] = [...skillsChecks];
