/**
 * The card the Office status shows as in the Office Manager's chat (spec §2.2). Conversations keeps
 * the chat's log; the composition root binds it.
 */
export abstract class OfficeStatusCards {
  /** Posts the card in the chat whose engine session is `sessionId`; none outside a chat. */
  abstract postOfficeStatus(sessionId: string): Promise<void>;
}
