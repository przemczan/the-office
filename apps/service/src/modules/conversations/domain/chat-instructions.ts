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
    "In your chat you read and answer; you change nothing. Changes happen on Tasks, where The Office gives you a worktree of your own. Here you may read each Project's base branch, run read-only git, and search and fetch the web.",
  ].join("\n\n");
}

/** What The Office asks for when a session's context nears its limit (spec §2.5). */
export const HANDOVER_REQUEST =
  "Your context is nearly full, so this session ends after your next answer and the Thread continues in a fresh one. Write your Handover note for it now, in a few lines: where you are, what is left, and what to watch. Reply with the note alone.";

/** The first message of a session started with a Brief: the Brief, then the user's message. */
export function briefedMessage(brief: string, said: string): string {
  return `${brief}\n\n## The user's message\n\n${said}`;
}
