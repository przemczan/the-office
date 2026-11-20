import type { Check } from "../../check.ts";
import {
  geminiHookUnreachableCheck,
  geminiRepositorySettingsCheck,
  geminiToolsAndRulesCheck,
} from "./permissions.ts";
import {
  geminiInterruptCheck,
  geminiPriorityLaterCheck,
  geminiPriorityNextCheck,
  geminiQuotaRefusalCheck,
  geminiResumeCheck,
  geminiStartCheck,
} from "./session.ts";
import {
  geminiContextUsageCheck,
  geminiLanguageServersCheck,
  geminiMcpToolCheck,
  geminiOfficeToolCheck,
  geminiOutputSchemaCheck,
  geminiSkillsCheck,
} from "./tools.ts";

/**
 * The Gemini CLI engine's runs on the pinned `@google/gemini-cli`, wired as the Gemini CLI adapter
 * wires a session (spec §5.4.7), signed in with the API key `ENGINE_CHECK_GEMINI_API_KEY_FILE`
 * names; each is skipped without it.
 */
export const geminiChecks: readonly Check[] = [
  geminiStartCheck,
  geminiToolsAndRulesCheck,
  geminiRepositorySettingsCheck,
  geminiHookUnreachableCheck,
  geminiOfficeToolCheck,
  geminiMcpToolCheck,
  geminiSkillsCheck,
  geminiInterruptCheck,
  geminiResumeCheck,
  geminiPriorityNextCheck,
  geminiPriorityLaterCheck,
  geminiOutputSchemaCheck,
  geminiContextUsageCheck,
  geminiQuotaRefusalCheck,
  geminiLanguageServersCheck,
];
