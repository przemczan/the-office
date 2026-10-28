import type { StageProblem } from "./pipeline.js";

/**
 * An edit of a Task's Stages, or of a library Pipeline, that can't be saved, with every reason, in
 * the UI's words.
 */
export class StagesEditRefused extends Error {
  constructor(readonly problems: readonly StageProblem[]) {
    super(problems.map(({ text }) => text).join(" "));
    this.name = "StagesEditRefused";
  }
}
