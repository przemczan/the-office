/** A feature of a Project's that Work asks after before offering it (spec §2.1.1, "Feature switches"). */
export type WorkProjectFeature = "test-targets";

/** The Project's feature switches, which the Projects module keeps; bound to an adapter over it. */
export abstract class ProjectFeatureChecks {
  /**
   * Refused (TaskRefused, in Projects' words naming the feature and the Project) when the Project
   * has the feature switched off, or isn't there.
   */
  abstract ensureOn(projectId: string, feature: WorkProjectFeature): Promise<void>;
}
