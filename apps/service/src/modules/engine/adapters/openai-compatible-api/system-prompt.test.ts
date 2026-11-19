import { describe, expect, it } from "vitest";
import { defaultPromptTexts } from "../../../prompt-templates/index.js";
import { ENGINE_PROMPT_TEMPLATES } from "../../domain/engine-prompt-templates.js";
import { systemPrompt, type SystemPromptParts } from "./system-prompt.js";

const BASE_LINES = (folder: string, operatingSystem: string, ending: string): string =>
  [
    "You are an Agent working in The Office, on the user's computer.",
    `Your working folder is ${folder}, on ${operatingSystem}. Give tools absolute paths.`,
    "Use the tools to read, search and change files; read a file before you edit or overwrite it. Run commands with the shell tools.",
    "Every tool call is judged by The Office's rules before it runs. When a call is refused, the result says why; don't work around the refusal.",
    "A message in <task-notification> tags is not the user: it tells you a background command has ended.",
    ending,
  ].join("\n");

const PLAIN = "When the work is done, reply in plain words.";
const SCHEMA =
  "When the work is done, call StructuredOutput with your answer; that ends your turn.";
const INTRO =
  "Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.";

const PARTS: SystemPromptParts = {
  folder: "/work/app",
  operatingSystem: "Linux",
  projectInstructions: [],
  instructions: "",
  answersInSchema: false,
};

const CASES: readonly {
  readonly name: string;
  readonly parts: Partial<SystemPromptParts>;
  readonly content: string;
}[] = [
  {
    name: "plain answer, nothing else",
    parts: {},
    content: BASE_LINES("/work/app", "Linux", PLAIN),
  },
  {
    name: "answers in the schema",
    parts: { answersInSchema: true },
    content: BASE_LINES("/work/app", "Linux", SCHEMA),
  },
  {
    name: "another system and folder",
    parts: { folder: "C:\\Work\\app", operatingSystem: "Windows" },
    content: BASE_LINES("C:\\Work\\app", "Windows", PLAIN),
  },
  {
    name: "one instruction file",
    parts: { projectInstructions: [{ path: "/work/app/CLAUDE.md", text: "Use tabs." }] },
    content: `${BASE_LINES("/work/app", "Linux", PLAIN)}\n\n${INTRO}\n\nContents of /work/app/CLAUDE.md (project instructions, checked into the codebase):\n\nUse tabs.`,
  },
  {
    name: "several instruction files",
    parts: {
      projectInstructions: [
        { path: "/work/app/CLAUDE.md", text: "Use tabs.\n\nSecond paragraph." },
        { path: "/work/app/.claude/rules/a.md", text: "Rule A." },
      ],
    },
    content: `${BASE_LINES("/work/app", "Linux", PLAIN)}\n\n${INTRO}\n\nContents of /work/app/CLAUDE.md (project instructions, checked into the codebase):\n\nUse tabs.\n\nSecond paragraph.\n\nContents of /work/app/.claude/rules/a.md (project instructions, checked into the codebase):\n\nRule A.`,
  },
  {
    name: "Role instructions only",
    parts: { instructions: "Be brief.\nBe kind." },
    content: `${BASE_LINES("/work/app", "Linux", PLAIN)}\n\nBe brief.\nBe kind.`,
  },
  {
    name: "everything",
    parts: {
      answersInSchema: true,
      projectInstructions: [{ path: "/work/app/CLAUDE.md", text: "Use tabs." }],
      instructions: "Be brief.",
    },
    content: `${BASE_LINES("/work/app", "Linux", SCHEMA)}\n\n${INTRO}\n\nContents of /work/app/CLAUDE.md (project instructions, checked into the codebase):\n\nUse tabs.\n\nBe brief.`,
  },
  {
    name: "text with braces and ampersands is kept as it is",
    parts: {
      folder: "/work/{{a}} & <b>",
      projectInstructions: [{ path: "/p/CLAUDE.md", text: 'Use {{x}} & <y> "z"' }],
    },
    content: `${BASE_LINES("/work/{{a}} & <b>", "Linux", PLAIN)}\n\n${INTRO}\n\nContents of /p/CLAUDE.md (project instructions, checked into the codebase):\n\nUse {{x}} & <y> "z"`,
  },
];

describe("systemPrompt", () => {
  it.each(CASES)("writes $name", ({ parts, content }) => {
    const message = systemPrompt(defaultPromptTexts(ENGINE_PROMPT_TEMPLATES), {
      ...PARTS,
      ...parts,
    });
    expect(message.role).toBe("system");
    expect(message.content).toBe(content);
  });
});
