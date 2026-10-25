export class ProjectNotFound extends Error {
  constructor(readonly projectId: string) {
    super(`There is no Project "${projectId}".`);
    this.name = "ProjectNotFound";
  }
}
