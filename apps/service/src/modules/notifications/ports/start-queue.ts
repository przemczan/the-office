import type { QueuedOnNow } from "../domain/now.js";

/** Work's one Office-wide queue for Start, first place first; the composition root binds it. */
export abstract class StartQueue {
  abstract list(): Promise<readonly QueuedOnNow[]>;
}
