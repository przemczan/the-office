/**
 * Whether the person in a Thread is working now, which Conversations keeps in memory: Plan the
 * Initiative and Plan with… open no new planning Thread while the latest one has a turn running.
 * The composition root binds it to Work's adapter over Conversations' ThreadService.
 */
export abstract class ThreadTurns {
  /**
   * Whether the Thread has a turn running now: from a message sent until its turn ends. A Thread
   * waiting for the user, or for a Decision's answer, has none; so has one The Office doesn't know.
   */
  abstract isTurnRunning(threadId: string): Promise<boolean>;
}
