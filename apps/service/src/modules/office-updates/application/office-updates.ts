import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { BusyItem } from "../domain/busy-item.js";
import { installKindOf, type InstallKind } from "../domain/install-kind.js";
import type { OfficeCommit } from "../domain/office-commit.js";
import { imageRepository } from "../domain/office-container.js";
import { releaseWords, type OfficeRelease } from "../domain/office-release.js";
import {
  BusyWorkChanged,
  OfficeUpdateCancelled,
  OfficeUpdateChecked,
  OfficeUpdated,
  OfficeUpdateFailed,
  OfficeUpdateScheduled,
} from "../domain/office-update-events.js";
import { OfficeUpdateRefused } from "../domain/office-update-refused.js";
import type { OfficeUpdateRequest } from "../domain/office-update-request.js";
import { stepWords, type OfficeUpdateResult } from "../domain/office-update-result.js";
import { targetWords, type OfficeUpdateTarget } from "../domain/office-update-target.js";
import { tarballAssetsOf, type PublishedRelease } from "../domain/published-release.js";
import { updateRefusal, type UpdateState } from "../domain/update-refusal.js";
import { OfficeCheckout } from "../ports/office-checkout.js";
import { OfficeContainer } from "../ports/office-container.js";
import { OfficeReleaseStamp } from "../ports/office-release-stamp.js";
import { OfficeReleases } from "../ports/office-releases.js";
import { UpdateFolder } from "../ports/update-folder.js";
import { UpdateHandOff, type HandedOff } from "../ports/update-hand-off.js";
import { UpdateSystem } from "../ports/update-system.js";
import { BusyWork } from "./busy-work.js";
import { OfficeInstallSetting } from "./office-install.js";
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
  /** A checkout's: the upstream's newest commit. */
  readonly newest: OfficeCommit | undefined;
  /** A checkout's: the commits it is behind its upstream, newest first. */
  readonly behind: readonly OfficeCommit[];
  /** A release's or a container's: the released versions newer than it, newest first. */
  readonly releases: readonly PublishedRelease[];
  readonly problem: string | undefined;
  readonly state: UpdateState;
}

/** Settings › Updates, as the service sees it now. */
export interface OfficeUpdateView {
  readonly install: InstallKind;
  /** The Office release's version; undefined when The Office runs from a checkout. */
  readonly version: string | undefined;
  readonly current: OfficeCommit;
  readonly check: OfficeUpdateCheck | undefined;
  readonly refusal: string | undefined;
  readonly checking: boolean;
  readonly scheduled: (ScheduledOfficeUpdate & { readonly busy: readonly BusyItem[] }) | undefined;
  readonly lastResult: OfficeUpdateResult | undefined;
}

/**
 * Office updates (spec §5.1 Defaults, "Updating The Office"): the daily check, which installs
 * nothing, of the checkout's upstream or of GitHub Releases, and the update the user schedules. A
 * scheduled update holds new work and waits for the work going on to end; then the service hands it
 * over: to the launcher, stopping for it, or to the Office updater, which replaces its container.
 */
