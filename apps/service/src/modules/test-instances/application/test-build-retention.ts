import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  buildsPastTheKept,
  FILES_REMOVED_FOR_NEWER,
  filesRemovedAsInitiativeEnded,
  initiativeEndedLongAgo,
} from "../domain/test-build.js";
import { TestInstanceFilesRemoved } from "../domain/test-instance-events.js";
import { filesRemoved, type TestInstance } from "../domain/test-instance.js";
import { Initiatives } from "../ports/initiatives.js";
import { TestInstanceRepository, type BuildsOf } from "../ports/test-instance-repository.js";
import { InstanceFiles } from "./instance-files.js";

/** The daily run's name in the logs. */
export const REMOVING_ENDED_BUILDS = "removing the files of ended Initiatives' builds";

/**
 * Kept Build to install files (spec §2.12, Defaults): the newest builds per target per Initiative
 * keep theirs, an older one's going as a newer one is Built, and every build's go once its
 * Initiative has been Done or Dropped long enough. A build's row and log stay, its log saying so.
 * The daily run is started only by office.ts, never a test app's start.
 */
@Injectable()
export class TestBuildRetention {
  private readonly logger = new Logger(TestBuildRetention.name);

  constructor(
    private readonly repository: TestInstanceRepository,
    private readonly initiatives: Initiatives,
    private readonly files: InstanceFiles,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  /** Runs now, then once a day. */
  start(): void {
    this.schedule.daily(REMOVING_ENDED_BUILDS, async () => {
      await this.removeEnded();
    });
  }

  /** Removes the files of the target's builds on the Initiative past the newest kept. */
  async keepNewest(of: BuildsOf): Promise<void> {
    for (const instance of buildsPastTheKept(await this.repository.builtWithFiles(of))) {
      await this.remove(instance, FILES_REMOVED_FOR_NEWER);
    }
  }

  /** One run: removes the files of every build whose Initiative ended long enough ago. */
  async removeEnded(): Promise<number> {
    const now = this.schedule.now();
    const builds = await this.repository.builtWithFiles();
    let removed = 0;
    for (const initiativeId of new Set(builds.map((build) => build.initiativeId))) {
      const initiative = await this.initiatives.find(initiativeId);
      if (initiative === undefined) continue;
      const { state, endedAt } = initiative;
      if (state !== "done" && state !== "dropped") continue;
      if (!initiativeEndedLongAgo(endedAt, now)) continue;
      for (const build of builds.filter((each) => each.initiativeId === initiativeId)) {
        if (await this.remove(build, filesRemovedAsInitiativeEnded(state))) removed += 1;
      }
    }
    this.logger.log(`Removed the files of ${removed} ${removed === 1 ? "build" : "builds"}.`);
    return removed;
  }

  private async remove(instance: TestInstance, words: string): Promise<boolean> {
    const change = await this.repository.update(instance.id, (kept) =>
      filesRemoved(kept, this.schedule.now()),
    );
    if (change === undefined) return false;
    await this.files.removeBuildFiles(instance.id);
    await this.files.note(instance.id, words);
    await this.events.publish(new TestInstanceFilesRemoved(instance.id, instance.initiativeId));
    return true;
  }
}
