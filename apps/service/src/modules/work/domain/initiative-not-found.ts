export class InitiativeNotFound extends Error {
  constructor(readonly initiativeId: string) {
    super(`There is no Initiative "${initiativeId}".`);
    this.name = "InitiativeNotFound";
  }
}
