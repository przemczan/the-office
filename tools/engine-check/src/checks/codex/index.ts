import type { Check } from "../../check.ts";
import { codexApprovalsCheck } from "./approvals.ts";
import { codexBargeInCheck } from "./barge-in.ts";
import { codexInterruptCheck } from "./interrupt.ts";
import { codexOfficeToolCheck } from "./office-tool.ts";
import { codexOutputSchemaCheck } from "./output-schema.ts";
import { codexResumeCheck } from "./resume.ts";
import { codexSandboxCheck } from "./sandbox.ts";
import { codexStartCheck } from "./start.ts";
import { codexUsageReadAloneCheck } from "./usage-read-alone.ts";
import { codexUsageReadingCheck } from "./usage-reading.ts";

/**
 * The Codex engine's runs (spec §5.4 Defaults, the Codex engine) on the pinned `codex app-server`,
 * with the account folder `--codex-home` names; each is skipped without a signed-in folder.
 */
export const codexChecks: readonly Check[] = [
  codexStartCheck,
  codexApprovalsCheck,
  codexSandboxCheck,
  codexOfficeToolCheck,
  codexOutputSchemaCheck,
  codexUsageReadingCheck,
  codexUsageReadAloneCheck,
  codexInterruptCheck,
  codexResumeCheck,
  codexBargeInCheck,
];
