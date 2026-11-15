/**
 * The bundled Grafana, grafana/otel-lgtm, at this pin: an update of it is a change of this line, and
 * the next start recreates the container on the new image, keeping its data volume.
 */
export const BUNDLED_GRAFANA_IMAGE =
  "grafana/otel-lgtm:0.38.0@sha256:75cdf892daffadf3763ef61c16a6d7f8586216fce0b40bba7874a0b053121084";

/** The Compose project The Office runs the bundled Grafana as, the only one it touches for it. */
export const BUNDLED_GRAFANA_PROJECT = "the-office-grafana";

/**
 * What runs of The Office's own bundled Grafana: no container of its project (`absent`), a
 * container that is stopped, starting (running, its healthcheck not yet passed), `unhealthy`, or
 * `running` and healthy.
 */
export type BundledGrafanaRunState = "absent" | "stopped" | "starting" | "unhealthy" | "running";

/** Why the bundled Grafana couldn't start or be read, as the card tells it. */
export type BundledGrafanaProblem =
  | { readonly kind: "docker-unreachable" }
  | { readonly kind: "port-taken" }
  | { readonly kind: "image-not-pulled" }
  | { readonly kind: "not-healthy" }
  | { readonly kind: "unhealthy" }
  | { readonly kind: "not-running" }
  | { readonly kind: "other"; readonly detail: string };

/** Thrown by a `BundledGrafana` whose Docker call failed, with why. */
export class BundledGrafanaFailed extends Error {
  constructor(readonly problem: BundledGrafanaProblem) {
    super(problemWords(problem));
    this.name = "BundledGrafanaFailed";
  }
}

/** The problem in plain words, for the card and the log. */
export function problemWords(problem: BundledGrafanaProblem): string {
  switch (problem.kind) {
    case "docker-unreachable":
      return "Docker isn't installed, or The Office can't reach it.";
    case "port-taken":
      return "Another program on this machine holds port 3300, 4317 or 4318.";
    case "image-not-pulled":
      return "The image grafana/otel-lgtm couldn't be pulled.";
    case "not-healthy":
      return "It didn't become healthy in time.";
    case "unhealthy":
      return "It runs, but its healthcheck fails.";
    case "not-running":
      return "It isn't running.";
    case "other":
      return `Docker couldn't start it: ${problem.detail}`;
  }
}

/**
 * The bundled Grafana as a Compose project of The Office's own (`BUNDLED_GRAFANA_PROJECT`), and the
 * bundled Grafana earlier releases ran, which holds the same ports. Each call throws
 * `BundledGrafanaFailed` when Docker fails it.
 */
export abstract class BundledGrafana {
  /** Starts it, or recreates it on a new pin, waiting until it is healthy; its data is kept. */
  abstract start(): Promise<void>;

  /** Stops it, keeping its container and data. */
  abstract stop(): Promise<void>;

  /** What runs of it; `absent`, with no Docker call, when The Office never started it. */
  abstract state(): Promise<BundledGrafanaRunState>;

  /**
   * The names of the earlier bundled Grafana's running containers: the `otel-lgtm` service of
   * Compose project `the-office`, or a container started by hand named `the-office-grafana`.
   */
  abstract earlierContainers(): Promise<readonly string[]>;

  /** Stops the earlier containers named, never removing them. */
  abstract stopEarlier(containers: readonly string[]): Promise<void>;
}
