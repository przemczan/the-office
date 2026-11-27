import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { projectSettingProposalsMovedOverOf } from "../domain/role-changes.js";
import type { RoleCardChanged } from "../domain/role-events.js";
import { RoleRepository } from "../ports/role-repository.js";

/**
 * Moves the reach of the retired Proposal tools over to Change Project settings, once, as the
 * service starts after the update that retires them (spec 5.4.1, "Per-kind Proposal tools fold
 * in"): each Role whose card kept a row of `propose_project_commands`, `propose_test_targets` or
 * `propose_actions` at Proposal and leaves Change Project settings Never gets one new version
 * setting it to Proposal, naming no user. The version saved holds no retired row, so a Role moved
 * over is never touched again, and a crash halfway is made good at the next start. A card that
 * leaves Change Project settings freer than Never keeps what it has.
 */
@Injectable()
export class ProjectSettingProposalsMoveOver implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProjectSettingProposalsMoveOver.name);

  constructor(
    private readonly repository: RoleRepository,
    private readonly events: EventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.moveOver();
    } catch (error) {
      this.logger.error(
        "Moving the retired Proposal tools' reach over to Change Project settings failed; the next start tries again.",
        error,
      );
    }
  }

  /** Moves every Role with a retired Proposal row, each at once; announces each after. */
  async moveOver(): Promise<void> {
    const moved: RoleCardChanged[] = [];
    for (const key of await this.repository.rolesWithRetiredProposalRows()) {
      const { event } = await this.repository.moveProjectSettingProposalsOver(key, (role) =>
        projectSettingProposalsMovedOverOf(role, new Date()),
      );
      if (event) moved.push(event);
    }
    for (const event of moved) await this.events.publish(event);
  }
}
