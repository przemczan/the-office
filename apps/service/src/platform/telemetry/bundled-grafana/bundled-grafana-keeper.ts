import { Injectable, Logger } from "@nestjs/common";
import {
  BUNDLED_GRAFANA_ADDRESS,
  BUNDLED_GRAFANA_ENDPOINT,
  type BundledGrafanaStatus,
  type TelemetryChoice,
} from "@the-office/contracts";
import { SavedTelemetrySetting } from "../saved-telemetry-setting.js";
import { RunningTelemetrySettings } from "../telemetry-in-effect.js";
import { isSetByEnvironment } from "../telemetry-settings.js";
import {
  BUNDLED_GRAFANA_PROJECT,
  BundledGrafana,
  BundledGrafanaFailed,
  problemWords,
  type BundledGrafanaProblem,
} from "./bundled-grafana.js";

/** What this run did with the bundled Grafana; whether it runs after that is Docker's to tell. */
type Activity =
  | { readonly kind: "idle" }
  | { readonly kind: "starting"; readonly started: Promise<void> }
  | { readonly kind: "failed"; readonly problem: BundledGrafanaProblem };

/**
 * Keeps the bundled Grafana running while it is wanted: while Bundled Grafana is saved or this run
 * exports to it, unless OTEL_* variables set telemetry, which leave it as it is. One start or stop
 * runs at a time.
 */
@Injectable()
export class BundledGrafanaKeeper {
  private readonly logger = new Logger("BundledGrafana");
  private activity: Activity = { kind: "idle" };
  private earlierStopped: readonly string[] = [];
  private calls: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly grafana: BundledGrafana,
    private readonly saved: SavedTelemetrySetting,
    private readonly running: RunningTelemetrySettings,
  ) {}

  /**
   * At The Office's start: starts the bundled Grafana when wanted, and stops The Office's own when
   * not. Never calls Docker when it isn't wanted and The Office never started one.
   */
  async keepAtStart(): Promise<void> {
    if (this.setByEnvironment()) return;
    if (this.isWanted(await this.saved.read())) {
      await this.start();
      return;
    }
    await this.oneAtATime(async () => {
      const state = await this.grafana.state();
      if (state === "absent" || state === "stopped") return;
      await this.grafana.stop();
      this.logger.log(`Stopped the bundled Grafana (${BUNDLED_GRAFANA_PROJECT}): it isn't chosen.`);
    }).catch((error: unknown) => {
      this.logger.warn(`The bundled Grafana couldn't be stopped. ${messageOf(error)}`);
    });
  }

  /**
   * Starts the bundled Grafana, stopping an earlier one that holds its ports first, and answers
   * once it runs or failed, never rejecting, as a failure shows on the card; a start asked for
   * while one runs joins it.
   */
  start(): Promise<void> {
    if (this.activity.kind === "starting") return this.activity.started;
    const started = this.oneAtATime(async () => {
      await this.stopEarlierGrafana();
      await this.grafana.start();
    }).then(
      () => this.ran(),
      (error: unknown) => this.failed(error),
    );
    this.activity = { kind: "starting", started };
    return started;
  }

  private ran(): void {
    this.activity = { kind: "idle" };
    this.logger.log(`The bundled Grafana runs, at ${BUNDLED_GRAFANA_ADDRESS}.`);
  }

  private failed(error: unknown): void {
    const problem = problemOf(error);
    this.activity = { kind: "failed", problem };
    this.logger.warn(`The bundled Grafana couldn't start. ${problemWords(problem)}`);
  }

  /** The bundled Grafana as the card shows it, for the saved choice. */
  async status(saved: TelemetryChoice | undefined): Promise<BundledGrafanaStatus> {
    const shown = { address: BUNDLED_GRAFANA_ADDRESS, earlierStopped: [...this.earlierStopped] };
    if (this.setByEnvironment() || saved?.kind !== "bundled-grafana") {
      return { state: "not-wanted", ...shown };
    }
    switch (this.activity.kind) {
      case "starting":
        return { state: "starting", ...shown };
      case "failed":
        return { ...(await this.failedStatus(this.activity.problem)), ...shown };
      case "idle":
        return { ...(await this.runStatus()), ...shown };
    }
  }

  /** Whether the bundled Grafana is wanted: unless the environment sets telemetry. */
  isWanted(saved: TelemetryChoice | undefined): boolean {
    if (this.setByEnvironment()) return false;
    const inEffect = this.running.inEffect;
    return (
      saved?.kind === "bundled-grafana" ||
      (inEffect.kind === "export" && inEffect.endpoint === BUNDLED_GRAFANA_ENDPOINT)
    );
  }

  /**
   * A start that failed in this run, unless Docker now reports it running: a first pull can
   * outlast `up`'s wait, and the container still becomes healthy after it.
   */
  private async failedStatus(
    problem: BundledGrafanaProblem,
  ): Promise<Pick<BundledGrafanaStatus, "state" | "problem">> {
    const run = await this.runStatus();
    return run.state === "running" ? run : { state: "failed", problem: problemWords(problem) };
  }

  private async runStatus(): Promise<Pick<BundledGrafanaStatus, "state" | "problem">> {
    try {
      switch (await this.grafana.state()) {
        case "running":
          return { state: "running" };
        case "starting":
          return { state: "starting" };
        case "unhealthy":
          return { state: "failed", problem: problemWords({ kind: "unhealthy" }) };
        case "absent":
        case "stopped":
          return { state: "failed", problem: problemWords({ kind: "not-running" }) };
      }
    } catch (error) {
      return { state: "failed", problem: problemWords(problemOf(error)) };
    }
  }

  private async stopEarlierGrafana(): Promise<void> {
    const earlier = await this.grafana.earlierContainers();
    if (earlier.length === 0) return;
    await this.grafana.stopEarlier(earlier);
    this.earlierStopped = [...new Set([...this.earlierStopped, ...earlier])];
    this.logger.log(
      `Stopped the earlier bundled Grafana (${earlier.join(", ")}), which holds the same ports; it is kept, not removed.`,
    );
  }

  private oneAtATime<T>(call: () => Promise<T>): Promise<T> {
    const result = this.calls.then(call);
    this.calls = result.catch(() => undefined);
    return result;
  }

  private setByEnvironment(): boolean {
    return isSetByEnvironment(this.running.inEffect);
  }
}

function problemOf(error: unknown): BundledGrafanaProblem {
  return error instanceof BundledGrafanaFailed
    ? error.problem
    : { kind: "other", detail: messageOf(error) };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
