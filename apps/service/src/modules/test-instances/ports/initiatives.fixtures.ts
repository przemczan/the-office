import { Initiatives, type InitiativeForTestInstances } from "./initiatives.js";

/** Work's Initiatives as a test makes them. */
export class InitiativesForTests extends Initiatives {
  readonly initiatives = new Map<string, InitiativeForTestInstances>();

  find(id: string): Promise<InitiativeForTestInstances | undefined> {
    return Promise.resolve(this.initiatives.get(id));
  }

  put(initiative: InitiativeForTestInstances): void {
    this.initiatives.set(initiative.id, initiative);
  }
}
