import type { Check } from "../../check.ts";
import { copilotSignInCheck, copilotUsageCheck } from "./account.ts";
import { copilotBackgroundTasksCheck } from "./background-tasks.ts";
import {
  copilotHookAfterResumeCheck,
  copilotHookRefusalCheck,
  copilotHookSeesEveryCallCheck,
} from "./hooks.ts";
import { copilotImagesCheck } from "./images.ts";
import { copilotInterruptCheck } from "./interrupt.ts";
import { copilotMcpServersCheck } from "./mcp-servers.ts";
import { copilotPriorityLaterCheck, copilotPriorityNextCheck } from "./message-priority.ts";
import { copilotOutputSchemaCheck } from "./output-schema.ts";
import { copilotResumeCheck } from "./resume.ts";
import { copilotSkillCommandCheck, copilotSkillsCheck } from "./skills.ts";
import { copilotStartCheck } from "./start.ts";
import { copilotSubAgentsCheck } from "./sub-agents.ts";
import { copilotToolsCheck } from "./tools.ts";

/**
 * The Copilot engine's runs on the pinned `@microsoft/copilot-sdk` and the Copilot CLI runtime it
 * bundles; each is skipped without a token in `COPILOT_GITHUB_TOKEN`.
 */
export const copilotChecks: readonly Check[] = [
  copilotStartCheck,
  copilotHookRefusalCheck,
  copilotHookSeesEveryCallCheck,
  copilotHookAfterResumeCheck,
  copilotToolsCheck,
  copilotMcpServersCheck,
  copilotResumeCheck,
  copilotPriorityNextCheck,
  copilotPriorityLaterCheck,
  copilotInterruptCheck,
  copilotImagesCheck,
  copilotSkillsCheck,
  copilotSkillCommandCheck,
  copilotSubAgentsCheck,
  copilotBackgroundTasksCheck,
  copilotOutputSchemaCheck,
  copilotSignInCheck,
  copilotUsageCheck,
];
