import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { BusyItem } from "../domain/busy-item.js";
import type { OfficeCommit } from "../domain/office-commit.js";
import {
  BusyWorkChanged,
  OfficeUpdateCancelled,
  OfficeUpdateChecked,
  OfficeUpdated,
  OfficeUpdateFailed,
  OfficeUpdateScheduled,
} from "../domain/office-update-events.js";
import { OfficeUpdateRefused } from "../domain/office-update-refused.js";
import { stepWords, type OfficeUpdateResult } from "../domain/office-update-result.js";
import { NO_LAUNCHER, updateRefusal, type CheckoutState } from "../domain/update-refusal.js";
import { OfficeCheckout } from "../ports/office-checkout.js";
import { UpdateFolder } from "../ports/update-folder.js";
import { BusyWork } from "./busy-work.js";
import { OfficeUpdateHold, type ScheduledOfficeUpdate } from "./office-update-hold.js";

/** The daily job's name in the schedule. */
export const OFFICE_UPDATE_CHECK = "The Office update check";

export const UP_TO_DATE = "The Office is up to date.";
export const ALREADY_SCHEDULED = "An update is scheduled already.";
export const NOTHING_SCHEDULED = "No update is scheduled.";
export const UNDER_WAY = "The update is under way: The Office is stopping for it.";

/** What the last check found. */
export interface OfficeUpdateCheck {
  readonly checkedAt: Date;
  readonly newest: OfficeCommit | undefined;
  readonly behind: readonly OfficeCommit[];
  readonly problem: string | undefined;
  readonly state: CheckoutState;
}

/** Settings › Updates, as the service sees it now. */
export interface OfficeUpdateView {
  readonly current: OfficeCommit;
  readonly check: OfficeUpdateCheck | undefined;
  readonly refusal: string | undefined;
  readonly checking: boolean;
  readonly scheduled: (ScheduledOfficeUpdate & { readonly busy: readonly BusyItem[] }) | undefined;
  readonly lastResult: OfficeUpdateResult | undefined;
}

/**
 * Office updates (spec §5.1 Defaults, "Updating The Office"): the daily check of the checkout's
 * upstream, which installs nothing, and the update the user schedules. A scheduled update holds new
 * work and waits for the work going on to end; then the service asks the launcher for the update
 * and stops, and the launcher installs it and starts the service again.
 */
