/**
 * The card an Idea captured in a chat shows as there (spec §2.2). Conversations keeps the chat's
 * log; the composition root binds it.
 */
export abstract class IdeaCards {
  /** Posts the Idea's card in the chat whose engine session is `sessionId`; none outside a chat. */
  abstract postIdeaCard(sessionId: string, ideaId: string): Promise<void>;
}