@Injectable()
export class OfficeUpdates implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(OfficeUpdates.name);
  private found: OfficeUpdateCheck | undefined;
  private checking: Promise<OfficeUpdateCheck> | undefined;
  private currentCommit: Promise<OfficeCommit> | undefined;
  private release: Promise<OfficeRelease | undefined> | undefined;
  private readonly readyListeners: (() => void)[] = [];
  private exiting = false;

  constructor(
    private readonly checkout: OfficeCheckout,
    private readonly releaseStamp: OfficeReleaseStamp,
    private readonly releases: OfficeReleases,
    private readonly container: OfficeContainer,
    private readonly folder: UpdateFolder,
    private readonly handOff: UpdateHandOff,
    private readonly system: UpdateSystem,
    private readonly installSetting: OfficeInstallSetting,
    private readonly hold: OfficeUpdateHold,
    private readonly busyWork: BusyWork,
    private readonly events: EventBus,
    private readonly clock: Schedule,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(BusyWorkChanged, () => this.exitIfIdle());
  }

  /** Tells what the last update did, then checks daily, the first check now. */
  async onApplicationBootstrap(): Promise<void> {
    await this.announceRelease();
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

  /** Reads what is newer and keeps what it found; a check going on is joined, not repeated. */
  check(): Promise<OfficeUpdateCheck> {
    this.checking ??= this.runCheck().finally(() => (this.checking = undefined));
    return this.checking;
  }

  async view(): Promise<OfficeUpdateView> {
    const scheduled = this.hold.scheduled;
    return {
      install: await this.install(),
      version: (await this.officeRelease())?.version,
      current: await this.current(),
      check: this.found,
      refusal: await this.refusal(),
      checking: this.checking !== undefined,
      scheduled: scheduled && { ...scheduled, busy: this.busyWork.list() },
      lastResult: await this.folder.lastResult(),
    };
  }

  /** The log of the last update, as the launcher or the Office updater left it. */
  log(): Promise<string | undefined> {
    return this.folder.log();
  }

  /**
   * Schedules the update to the newest commit or release, after a fresh check: refused when the
   * check finds a reason, or nothing newer. It goes ahead once nothing is busy.
   */
  async schedule(): Promise<void> {
    if (this.hold.isScheduled()) throw new OfficeUpdateRefused([ALREADY_SCHEDULED]);
    const found = await this.check();
    const refusal = await this.refusal();
    if (refusal) throw new OfficeUpdateRefused([refusal]);
    const target = targetOf(found);
    if (!target) {
      const releaseProblem = found.state.install === "checkout" ? undefined : found.problem;
      throw new OfficeUpdateRefused([releaseProblem ?? UP_TO_DATE]);
    }
    if (this.hold.isScheduled()) throw new OfficeUpdateRefused([ALREADY_SCHEDULED]);
    this.hold.hold({ target, scheduledAt: this.clock.now() });
    await this.events.publish(new OfficeUpdateScheduled(target));
    await this.exitIfIdle();
  }

  /** Cancels the scheduled update, which releases what it held; refused once it is under way. */
  async cancel(): Promise<void> {
    if (this.exiting) throw new OfficeUpdateRefused([UNDER_WAY]);
    if (!this.hold.isScheduled()) throw new OfficeUpdateRefused([NOTHING_SCHEDULED]);
    await this.releaseHold();
  }

  private async runCheck(): Promise<OfficeUpdateCheck> {
    const install = await this.install();
    const before = this.found && targetOf(this.found);
    this.found =
      install === "checkout" ? await this.checkUpstream() : await this.checkReleases(install);
    if (this.found.problem) this.logger.warn(`The Office update check: ${this.found.problem}`);
    const available = targetOf(this.found);
    await this.events.publish(
      new OfficeUpdateChecked(
        available,
        available !== undefined && (!before || targetWords(available) !== targetWords(before)),
      ),
    );
    return this.found;
  }

  private async checkUpstream(): Promise<OfficeUpdateCheck> {
    const read = await this.checkout.readUpstream();
    return {
      checkedAt: this.clock.now(),
      newest: read.newest,
      behind: read.behind,
      releases: [],
      problem: read.fetchProblem,
      state: { install: "checkout", checkout: read },
    };
  }

  /** GitHub Releases newer than the release The Office runs; a failed read is the problem. */
  private async checkReleases(install: "release" | "container"): Promise<OfficeUpdateCheck> {
    const release = await this.officeRelease();
    let releases: PublishedRelease[] = [];
    let problem: string | undefined;
    if (release?.repository) {
      try {
        releases = await this.releases.newerThan(release.repository, release.version);
      } catch (error) {
        problem = `GitHub Releases couldn't be read: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const newest = releases[0];
    return {
      checkedAt: this.clock.now(),
      newest: undefined,
      behind: [],
      releases,
      problem,
      state:
        install === "release"
          ? { ...this.releaseState(release), newest }
          : { install, container: await this.container.read(), newest },
    };
  }

  private async install(): Promise<InstallKind> {
    return installKindOf(this.installSetting.variable, (await this.officeRelease()) !== undefined);
  }

  private releaseState(release: OfficeRelease | undefined): UpdateState & { install: "release" } {
    return {
      install: "release" as const,
      installed: this.installSetting.variable === "release" && this.folder.launched,
      repository: release?.repository,
      newest: undefined,
      architecture: this.system.architecture,
    };
  }

  /**
   * The commit The Office runs: a release's from its stamp, as a release has no `.git` (and git
   * would read a repository above it), else the checkout's.
   */
  private current(): Promise<OfficeCommit> {
    // The service runs one commit from its start to its end.
    this.currentCommit ??= this.officeRelease()
      .then((release) => release?.commit ?? this.checkout.current())
      .catch((error: unknown) => {
        this.currentCommit = undefined;
        throw error;
      });
    return this.currentCommit;
  }

  private officeRelease(): Promise<OfficeRelease | undefined> {
    this.release ??= this.releaseStamp.read().catch((error: unknown) => {
      this.release = undefined;
      throw error;
    });
    return this.release;
  }

  /** Names the release in the log at boot, so the log of a release install says which it runs. */
  private async announceRelease(): Promise<void> {
    const release = await this.officeRelease().catch((error: unknown) => {
      this.logger.error(`The Office release's stamp wasn't read: ${String(error)}`);
      return undefined;
    });
    if (release) this.logger.log(releaseWords(release));
  }

  /** Why Update is refused now; a check's findings count once there is one. */
  private async refusal(): Promise<string | undefined> {
    const context = { launched: this.folder.launched, systemRefusal: this.system.refusal };
    return updateRefusal(this.found?.state ?? (await this.stateBeforeCheck()), context);
  }

  private async stateBeforeCheck(): Promise<UpdateState> {
    const install = await this.install();
    if (install === "checkout") return { install, checkout: undefined };
    if (install === "container") return { install, container: undefined, newest: undefined };
    return this.releaseState(await this.officeRelease());
  }

  /** Once an update is scheduled and nothing is busy, hands it over. */
  private async exitIfIdle(): Promise<void> {
    const scheduled = this.hold.scheduled;
    if (!scheduled || this.exiting || this.busyWork.list().length > 0) return;
    this.exiting = true;
    let handedOff: HandedOff;
    try {
      handedOff = await this.handOff.handOff(await this.requestFor(scheduled.target));
    } catch (error) {
      // Left scheduled, so the user sees it and can cancel it, or the next change tries again.
      this.exiting = false;
      this.logger.error(`The Office update wasn't handed over: ${String(error)}`);
      return;
    }
    const target = targetWords(scheduled.target);
    if (handedOff.serviceStops) {
      this.logger.log(`Stopping to update The Office to ${target}.`);
      for (const listener of this.readyListeners) listener();
      return;
    }
    this.logger.log(`The Office updater is updating The Office to ${target}.`);
    void handedOff.ended
      .catch((error: unknown) => {
        this.logger.error(`The Office updater wasn't followed to its end: ${String(error)}`);
      })
      .then(() => this.updaterEnded());
  }

  /**
   * The Office updater ended while this service still runs, so it never replaced it: the update
   * failed before that, and what it held goes on.
   */
  private async updaterEnded(): Promise<void> {
    this.logger.warn("The Office updater ended without replacing The Office.");
    await this.announceNewResult().catch((error: unknown) => {
      this.logger.error(`The Office updater's result wasn't read: ${String(error)}`);
    });
    this.exiting = false;
    await this.releaseHold();
  }

  /** Lets go of the scheduled update, so what it held goes on. */
  private async releaseHold(): Promise<void> {
    this.hold.hold(undefined);
    await this.events.publish(new OfficeUpdateCancelled());
  }

  /** What the launcher or the Office updater is asked for, from what the last check found. */
  private async requestFor(target: OfficeUpdateTarget): Promise<OfficeUpdateRequest> {
    if (target.kind === "commit") return { kind: "commit", target: target.commit };
    const found = this.found;
    const release = found?.releases.find(({ version }) => version === target.version);
    const from = (await this.officeRelease())?.version;
    if (!found || !release || !from) {
      throw new Error(`Version ${target.version} is no longer among the releases found.`);
    }
    const { state } = found;
    if (state.install === "release") {
      const assets = tarballAssetsOf(release, this.system.architecture);
      if (!assets) throw new Error(`Version ${release.version} has no tarball for this CPU.`);
      return { kind: "release", version: release.version, from, ...assets };
    }
    if (state.install === "container" && state.container?.reachable) {
      const image = imageRepository(state.container.container.image);
      return { kind: "container", version: release.version, from, image };
    }
    throw new Error("The Office can't tell how to install a release here.");
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

/** What an update would install now: the upstream's newest commit, or the newest release. */
function targetOf({ newest, behind, releases }: OfficeUpdateCheck): OfficeUpdateTarget | undefined {
  if (newest && behind.length > 0) return { kind: "commit", ...newest };
  const [release] = releases;
  return (
    release && {
      kind: "release",
      version: release.version,
      name: release.name,
      publishedAt: release.publishedAt,
      url: release.url,
    }
  );
}
