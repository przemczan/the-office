/** The user who asked, as they were signed in. */
export interface TestTargetsChatAsker {
  readonly userId: string;
  readonly name: string;
}

/**
 * A chat Thread the Project page asked to set up the Project's test targets in (spec §2.12, "Set
 * up test targets"): with whoever held "Onboards and repairs Projects" then, on the base checkout,
 * with no Task and no worktree. The newest asked is the one the page follows.
 */
export interface TestTargetsChat {
  readonly projectId: string;
  readonly threadId: string;
  /** The person asked, by the key of their Role. */
  readonly roleKey: string;
  readonly askedBy: TestTargetsChatAsker;
  readonly askedAt: Date;
}

/** Where the chat stands, as the Project page's card shows it. */
export type TestTargetsChatState = "draft" | "answering" | "waiting-on-you" | "proposal";

/** A `test-targets` Proposal of the Project drafted in the chat. */
export interface TestTargetsChatProposal {
  readonly open: boolean;
  readonly draftedAt: Date;
}

/** What the chat's Thread holds now, as Conversations reads it. */
export interface TestTargetsChatThread {
  /** The person's turn is running. */
  readonly answering: boolean;
  /** When the user last wrote in it; undefined before they did. */
  readonly lastUserMessageAt: Date | undefined;
  /** When anything was last logged in it; undefined while nothing was. */
  readonly lastMessageAt: Date | undefined;
  /** The Thread's `test-targets` Proposals of this Project, in any order. */
  readonly proposals: readonly TestTargetsChatProposal[];
}

/** The chat followed, with its state and since when; or ended. */
export type TestTargetsChatStanding =
  | { readonly kind: "going"; readonly state: TestTargetsChatState; readonly since: Date }
  | { readonly kind: "ended" };

/**
 * Where the chat stands: its open `test-targets` Proposal first; ended once one was applied or
 * dismissed with none open, or once its Thread is gone; else answering while the person's turn
 * runs, a draft while nothing was logged, and waiting on the user after the person replied.
 */
export function testTargetsChatStanding(
  chat: TestTargetsChat,
  thread: TestTargetsChatThread | undefined,
): TestTargetsChatStanding {
  if (!thread) return { kind: "ended" };
  const open = thread.proposals
    .filter((proposal) => proposal.open)
    .toSorted((a, b) => b.draftedAt.getTime() - a.draftedAt.getTime())[0];
  if (open) return { kind: "going", state: "proposal", since: open.draftedAt };
  if (thread.proposals.length > 0) return { kind: "ended" };
  if (thread.answering) {
    return { kind: "going", state: "answering", since: thread.lastUserMessageAt ?? chat.askedAt };
  }
  if (!thread.lastMessageAt) return { kind: "going", state: "draft", since: chat.askedAt };
  return { kind: "going", state: "waiting-on-you", since: thread.lastMessageAt };
}

/** As long as a Thread's title may be (Conversations' `TITLE_LENGTH`). */
const CHAT_TITLE_LENGTH = 80;

/**
 * The chat Thread's title, as the user's chat lists it; a name too long for a Thread's title is
 * cut with an ellipsis.
 */
export function testTargetsChatTitle(projectName: string): string {
  const title = `Set up test targets: ${projectName.trim()}`;
  return title.length <= CHAT_TITLE_LENGTH ? title : `${title.slice(0, CHAT_TITLE_LENGTH - 1)}…`;
}

/** Why Ask can't start a chat while nobody holds the duty. */
export const NOBODY_ONBOARDS_PROJECTS =
  "Nobody onboards Projects yet: give Onboards and repairs Projects to someone in People.";

/** Why Ask again waits while the followed chat's Proposal is open. */
export const TEST_TARGETS_PROPOSAL_OPEN =
  "The test targets Proposal in the chat is still open: apply or dismiss it first.";
