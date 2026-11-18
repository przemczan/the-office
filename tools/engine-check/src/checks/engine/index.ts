import type { Check } from "../../check.ts";
import { autoMemoryCheck } from "./auto-memory.ts";
import { backgroundTasksCheck } from "./background-tasks.ts";
import { decisionWaitCheck } from "./decision-wait.ts";
import { foregroundSubAgentsCheck } from "./foreground-sub-agents.ts";
import { interruptCheck } from "./interrupt.ts";
import { leanOptionsCheck } from "./lean-options.ts";
import { lspToolCheck } from "./lsp-tool.ts";
import { priorityLaterCheck, priorityNextCheck, priorityNowCheck } from "./message-priority.ts";
import { longOfficeToolCheck } from "./long-office-tool.ts";
import { officeToolCheck } from "./office-tool.ts";
import { parallelSessionsCheck } from "./parallel-sessions.ts";
import { rateLimitEventCheck } from "./rate-limit-event.ts";
import { resumeCacheCheck } from "./resume-cache.ts";
import { turnUsageCheck } from "./turn-usage.ts";
import { usageReadAloneCheck } from "./usage-read-alone.ts";
import { usageWindowRefusalCheck } from "./usage-window-refusal.ts";

/** The engine behaviours of spec §5.4 the Office builds on. */
export const engineChecks: readonly Check[] = [
  priorityNextCheck,
  priorityLaterCheck,
  priorityNowCheck,
  interruptCheck,
  officeToolCheck,
  longOfficeToolCheck,
  decisionWaitCheck,
  resumeCacheCheck,
  rateLimitEventCheck,
  usageWindowRefusalCheck,
  usageReadAloneCheck,
  parallelSessionsCheck,
  leanOptionsCheck,
  autoMemoryCheck,
  turnUsageCheck,
  lspToolCheck,
  backgroundTasksCheck,
  foregroundSubAgentsCheck,
];
