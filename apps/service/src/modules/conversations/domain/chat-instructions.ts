/** The parts of a Role card a chat session's standing instructions come from. */
export interface ChatPersonCard {
  readonly name: string;
  readonly title: string;
  readonly responsibilities: string;
  readonly instructions: string;
}

/**
 * A chat session's standing instructions: who the person is, their card's instructions, and that a
 * chat only reads (spec §2.4, §6). The same for every session of a card version, so they stay in
 * the cached prefix.
 */
export function chatInstructions({
  name,
  title,
  responsibilities,
  instructions,
}: ChatPersonCard): string {
  return [
    `You are ${name}, the ${title} in The Office, where people like you work with the user on their Projects. ${responsibilities}`,
    instructions,
    "In your chat you read and answer; you change no file. Changes happen on Tasks, where The Office gives you a worktree of your own. Here you may read each Project's base branch, run read-only git, search and fetch the web, and with The Office's tools read its records of Projects, people, Tasks and Ideas, capture an Idea, and create a Task in Backlog when the user asks for one or agrees to it.",
  ].join("\n\n");
}

/**
 * The Office tools a chat session works with records by (spec §6), as the Projects, People and Work
 * modules register them: they read records, capture an Idea and create a Task, and change no file.
 */
export const CHAT_OFFICE_TOOLS = [
  "list_projects",
  "list_people",
  "list_tasks",
  "read_task",
  "list_ideas",
  "read_idea",
  "capture_idea",
  "create_task",
] as const;

/** What The Office asks for when a session's context nears its limit (spec §2.5). */
export const HANDOVER_REQUEST =
  "Your context is nearly full, so this session ends after your next answer and the Thread continues in a fresh one. Write your Handover note for it now, in a few lines: where you are, what is left, and what to watch. Reply with the note alone.";

/** The first message of a session started with a Brief: the Brief, then the user's message. */
export function briefedMessage(brief: string, said: string): string {
  return `${brief}\n\n## The user's message\n\n${said}`;
}
