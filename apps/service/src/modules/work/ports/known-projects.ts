/** What Work needs to know of a Project: that it exists, and the Pipeline a new Task follows. */
export interface KnownProject {
  readonly id: string;
  readonly defaultPipeline: string;
}

/** The Projects Ideas and Tasks belong to, which the Projects module keeps; the composition root binds it. */
export abstract class KnownProjects {
  /** Undefined when there is no such Project. */
  abstract find(id: string): Promise<KnownProject | undefined>;
}
