import { z } from "zod";

/**
 * The commands of a Thread's message box (spec §2.4): a message is one only when "/" is its first
 * character and its first word names an Office command or one of the Thread's skill commands.
 * The web and the service both read a message with `messageCommand`, so they never disagree.
 */

/** A command The Office carries out itself, which never reaches the engine. */
export const OFFICE_COMMANDS = [
  { name: "clear", description: "Start the next message in a fresh session." },
  { name: "stop", description: "Stop the person answering now; the session is kept." },
  { name: "help", description: "List the commands you can use here." },
] as const;

export type OfficeCommandName = (typeof OFFICE_COMMANDS)[number]["name"];

/** A skill the user can run in a Thread's session by typing "/<name>". */
export const skillCommandSchema = z.object({ name: z.string(), description: z.string() });
export type SkillCommand = z.infer<typeof skillCommandSchema>;

export type MessageCommand =
  | { readonly kind: "office"; readonly name: OfficeCommandName }
  | { readonly kind: "skill"; readonly name: string; readonly input: string };

const COMMAND_PATTERN = /^\/(\S+)(?:\s+([\s\S]*))?$/;

/**
 * The command a message is, or undefined for an ordinary message. An Office command's name wins
 * over a skill of the same name.
 */
export function messageCommand(
  text: string,
  skillCommandNames: readonly string[],
): MessageCommand | undefined {
  const match = COMMAND_PATTERN.exec(text);
  if (match === null) return undefined;
  const name = match[1] ?? "";
  const input = (match[2] ?? "").trim();
  const officeCommand = OFFICE_COMMANDS.find((command) => command.name === name);
  if (officeCommand !== undefined) return { kind: "office", name: officeCommand.name };
  if (skillCommandNames.includes(name)) return { kind: "skill", name, input };
  return undefined;
}

/** Whether a skill's name is taken by an Office command, so the skill can't run as a command. */
export function officeCommandClash(skillName: string): boolean {
  return OFFICE_COMMANDS.some((command) => command.name === skillName);
}
