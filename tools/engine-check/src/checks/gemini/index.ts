import type { Check } from "../../check.ts";
import {
  geminiHookRefusalCheck,
  geminiHookSeesEveryCallCheck,
  geminiHookUnreachableCheck,
} from "./permissions.ts";
import {
  geminiApiKeyCheck,
  geminiBargeInCheck,
  geminiGoogleSignInCheck,
  geminiInterruptCheck,
  geminiResumeCheck,
  geminiStartCheck,
} from "./session.ts";
import {
  geminiContextUsageCheck,
  geminiLanguageServersCheck,
  geminiMcpServersCheck,
  geminiOfficeToolBargeInCheck,
  geminiOfficeToolsCheck,
  geminiOutputSchemaCheck,
  geminiSkillsCheck,
  geminiUsageWindowsCheck,
} from "./tools.ts";

/**
 * The Gemini CLI engine's runs on the pinned `@google/gemini-cli`, over ACP and headless side by side,
 * signed in with the API key `ENGINE_CHECK_GEMINI_API_KEY_FILE` names; each is skipped without it, and
 * `gemini.google-sign-in` until `--gemini-sign-in` has signed the check's folder in.
 */
export const geminiChecks: readonly Check[] = [
  geminiApiKeyCheck,
  geminiGoogleSignInCheck,
  geminiStartCheck,
  geminiResumeCheck,
  geminiInterruptCheck,
  geminiBargeInCheck,
  geminiHookSeesEveryCallCheck,
  geminiHookRefusalCheck,
  geminiHookUnreachableCheck,
  geminiOfficeToolsCheck,
  geminiOfficeToolBargeInCheck,
  geminiOutputSchemaCheck,
  geminiSkillsCheck,
  geminiMcpServersCheck,
  geminiContextUsageCheck,
  geminiUsageWindowsCheck,
  geminiLanguageServersCheck,
];
