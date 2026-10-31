import type { Check } from "../../check.ts";
import { fileToolFenceCheck } from "./file-tool-fence.ts";
import { hookAfterResumeCheck } from "./hook-after-resume.ts";
import { hookRefusalCheck } from "./hook-refusal.ts";
import { hookSeesEveryCallCheck } from "./hook-sees-every-call.ts";
import { powerShellTwinCheck } from "./powershell-twin.ts";
import { protectedPathsCheck } from "./protected-paths.ts";
import { readFenceOffCheck } from "./read-fence-off.ts";

/** The permission build rules of spec §6, and how the engine treats the Office's one PreToolUse hook. */
export const permissionsChecks: readonly Check[] = [
  hookSeesEveryCallCheck,
  hookRefusalCheck,
  powerShellTwinCheck,
  fileToolFenceCheck,
  readFenceOffCheck,
  protectedPathsCheck,
  hookAfterResumeCheck,
];