@Injectable()
export class OfficeUpdates implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(OfficeUpdates.name);
  private found: OfficeUpdateCheck | undefined;
  private checking: Promise<OfficeUpdateCheck> | undefined;
  private currentCommit: Promise<OfficeCommit> | undefined;
  private readonly readyListeners: (() => void)[] = [];
  private exiting = false;

  constructor(
    private readonly checkout: OfficeCheckout,
    private readonly folder: UpdateFolder,
    private readonly hold: OfficeUpdateHold,
    private readonly busyWork: BusyWork,
    private readonly events: EventBus,
    private readonly clock: Schedule,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(BusyWorkChanged, () => this.exitIfIdle());
  }

  /** Tells what the launcher did since the last run, then checks daily, the first check now. */
  async onApplicationBootstrap(): Promise<void> {
    await this.announceNewResult().catch((error: unknown) => {
      this.logger.error(`The last Office update's result wasn't read: ${String(error)}`);
    });
    this.clock.daily(OFFICE_UPDATE_CHECK, async () => {
      await this.check();
    });
  }

  /** Calls `listener` once the service is to stop for the update it asked the launcher for. */
  onReadyToUpdate(listener: () => void): void {
    this.readyListeners.push(listener);
  }

  /** Fetches the upstream and keeps what it found; a check going on is joined, not repeated. */
  check(): Promise<OfficeUpdateCheck> {
    this.checking ??= this.runCheck().finally(() => (this.checking = undefined));
    return this.checking;
  }

  async view(): Promise<OfficeUpdateView> {
    const scheduled = this.hold.scheduled;
    return {
      current: await this.current(),
      check: this.found,
      refusal: this.refusal(),
      checking: this.checking !== undefined,
      scheduled: scheduled && { ...scheduled, busy: this.busyWork.list() },
      lastResult: await this.folder.lastResult(),
    };
  }

  /** The launcher's log of the last update. */
  log(): Promise<string | undefined> {
    return this.folder.log();
  }

  /**
   * Schedules the update to the upstream's newest commit, after a fresh check: refused when the
   * check finds a reason, or nothing newer. It goes ahead once nothing is busy.
   */
  async schedule(): Promise<void> {
    if (this.hold.isScheduled()) throw new OfficeUpdateRefused([ALREADY_SCHEDULED]);
    const { newest, behind } = await this.check();
    const refusal = this.refusal();
    if (refusal) throw new OfficeUpdateRefused([refusal]);
    if (!newest || behind.length === 0) throw new OfficeUpdateRefused([UP_TO_DATE]);
    if (this.hold.isScheduled()) throw new OfficeUpdateRefused([ALREADY_SCHEDULED]);
    this.hold.hold({ target: newest, scheduledAt: this.clock.now() });
    await this.events.publish(new OfficeUpdateScheduled(newest));
    await this.exitIfIdle();
  }

  /** Cancels the scheduled update, which releases what it held; refused once it is under way. */
  async cancel(): Promise<void> {
    if (this.exiting) throw new OfficeUpdateRefused([UNDER_WAY]);
    if (!this.hold.isScheduled()) throw new OfficeUpdateRefused([NOTHING_SCHEDULED]);
    this.hold.hold(undefined);
    await this.events.publish(new OfficeUpdateCancelled());
  }

  private async runCheck(): Promise<OfficeUpdateCheck> {
    const read = await this.checkout.readUpstream();
    const before = this.found?.behind[0]?.commit;
    this.found = {
      checkedAt: this.clock.now(),
      newest: read.newest,
      behind: read.behind,
      problem: read.fetchProblem,
      state: read,
    };
    if (read.fetchProblem) this.logger.warn(`The Office update check: ${read.fetchProblem}`);
    const available = read.behind[0];
    await this.events.publish(
      new OfficeUpdateChecked(available, available !== undefined && available.commit !== before),
    );
    return this.found;
  }

  private current(): Promise<OfficeCommit> {
    // The service runs one commit from its start to its end.
    this.currentCommit ??= this.checkout.current().catch((error: unknown) => {
      this.currentCommit = undefined;
      throw error;
    });
    return this.currentCommit;
  }

  /** Why Update is refused now; a check's findings count once there is one. */
  private refusal(): string | undefined {
    const context = {
      launched: this.folder.launched,
      systemRefusal: currentOperatingSystem().officeUpdateRefusal,
    };
    return this.found
      ? updateRefusal(this.found.state, context)
      : (context.systemRefusal ?? (context.launched ? undefined : NO_LAUNCHER));
  }

  /** Once an update is scheduled and nothing is busy, asks the launcher for it and stops. */
  private async exitIfIdle(): Promise<void> {
    const scheduled = this.hold.scheduled;
    if (!scheduled || this.exiting || this.busyWork.list().length > 0) return;
    this.exiting = true;
    try {
      await this.folder.writeRequest(scheduled.target.commit);
    } catch (error) {
      // Left scheduled, so the user sees it and can cancel it, or the next change tries again.
      this.exiting = false;
      this.logger.error(`The Office update's request wasn't written: ${String(error)}`);
      return;
    }
    this.logger.log(`Stopping to update The Office to ${scheduled.target.commit}.`);
    for (const listener of this.readyListeners) listener();
  }

  private async announceNewResult(): Promise<void> {
    const result = await this.folder.takeNewResult();
    if (!result) return;
    await this.events.publish(
      result.outcome === "updated"
        ? new OfficeUpdated(result.from, result.to, result.finishedAt)
        : new OfficeUpdateFailed(
            result.from,
            result.to,
            stepWords(result.failedStep),
            result.finishedAt,
          ),
    );
  }
}
