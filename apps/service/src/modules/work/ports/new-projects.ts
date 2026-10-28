import type { NewProject } from "../../projects/index.js";

/** A Project as added, as far as Work reads it. */
export interface AddedProject {
  readonly id: string;
  readonly name: string;
}

/**
 * Adding a Project, which the Projects module does and judges, for a Proposal of one to onboard;
 * the composition root binds it.
 */
export abstract class NewProjects {
  /** Every reason `add` would refuse the Project now; empty when it can be added. */
  abstract newProjectProblems(project: NewProject): Promise<string[]>;

  /** Refused, with Projects' own error, when the Project breaks a rule. */
  abstract add(project: NewProject): Promise<AddedProject>;
}
