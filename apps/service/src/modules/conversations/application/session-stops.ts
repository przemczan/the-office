import { Injectable } from "@nestjs/common";

/**
 * What an Office tool's long work hears its session stop by: a signal per session, aborted as the
 * session ends, which every runner's session reaches through `SessionFollowing.end`. A tool that
 * waits on work running outside the session, such as an environment check, stops it then.
 */
@Injectable()
export class SessionStops {
  private readonly stops = new Map<string, AbortController>();

  /** Aborted once the session ends; one that ended already is never asked again. */
  signalOf(sessionId: string): AbortSignal {
    let stop = this.stops.get(sessionId);
    if (!stop) {
      stop = new AbortController();
      this.stops.set(sessionId, stop);
    }
    return stop.signal;
  }

  /** The session ended: whatever waits on its signal stops. */
  stopped(sessionId: string): void {
    this.stops.get(sessionId)?.abort();
    this.stops.delete(sessionId);
  }
}
