/**
 * What Work needs to know of a Project: that it exists, the Pipeline a new Task follows, how many
 * of its Tasks may be started at once, and what a Task's Brief says of it.
 */
export interface KnownProject {
  readonly id: string;
  readonly name: string;
  readonly baseBranch: string;
  readonly defaultPipeline: string;
  /** Its install command line; empty while not set. */
  readonly installCommand: string;
  /** Its other commands, in its order; a command line is empty while not set. */
  readonly commands: readonly KnownProjectCommand[];
  /** Whether sessions on its Tasks also get the repository's own skills. */
  readonly useProjectSkills: boolean;
  /** The keys of the repository's skills and commands the Project turned off, each by itself. */
  readonly projectSkillsOff: readonly string[];
  /** How many of its Tasks may be started at once (In progress, Waiting on you or Paused). */
  readonly projectLimit: number;
}

/** One of a Project's commands, as a Brief names it. */
export interface KnownProjectCommand {
  readonly key: string;
  readonly name: string;
  readonly commandLine: string;
}

/** The Projects Ideas and Tasks belong to, which the Projects module keeps; the composition root binds it. */
export abstract class KnownProjects {
  /** Undefined when there is no such Project. */
  abstract find(id: string): Promise<KnownProject | undefined>;
}
