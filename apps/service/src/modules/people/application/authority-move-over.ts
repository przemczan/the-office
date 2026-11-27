import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { authorityFromDutiesHeldOf, authorityMovedOverOf } from "../domain/role-changes.js";
import type { RoleCardChanged } from "../domain/role-events.js";
import { RoleRepository } from "../ports/role-repository.js";
import { Duties } from "./duties.js";

/**
 * Moves each Role card's Hard switches over to its Authority, once, as the service starts after the
 * update that brings it (spec §6 › Authority): each Role whose card has none yet, people let go and
 * the Caretaker included, gets one new version naming no user, its Authority made from its Hard
 * switches and the duties it holds now, and its instructions without the preset's earlier authority
 * sentences when they are word for word. A Role moved over is never touched again, so a crash
 * halfway is made good at the next start.
 *
 * Then, the second move-over (spec §2.2, "Duty"): the reach a duty used to grant beside the
 * Authority is its job's settings now, so each Role holding a duty whose card leaves a row of the
 * job Never gets one new version giving it (`authorityFromDutiesHeldOf`), naming no user. Each Role
 * is given once and marked, so a row the user sets Never later, or a duty assigned later, stays the
 * user's to change (Settings › Duties, "Give <name> these settings").
 */
@Injectable()
export class AuthorityMoveOver implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthorityMoveOver.name);

  constructor(
    private readonly repository: RoleRepository,
    private readonly duties: Duties,
    private readonly events: EventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.moveOver();
      await this.giveDutiesJobs();
    } catch (error) {
      this.logger.error(
        "Moving the Hard switches and duties over to the Authority failed; the next start tries again.",
        error,
      );
    }
  }

  /** Moves every Role not moved yet, each with the duties it holds as it is moved; announces each after. */
  async moveOver(): Promise<void> {
    const keys = await this.repository.rolesToMoveAuthorityOver();
    const moved: RoleCardChanged[] = [];
    for (const key of keys) {
      const holds = new Set(await this.duties.heldBy(key));
      const { event } = await this.repository.moveAuthorityOver(key, (role, switches) =>
        authorityMovedOverOf(role, switches, holds, new Date()),
      );
      if (event) moved.push(event);
    }
    for (const event of moved) await this.events.publish(event);
  }

  /**
   * Gives each Role not given yet the rows of its duties' jobs its card leaves Never, one version
   * each, and marks it; announces each after. A Role holding no duty, such as one let go, is only
   * marked.
   */
  async giveDutiesJobs(): Promise<void> {
    const given: RoleCardChanged[] = [];
    for (const key of await this.repository.rolesToGiveDutiesJobs()) {
      const holds = new Set(await this.duties.heldBy(key));
      const { event } = await this.repository.giveDutiesJobs(key, (role) =>
        authorityFromDutiesHeldOf(role, holds, new Date()),
      );
      if (event) given.push(event);
    }
    for (const event of given) await this.events.publish(event);
  }
}
