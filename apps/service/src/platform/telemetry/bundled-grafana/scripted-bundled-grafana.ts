import {
  BundledGrafana,
  BundledGrafanaFailed,
  type BundledGrafanaProblem,
  type BundledGrafanaRunState,
} from "./bundled-grafana.js";

/** A call the scripted bundled Grafana took, by its method's name. */
export type BundledGrafanaCall = "start" | "stop" | "state" | "earlierContainers" | "stopEarlier";

/**
 * The bundled Grafana for tests and the end-to-end service: no Docker, only the state a test sets.
 * A start succeeds unless `failStartWith` is set, and waits while `holdStarts` holds it.
 */
export class ScriptedBundledGrafana extends BundledGrafana {
  readonly calls: BundledGrafanaCall[] = [];
  readonly stoppedEarlier: string[] = [];
  runState: BundledGrafanaRunState = "absent";
  earlier: string[] = [];
  failStartWith: BundledGrafanaProblem | undefined;
  failStateWith: BundledGrafanaProblem | undefined;
  private held: Promise<void> | undefined;
  private release: (() => void) | undefined;

  /** Holds every start until `releaseStarts`. */
  holdStarts(): void {
    this.held = new Promise((resolve) => (this.release = resolve));
  }

  releaseStarts(): void {
    this.release?.();
    this.held = undefined;
  }

  async start(): Promise<void> {
    this.calls.push("start");
    this.runState = "starting";
    await this.held;
    if (this.failStartWith) {
      this.runState = "stopped";
      throw new BundledGrafanaFailed(this.failStartWith);
    }
    this.runState = "running";
  }

  stop(): Promise<void> {
    this.calls.push("stop");
    if (this.runState !== "absent") this.runState = "stopped";
    return Promise.resolve();
  }

  state(): Promise<BundledGrafanaRunState> {
    this.calls.push("state");
    if (this.failStateWith) return Promise.reject(new BundledGrafanaFailed(this.failStateWith));
    return Promise.resolve(this.runState);
  }

  earlierContainers(): Promise<readonly string[]> {
    this.calls.push("earlierContainers");
    return Promise.resolve([...this.earlier]);
  }

  stopEarlier(containers: readonly string[]): Promise<void> {
    this.calls.push("stopEarlier");
    this.stoppedEarlier.push(...containers);
    this.earlier = this.earlier.filter((name) => !containers.includes(name));
    return Promise.resolve();
  }
}
