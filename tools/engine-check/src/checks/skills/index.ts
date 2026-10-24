import type { Check } from "../../check.ts";
import { allowlistSuffixCheck } from "./allowlist-suffix.ts";
import { denyRuleCheck } from "./deny-rule.ts";
import { overridesOffCheck } from "./overrides-off.ts";
import { pluginDetectionCheck } from "./plugin-detection.ts";
import { pluginFolderReadsCheck } from "./plugin-folder-reads.ts";
import { resumeCheck } from "./resume.ts";
import { startCheck } from "./start-check.ts";
import { userScopeCheck } from "./user-scope.ts";

/** The skills mechanism of spec §5.6; the questions come from the research's "Could not confirm" list. */
export const skillsChecks: readonly Check[] = [
  startCheck,
  allowlistSuffixCheck,
  pluginDetectionCheck,
  overridesOffCheck,
  userScopeCheck,
  pluginFolderReadsCheck,
  resumeCheck,
  denyRuleCheck,
];
