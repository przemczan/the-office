import { NO_MEMORY, type BriefMemory, type MemoryReach } from "../domain/brief.js";
import { SessionMemory } from "./session-memory.js";

/** What `SessionMemory.forBrief` was asked for. */
export interface MemoryAsk {
  readonly roleKey: string;
  readonly reach: MemoryReach;
}

/** A provider of SessionMemory that answers `memory` to every ask, and records them. */
export function sessionMemoryProvider(memory: BriefMemory = NO_MEMORY, asked: MemoryAsk[] = []) {
  return {
    provide: SessionMemory,
    useValue: {
      forBrief: (roleKey: string, reach: MemoryReach) => {
        asked.push({ roleKey, reach });
        return Promise.resolve(memory);
      },
    } satisfies Pick<SessionMemory, "forBrief">,
  };
}
