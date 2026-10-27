import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { writeMemoryNote, type MemoryNote, type MemoryNoteDraft } from "../domain/memory-note.js";
import { MemoryNoteNotFound } from "../domain/memory-note-not-found.js";
import type { Role } from "../domain/role.js";
import { RoleMemoryChanged } from "../domain/role-events.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { RoleRefused } from "../domain/role-refused.js";
import { MemoryRepository } from "../ports/memory-repository.js";
import { RoleRepository } from "../ports/role-repository.js";

/** A person's Memory, and whether sessions use it now. */
export interface Memory {
  /**
   * False while Shared memory is off or after the person was let go: kept, but not read at session
   * start and not added to.
   */
  readonly inUse: boolean;
  readonly notes: readonly MemoryNote[];
}

/** The Memory use cases. Each change is kept first and its event published after. */
@Injectable()
export class MemoryService {
  constructor(
    private readonly notes: MemoryRepository,
    private readonly roles: RoleRepository,
    private readonly events: EventBus,
  ) {}

  async read(roleKey: string): Promise<Memory> {
    const role = await this.role(roleKey);
    return {
      inUse: role.card.capabilities.sharedMemory && !role.letGoAt,
      notes: await this.notes.list(roleKey),
    };
  }

  /**
   * Refused while the person's Shared memory is off or after they were let go, so nothing new is
   * written to it.
   */
  async write(draft: MemoryNoteDraft): Promise<MemoryNote> {
    const role = await this.role(draft.roleKey);
    if (role.letGoAt) {
      throw new RoleRefused([`${role.card.name} was let go; their Memory is kept as it was.`]);
    }
    if (!role.card.capabilities.sharedMemory) {
      throw new RoleRefused([
        `${role.card.name}'s shared memory is off. Switch it on in their Role card first.`,
      ]);
    }
    const note = writeMemoryNote(draft, randomUUID(), new Date());
    await this.notes.append(note);
    await this.events.publish(new RoleMemoryChanged(note.roleKey, note.writtenAt));
    return note;
  }

  /** Deleting stays possible while Shared memory is off. */
  async remove(roleKey: string, noteId: string): Promise<void> {
    await this.role(roleKey);
    if (!(await this.notes.remove(roleKey, noteId))) throw new MemoryNoteNotFound(noteId);
    await this.events.publish(new RoleMemoryChanged(roleKey, new Date()));
  }

  async clear(roleKey: string): Promise<void> {
    await this.role(roleKey);
    await this.notes.clear(roleKey);
    await this.events.publish(new RoleMemoryChanged(roleKey, new Date()));
  }

  private async role(roleKey: string): Promise<Role> {
    const role = await this.roles.find(roleKey);
    if (!role) throw new RoleNotFound(roleKey);
    return role;
  }
}
