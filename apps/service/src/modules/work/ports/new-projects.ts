import type { NewProject } from "../../projects/index.js";

/** A Project as added, as far as Work reads it. */
export interface AddedProject {
  readonly id: string;
  readonly name: string;
}

/**
 * Adding a Project, which the Projects module does and judges, for a Proposal of one to onboard:
 * by its repository's folder, or by its Repository URL with `path` the folder it is cloned into.
 * The composition root binds it.
 */
export abstract class NewProjects {
  /** The folder a Repository URL is cloned into; refused, with Projects' own error, for one The Office doesn't clone. */
  abstract clonePathOf(url: string): string;

  /** Every reason `add` would refuse the Project now, with nothing cloned; empty when it can be added. */
  abstract newProjectProblems(project: NewProject): Promise<string[]>;

  /** The Project added from the repository at `path`; undefined when none is. */
  abstract findByPath(path: string): Promise<AddedProject | undefined>;

  /**
   * Clones a Project by Repository URL first and waits for it. Refused, with Projects' own error,
   * when the Project breaks a rule or its clone fails.
   */
  abstract add(project: NewProject): Promise<AddedProject>;
}
