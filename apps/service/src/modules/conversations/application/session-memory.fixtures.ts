import { NO_MEMORY, type BriefMemory } from "../domain/brief.js";
import { SessionMemory } from "./session-memory.js";

/** What `SessionMemory.forBrief` was asked for. */
export interface MemoryAsk {
  readonly roleKey: string;
  readonly projectId: string | undefined;
}

/** A provider of SessionMemory that answers `memory` to every ask, and records them. */
export function sessionMemoryProvider(memory: BriefMemory = NO_MEMORY, asked: MemoryAsk[] = []) {
  return {
    provide: SessionMemory,
    useValue: {
      forBrief: (roleKey: string, projectId: string | undefined) => {
        asked.push({ roleKey, projectId });
        return Promise.resolve(memory);
      },
    } satisfies Pick<SessionMemory, "forBrief">,
  };
}
