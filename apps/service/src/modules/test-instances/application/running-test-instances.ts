import { Injectable } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { TestInstanceSettingsStore } from "../ports/test-instance-settings-store.js";

/** A Running Hosted instance as the proxy reaches it. */
export interface RunningTestInstance {
  readonly id: string;
  /** The Proxy port it was given, on OFFICE_HOST. */
  readonly port: number;
  /** The port on 127.0.0.1 the runtime published for its app. */
  readonly hostPort: number;
}

/**
 * The Running Hosted instances, in memory, for the proxy (spec §2.12, "Reaching a Hosted
 * instance"): which instance a Proxy port leads to and where its app answers, and each request
 * forwarded as activity, which holds off its Idle time stop. Empty after a restart, whose sweep
 * stops every instance.
 */
@Injectable()
export class RunningTestInstances {
  private readonly byId = new Map<
    string,
    RunningTestInstance & { readonly appPort: number; lastActivityAt: number }
  >();

  constructor(
    private readonly schedule: Schedule,
    private readonly settings: TestInstanceSettingsStore,
  ) {}

  /** The Running instance given `port`; undefined when none is. */
  byPort(port: number): RunningTestInstance | undefined {
    for (const running of this.byId.values()) {
      if (running.port === port) return { id: running.id, port, hostPort: running.hostPort };
    }
    return undefined;
  }

  /** The port on 127.0.0.1 where the Running instance's app answers; undefined unless Running. */
  upstreamOf(id: string): number | undefined {
    return this.byId.get(id)?.hostPort;
  }

  /**
   * The port its app listens on inside its run environment, the target's own: the proxy addresses
   * each request to `localhost` at it, the instance's own address. Undefined unless Running.
   */
  appPortOf(id: string): number | undefined {
    return this.byId.get(id)?.appPort;
  }

  isRunning(id: string): boolean {
    return this.byId.has(id);
  }

  /** A request forwarded to the instance: its Idle time counts again from now. */
  recordActivity(id: string): void {
    const running = this.byId.get(id);
    if (running) running.lastActivityAt = this.schedule.now().getTime();
  }

  /** The Proxy ports as Settings has them now, first to last. */
  async portRange(): Promise<{ readonly first: number; readonly last: number }> {
    const { firstProxyPort, lastProxyPort } = await this.settings.read();
    return { first: firstProxyPort, last: lastProxyPort };
  }

  /** Every Running instance. */
  list(): RunningTestInstance[] {
    return [...this.byId.values()].map(({ id, port, hostPort }) => ({ id, port, hostPort }));
  }

  /** @internal The instance became Running, active from now; `appPort` is its target's port. */
  add(running: RunningTestInstance & { readonly appPort: number }): void {
    this.byId.set(running.id, { ...running, lastActivityAt: this.schedule.now().getTime() });
  }

  /** @internal It ended. */
  remove(id: string): void {
    this.byId.delete(id);
  }

  /** @internal When it last had a request, or became Running; undefined unless Running. */
  lastActivityOf(id: string): number | undefined {
    return this.byId.get(id)?.lastActivityAt;
  }
}
