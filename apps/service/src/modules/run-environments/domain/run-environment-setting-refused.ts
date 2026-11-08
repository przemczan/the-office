/** Why a Project's Run environment setting can't change, or it can't be set up, in the UI's words. */
export class RunEnvironmentSettingRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "RunEnvironmentSettingRefused";
  }
}

export class RunEnvironmentProjectNotFound extends Error {
  constructor(readonly projectId: string) {
    super(`There is no Project "${projectId}".`);
    this.name = "RunEnvironmentProjectNotFound";
  }
}
