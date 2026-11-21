import { Initiatives, type InitiativeForTestInstances } from "./initiatives.js";

/** Work's Initiatives as a test makes them. */
export class InitiativesForTests extends Initiatives {
  readonly initiatives = new Map<string, InitiativeForTestInstances>();

  find(id: string): Promise<InitiativeForTestInstances | undefined> {
    return Promise.resolve(this.initiatives.get(id));
  }

  activeInitiativeOnBranch(
    projectId: string,
    branch: string,
  ): Promise<InitiativeForTestInstances | undefined> {
    return Promise.resolve(
      [...this.initiatives.values()].find(
        (initiative) =>
          initiative.state === "active" &&
          initiative.branches.some(
            (each) => each.projectId === projectId && each.branch === branch,
          ),
      ),
    );
  }

  put(initiative: InitiativeForTestInstances): void {
    this.initiatives.set(initiative.id, initiative);
  }
}
