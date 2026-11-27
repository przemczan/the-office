import type { Check } from "../../check.ts";
import { apiKeySignInCheck } from "./api-key-sign-in.ts";
import { autoMemoryCheck } from "./auto-memory.ts";
import { backgroundTasksCheck } from "./background-tasks.ts";
import { deferredOfficeToolsCheck } from "./deferred-office-tools.ts";
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
import { sessionCarryOverCheck } from "./session-carry-over.ts";
import { turnUsageCheck } from "./turn-usage.ts";
import { usageReadAloneCheck } from "./usage-read-alone.ts";
import { usageWindowRefusalCheck } from "./usage-window-refusal.ts";
import { windowStartCheck } from "./window-start.ts";

/** The engine behaviours of spec §5.4 the Office builds on. */
export const engineChecks: readonly Check[] = [
  priorityNextCheck,
  priorityLaterCheck,
  priorityNowCheck,
  interruptCheck,
  officeToolCheck,
  longOfficeToolCheck,
  deferredOfficeToolsCheck,
  decisionWaitCheck,
  resumeCacheCheck,
  sessionCarryOverCheck,
  rateLimitEventCheck,
  usageWindowRefusalCheck,
  usageReadAloneCheck,
  windowStartCheck,
  apiKeySignInCheck,
  parallelSessionsCheck,
  leanOptionsCheck,
  autoMemoryCheck,
  turnUsageCheck,
  lspToolCheck,
  backgroundTasksCheck,
  foregroundSubAgentsCheck,
];
