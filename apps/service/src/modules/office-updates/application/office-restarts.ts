import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { OfficeRestartScheduled } from "../domain/office-update-events.js";
import { alreadyScheduled, restartRefusal, type RestartState } from "../domain/restart-refusal.js";
import { ScheduledExitRefused } from "../domain/scheduled-exit-refused.js";
import { OfficeContainer } from "../ports/office-container.js";
import { RestartHandOff } from "../ports/restart-hand-off.js";
import { UpdateFolder } from "../ports/update-folder.js";
import { InstalledOffice } from "./installed-office.js";
import { ScheduledExits } from "./scheduled-exits.js";

export const NO_RESTART_SCHEDULED = "No restart is scheduled.";
export const RESTARTING = "The Office is restarting.";

/**
 * Office restarts (spec §5.1 Defaults, "Restarting The Office"): offered only where something
 * starts the service again once it exits, its launcher or Docker's restart policy. A scheduled
 * restart holds new work as a scheduled update does, and the service exits once nothing is busy.
 */
@Injectable()
export class OfficeRestarts implements OnModuleInit {
  private readonly logger = new Logger(OfficeRestarts.name);

  constructor(
    private readonly exits: ScheduledExits,
    private readonly handOff: RestartHandOff,
    private readonly installed: InstalledOffice,
    private readonly container: OfficeContainer,
    private readonly folder: UpdateFolder,
    private readonly clock: Schedule,
  ) {}

  onModuleInit(): void {
    this.exits.carryOut("restart", () => this.goAhead());
  }

  /** Why Restart is refused now; undefined when it can be scheduled. */
  async refusal(): Promise<string | undefined> {
    // Settings › Updates is read again with each change of the busy work while an exit is
    // scheduled; the container isn't read then, as the scheduled exit decides the refusal alone.
    const scheduled = this.exits.scheduled?.kind;
    return alreadyScheduled(scheduled) ?? restartRefusal(await this.state(), scheduled);
  }

  /** Schedules a restart, refused with the reason; it goes ahead once nothing is busy. */
  async schedule(): Promise<void> {
    const refusal = await this.refusal();
    if (refusal) throw new ScheduledExitRefused([refusal]);
    // Reading a container took a while: an update may have been scheduled meanwhile.
    const already = alreadyScheduled(this.exits.scheduled?.kind);
    if (already) throw new ScheduledExitRefused([already]);
    await this.exits.schedule(
      { kind: "restart", scheduledAt: this.clock.now() },
      new OfficeRestartScheduled(),
    );
  }

  /** Cancels the scheduled restart, which releases what it held; refused once it is under way. */
  async cancel(): Promise<void> {
    if (this.exits.scheduled?.kind !== "restart") {
      throw new ScheduledExitRefused([NO_RESTART_SCHEDULED]);
    }
    if (this.exits.underWay) throw new ScheduledExitRefused([RESTARTING]);
    await this.exits.cancel();
  }

  private async goAhead(): Promise<"exit"> {
    await this.handOff.handOff();
    this.logger.log("Restarting The Office, as the user scheduled.");
    return "exit";
  }

  private async state(): Promise<RestartState> {
    const install = await this.installed.kind();
    const launched = this.folder.launched;
    switch (install) {
      case "checkout":
        return { install, launched };
      case "release":
        return { install, launched, installed: this.installed.variable === "release" };
      case "container":
        return { install, container: await this.container.read() };
    }
  }
}
