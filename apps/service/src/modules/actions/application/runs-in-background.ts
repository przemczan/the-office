import { Injectable, Logger } from "@nestjs/common";

/** The work the runs do in the background: logged when it fails, and awaited by a test. */
@Injectable()
export class RunsInBackground {
  private readonly logger = new Logger(RunsInBackground.name);
  private readonly going = new Set<Promise<void>>();

  /** Runs `work` without waiting for it; a failure is logged with `failure`. */
  start(failure: string, work: () => Promise<void>): void {
    const running = work()
      .catch((error: unknown) => {
        this.logger.error(failure, error);
      })
      .finally(() => this.going.delete(running));
    this.going.add(running);
  }

  /** Waits until nothing is going on in the background, for a test. */
  async settled(): Promise<void> {
    while (this.going.size > 0) await Promise.all(this.going);
  }
}
