/**
 * The card an Idea captured in a Thread shows as there (spec §2.2). Conversations keeps the
 * Thread's log; the composition root binds it.
 */
export abstract class IdeaCards {
  /** Posts the Idea's card in the Thread the user talks in whose engine session is `sessionId`. */
  abstract postIdeaCard(sessionId: string, ideaId: string): Promise<void>;
}
