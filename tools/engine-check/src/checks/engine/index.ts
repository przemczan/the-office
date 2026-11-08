import type { Check } from "../../check.ts";
import { autoMemoryCheck } from "./auto-memory.ts";
import { decisionWaitCheck } from "./decision-wait.ts";
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
  parallelSessionsCheck,
  leanOptionsCheck,
  autoMemoryCheck,
  turnUsageCheck,
  lspToolCheck,
];
