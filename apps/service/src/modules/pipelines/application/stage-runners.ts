import { Injectable } from "@nestjs/common";
import type { StageKind } from "../domain/stage.js";
import type { StageRunner } from "./stage-runner.js";

type RunnersByKind = { [Kind in StageKind]?: StageRunner<Kind> };

/**
 * The runner of each Stage kind, registered as its provider starts, so the walk names no kind and
 * a kind's work is added or replaced without touching it.
 */
@Injectable()
export class StageRunners {
  private readonly runners: RunnersByKind = {};

  register<Kind extends StageKind>(kind: Kind, runner: StageRunner<Kind>): void {
    if (this.runners[kind]) throw new Error(`Stages of kind "${kind}" already have a runner.`);
    // Safe: the key and the runner share one kind.
    (this.runners as Record<Kind, StageRunner<Kind>>)[kind] = runner;
  }

  /** Undefined for a kind The Office can't run yet. */
  runnerOf<Kind extends StageKind>(kind: Kind): StageRunner<Kind> | undefined {
    return this.runners[kind] as StageRunner<Kind> | undefined;
  }
}
