import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

/** How long the event loop was held up since the last read, in ms. */
export interface EventLoopDelay {
  readonly p99Ms: number;
  readonly maxMs: number;
}

/**
 * The Office's own process, as Node measures it: the one place the System health recorder's
 * process figures come from, so a test gives its own.
 */
export abstract class OfficeProcess {
  /** The delay since the last call (or `start`), which starts the next measure afresh. */
  abstract takeEventLoopDelay(): EventLoopDelay;
  /** CPU time used since the process started, user and system together, in ms. */
  abstract cpuTimeMs(): number;
  /** Resident memory and the V8 heap in use, in bytes. */
  abstract memory(): { readonly residentBytes: number; readonly heapUsedBytes: number };
  /** Starts measuring the event loop delay. */
  abstract start(): void;
  abstract stop(): void;
}

const NANOSECONDS_PER_MS = 1e6;

export class NodeOfficeProcess extends OfficeProcess {
  private delays: IntervalHistogram | undefined;

  start(): void {
    if (this.delays) return;
    this.delays = monitorEventLoopDelay();
    this.delays.enable();
  }

  stop(): void {
    this.delays?.disable();
    this.delays = undefined;
  }

  takeEventLoopDelay(): EventLoopDelay {
    const delays = this.delays;
    if (!delays || delays.count === 0) return { p99Ms: 0, maxMs: 0 };
    const delay = {
      p99Ms: delays.percentile(99) / NANOSECONDS_PER_MS,
      maxMs: delays.max / NANOSECONDS_PER_MS,
    };
    delays.reset();
    return delay;
  }

  cpuTimeMs(): number {
    const { user, system } = process.cpuUsage();
    return (user + system) / 1000;
  }

  memory(): { readonly residentBytes: number; readonly heapUsedBytes: number } {
    const { rss, heapUsed } = process.memoryUsage();
    return { residentBytes: rss, heapUsedBytes: heapUsed };
  }
}
