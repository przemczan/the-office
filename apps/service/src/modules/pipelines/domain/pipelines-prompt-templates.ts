import type { PromptTemplate } from "../../prompt-templates/index.js";
import { BRIEF_COMMANDS } from "./allowed-commands.js";
import { AGENT_STAGE_THREAD_INSTRUCTIONS } from "./agent-stage-brief.js";
import { AGENT_STAGE_BRIEF_TEMPLATES } from "./agent-stage-brief-templates.js";
import { HARD_SWITCHES } from "./followed-hard-switches.js";
import { RESOLVE_AFTER_GATE, RESOLVE_AFTER_TEST, RESOLVE_BRIEF } from "./resolve-stages.js";
import { BRANCH_NEWS } from "./stage-commit.js";
import { RESULT_CORRECTION } from "./stage-result.js";

/** Every Prompt template Pipelines renders, which it registers at start. */
export const PIPELINES_PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  RESOLVE_BRIEF,
  RESOLVE_AFTER_TEST,
  RESOLVE_AFTER_GATE,
  AGENT_STAGE_THREAD_INSTRUCTIONS,
  ...AGENT_STAGE_BRIEF_TEMPLATES,
  RESULT_CORRECTION,
  HARD_SWITCHES,
  BRIEF_COMMANDS,
  BRANCH_NEWS,
];
