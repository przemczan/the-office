import { OFFICE_COMMANDS, type SkillCommand } from "@the-office/contracts";

/** A command a Thread's message box offers: one of The Office's own, or a skill's. */
export interface CommandChoice {
  readonly kind: "office" | "skill";
  readonly name: string;
  readonly description: string;
}

export const COMMAND_KIND_WORDS: Readonly<Record<CommandChoice["kind"], string>> = {
  office: "Office command",
  skill: "Skill command",
};

/**
 * The command name being typed: the draft starts with "/" and has no whitespace yet. Undefined for
 * anything else, which the "/" list leaves alone.
 */
export function commandQueryOf(draft: string): string | undefined {
  return /^\/(\S*)$/.exec(draft)?.[1];
}

/** Every command a Thread offers: the Office commands first, then its skill commands. */
export function commandChoices(skillCommands: readonly SkillCommand[]): CommandChoice[] {
  return [
    ...OFFICE_COMMANDS.map(({ name, description }) => ({
      kind: "office" as const,
      name,
      description,
    })),
    ...skillCommands.map(({ name, description }) => ({
      kind: "skill" as const,
      name,
      description,
    })),
  ];
}

/** The commands whose name starts with what is typed after "/", in `commandChoices`' order. */
export function matchingCommands(
  skillCommands: readonly SkillCommand[],
  query: string,
): CommandChoice[] {
  return commandChoices(skillCommands).filter(({ name }) => name.startsWith(query));
}

/** Why a skill named like an Office command never runs as a skill command. */
export function officeCommandClashWords(skillName: string): string {
  return `/${skillName} is an Office command, so the skill can't run as a skill command.`;
}
