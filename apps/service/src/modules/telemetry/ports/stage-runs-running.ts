/** The Stage runs Pipelines runs now; the composition root binds it. */
export abstract class StageRunsRunning {
  /** How many Agent and Script Stage runs are running now, on any Task. */
  abstract count(): number;
}
