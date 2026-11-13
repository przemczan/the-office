import type { Check } from "../../check.ts";
import { fallbackBackgroundTasksCheck } from "../engine/background-tasks.ts";
import { fallbackForegroundSubAgentsCheck } from "../engine/foreground-sub-agents.ts";
import { fallbackLongOfficeToolCheck } from "../engine/long-office-tool.ts";
import { fallbackHookUnreachableCheck } from "./hook-unreachable.ts";
import { fallbackInterruptCheck } from "./interrupt.ts";
import { fallbackPriorityLaterCheck, fallbackPriorityNextCheck } from "./message-priority.ts";
import { fallbackOfficeToolBargeInCheck } from "./office-tool-barge-in.ts";
import { fallbackOutputSchemaCheck } from "./output-schema.ts";
import { fallbackStartCheck } from "./start.ts";
import { fallbackToolsAndRulesCheck } from "./tools-and-rules.ts";

/** The `-p` fallback's runs (spec §5.4 Defaults): each capability of `EngineCapabilities` on the pinned binary. */
export const fallbackChecks: readonly Check[] = [
  fallbackStartCheck,
  fallbackToolsAndRulesCheck,
  fallbackHookUnreachableCheck,
  fallbackOutputSchemaCheck,
  fallbackInterruptCheck,
  fallbackPriorityNextCheck,
  fallbackOfficeToolBargeInCheck,
  fallbackLongOfficeToolCheck,
  fallbackPriorityLaterCheck,
  fallbackBackgroundTasksCheck,
  fallbackForegroundSubAgentsCheck,
];
