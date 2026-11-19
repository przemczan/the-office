/** The engine sessions Conversations runs; the composition root binds it. */
export abstract class SessionsRunning {
  /** How many engine sessions are working now, in Stages, chats and Threads. */
  abstract sessionsWorking(): Promise<number>;
}
