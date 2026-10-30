import { Injectable } from "@nestjs/common";
import { selectMemory, type BriefMemory, type MemoryReach } from "../domain/brief.js";
import { MemoryService } from "../../people/index.js";

/** The part of a person's Memory a new session's Brief carries (spec §2.2). */
@Injectable()
export class SessionMemory {
  constructor(private readonly memory: MemoryService) {}

  /** The notes `reach` reads, none while the person's Shared memory is off: kept, but not read. */
  async forBrief(roleKey: string, reach: MemoryReach): Promise<BriefMemory> {
    const { inUse, notes } = await this.memory.read(roleKey);
    return selectMemory(inUse ? notes : [], reach);
  }
}
