import { promptTemplate, type PromptTemplate } from "../../prompt-templates/index.domain.js";

/** What a declined call means, as a decline tells the model nothing more (spec §5.4 Defaults). */
export const DECLINED_CALLS =
  "A command, file change or tool call of yours that is declined was refused by the Office rules, the rules this workspace holds every Agent to; a note follows with the rule's words.";

/**
 * The Office rules judge a file change by what it changes and a command as a command, as on the
 * Claude Code engines, where Edit and Write change files: a file written by a command would be
 * refused under a profile that allows edits but only read-only commands.
 */
export const FILE_CHANGES = "Create and change files with apply_patch, never with a shell command.";

/** How Claude Code introduces the instruction files it loads. */
const INSTRUCTIONS_INTRO =
  "Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.";

/**
 * What every API engine session's conversation starts with: how the loop works and the Project's
 * instruction files. The Agent's own instructions follow it, joined by the engine. Nothing in it
 * changes between a session's requests, so the server can keep the prefix cached; the date is left
 * out for that reason.
 */
export const API_SYSTEM_PROMPT = promptTemplate({
  key: "engine.api-system-prompt",
  domain: "engine",
  name: "API engine system prompt",
  description:
    "The system prompt of a session on an OpenAI-compatible API engine: how the Agent works in The Office, how it ends its turn and the Project's instruction files, before the Agent's own instructions.",
  variables: {
    folder: { kind: "text", description: "The folder the session works in." },
    operatingSystem: {
      kind: "text",
      description: "The system the session runs on, such as Linux or Windows.",
    },
    answersInSchema: {
      kind: "flag",
      description: "Each turn ends in output given through the structured output tool.",
    },
    structuredOutputTool: {
      kind: "text",
      description: "The name of the tool that takes the turn's output.",
    },
    hasProjectInstructions: {
      kind: "flag",
      description: "The Project has instruction files in the folder.",
    },
    projectInstructions: {
      kind: "list",
      description: "The Project's instruction files in the folder, in order.",
      fields: { path: "The file's path.", text: "The file's contents." },
    },
  },
  text: `You are an Agent working in The Office, on the user's computer.
Your working folder is {{folder}}, on {{operatingSystem}}. Give tools absolute paths.
Use the tools to read, search and change files; read a file before you edit or overwrite it. Run commands with the shell tools.
Every tool call is judged by The Office's rules before it runs. When a call is refused, the result says why; don't work around the refusal.
A message in <task-notification> tags is not the user: it tells you a background command has ended.
{{#answersInSchema}}When the work is done, call {{structuredOutputTool}} with your answer; that ends your turn.{{/answersInSchema}}{{^answersInSchema}}When the work is done, reply in plain words.{{/answersInSchema}}{{#hasProjectInstructions}}

${INSTRUCTIONS_INTRO}{{#projectInstructions}}

Contents of {{path}} (project instructions, checked into the codebase):

{{text}}{{/projectInstructions}}{{/hasProjectInstructions}}`,
});

/**
 * What an API engine turn that must end in output is told when its model answers without calling
 * the structured output tool, as Claude Code reminds it within the turn.
 */
export const API_OUTPUT_REMINDER = promptTemplate({
  key: "engine.api-output-reminder",
  domain: "engine",
  name: "API engine output reminder",
  description:
    "What a session on an OpenAI-compatible API engine is told when its model ends a turn that must give output without giving it.",
  variables: {
    structuredOutputTool: {
      kind: "text",
      description: "The name of the tool that takes the turn's output.",
    },
  },
  text: "Your turn isn't over: call the {{structuredOutputTool}} tool with your answer, in the shape its input asks for.",
});

/**
 * What a Gemini CLI turn that must end in output is sent, as the next turn, when it ended without
 * the structured output tool's answer.
 */
export const GEMINI_OUTPUT_REMINDER = promptTemplate({
  key: "engine.gemini-output-reminder",
  domain: "engine",
  name: "Gemini CLI output reminder",
  description:
    "What a session on a Gemini CLI engine is told when its model ends a turn that must give output without giving it.",
  variables: {
    structuredOutputTool: {
      kind: "text",
      description: "The name the model calls the tool that takes the turn's output by.",
    },
  },
  text: "Your turn isn't over: call the {{structuredOutputTool}} tool with your answer, in the shape its input asks for.",
});

/**
 * What a Codex session's developer instructions hold besides the Agent's own: the skills the model
 * may load, how to change files and what a declined call means.
 */
export const CODEX_INSTRUCTIONS = promptTemplate({
  key: "engine.codex-instructions",
  domain: "engine",
  name: "Codex developer instructions",
  description:
    "What a Codex session is told besides the Agent's own instructions: the skills it may load, how to change files and what a declined call means.",
  variables: {
    officeToolServer: {
      kind: "text",
      description: "The name of the MCP server that serves the Skill tool.",
    },
    hasSkills: { kind: "flag", description: "The model may load at least one skill." },
    skills: {
      kind: "list",
      description: "The skills the model may load, by name.",
      fields: {
        name: "The skill's name, which the Skill tool takes.",
        description: "What the skill is for; empty when it has no description.",
        described: "Not empty when the skill has a description.",
      },
    },
  },
  text: `{{#hasSkills}}Skills: when a task matches one of these, load it with the Skill tool of the {{officeToolServer}} MCP server before you start, then follow its instructions.{{#skills}}
- {{name}}{{#described}}: {{description}}{{/described}}{{/skills}}

{{/hasSkills}}${FILE_CHANGES} ${DECLINED_CALLS}`,
});

/** Every Prompt template the Engine module renders, which it registers at start. */
export const ENGINE_PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  API_SYSTEM_PROMPT,
  API_OUTPUT_REMINDER,
  GEMINI_OUTPUT_REMINDER,
  CODEX_INSTRUCTIONS,
];
