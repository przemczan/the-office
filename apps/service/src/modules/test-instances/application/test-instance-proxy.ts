import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { EventBus, type Unsubscribe } from "../../../platform/events/event-bus.js";
import { TestInstanceLaunched, TestInstanceStateChanged } from "../domain/test-instance-events.js";
import { ProxyListeners } from "../ports/proxy-listeners.js";
import { RunningTestInstances } from "./running-test-instances.js";

/** `OFFICE_HOST`, the address The Office and its test-instance proxy listen on. */
export class OfficeHost {
  constructor(readonly host: string) {}
}

/**
 * Keeps the proxy listening on each Proxy port given out (spec §5.1, "The test instance proxy"):
 * opened as an instance launches, so a Building one answers that nothing runs there yet, kept while
 * it is Running, closed once it is Stopped or Failed, and every one closed as The Office shuts down.
 * Started only from office.ts, so a test app opens no port unless its test starts it.
 */
@Injectable()
export class TestInstanceProxy implements OnModuleDestroy {
  private readonly logger = new Logger(TestInstanceProxy.name);
  private readonly unsubscribes: Unsubscribe[] = [];

  constructor(
    private readonly listeners: ProxyListeners,
    private readonly running: RunningTestInstances,
    private readonly events: EventBus,
  ) {}

  /** Listens on the ports of the instances given one from now on, and of the Running ones. */
  async start(): Promise<void> {
    if (this.unsubscribes.length > 0) return;
    this.unsubscribes.push(
      this.events.subscribe(TestInstanceLaunched, ({ port }) => this.open(port)),
      this.events.subscribe(TestInstanceStateChanged, async ({ to, port }) => {
        if (port === undefined) return;
        if (to === "running") await this.open(port);
        else if (to === "stopped" || to === "failed") await this.listeners.close(port);
      }),
    );
    for (const { port } of this.running.list()) await this.open(port);
  }

  async onModuleDestroy(): Promise<void> {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    await this.listeners.closeAll();
  }

  private async open(port: number): Promise<void> {
    await this.listeners.open(port).catch((error: unknown) => {
      this.logger.warn(`The test-instance proxy couldn't listen on port ${port}.`, error);
    });
  }
}
