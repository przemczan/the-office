import { describe, expect, it } from "vitest";
import { defaultPromptTexts } from "../../../prompt-templates/index.js";
import { ENGINE_PROMPT_TEMPLATES } from "../../domain/engine-prompt-templates.js";
import type { ListedSkill } from "../skills/listed-skills.js";
import { codexInstructions } from "./codex-engine.js";

const RULES =
  "Create and change files with apply_patch, never with a shell command. A command, file change or tool call of yours that is declined was refused by the Office rules, the rules this workspace holds every Agent to; a note follows with the rule's words.";
const LEAD =
  "Skills: when a task matches one of these, load it with the Skill tool of the office MCP server before you start, then follow its instructions.";

function skill(name: string, description: string, userOnly = false): ListedSkill {
  return { name, description, file: `/s/${name}/SKILL.md`, folder: `/s/${name}`, userOnly };
}

const CASES: readonly {
  readonly name: string;
  readonly instructions: string;
  readonly skills: readonly ListedSkill[];
  readonly text: string;
}[] = [
  { name: "nothing", instructions: "", skills: [], text: RULES },
  {
    name: "instructions only",
    instructions: "Be brief.",
    skills: [],
    text: `Be brief.\n\n${RULES}`,
  },
  {
    name: "blank instructions are left out",
    instructions: "  \n",
    skills: [],
    text: RULES,
  },
  {
    name: "a skill without a description",
    instructions: "",
    skills: [skill("review", "")],
    text: `${LEAD}\n- review\n\n${RULES}`,
  },
  {
    name: "a skill with a description",
    instructions: "",
    skills: [skill("review", "Reviews a change.")],
    text: `${LEAD}\n- review: Reviews a change.\n\n${RULES}`,
  },
  {
    name: "skills and instructions, one only the user runs",
    instructions: "Be brief.",
    skills: [skill("a", "First {{x}} & <y>."), skill("hidden", "No.", true), skill("b", "")],
    text: `Be brief.\n\n${LEAD}\n- a: First {{x}} & <y>.\n- b\n\n${RULES}`,
  },
  {
    name: "only skills the user runs",
    instructions: "",
    skills: [skill("hidden", "No.", true)],
    text: RULES,
  },
];

describe("codexInstructions", () => {
  it.each(CASES)("writes $name", ({ instructions, skills, text }) => {
    expect(
      codexInstructions(defaultPromptTexts(ENGINE_PROMPT_TEMPLATES), instructions, skills),
    ).toBe(text);
  });
});
