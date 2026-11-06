/**
 * What Work needs to know of a Project: that it exists, the Pipeline a new Task follows, and what
 * a Task's Brief says of it.
 */
export interface KnownProject {
  readonly id: string;
  readonly name: string;
  readonly baseBranch: string;
  readonly defaultPipeline: string;
  /** Its commands by their key (install, build, lint, test); empty for one it doesn't run. */
  readonly commands: Readonly<Record<string, string>>;
  /** Whether sessions on its Tasks also get the repository's own skills. */
  readonly useProjectSkills: boolean;
  /** The keys of the repository's skills and commands the Project turned off, each by itself. */
  readonly projectSkillsOff: readonly string[];
}

/** The Projects Ideas and Tasks belong to, which the Projects module keeps; the composition root binds it. */
export abstract class KnownProjects {
  /** Undefined when there is no such Project. */
  abstract find(id: string): Promise<KnownProject | undefined>;
}
