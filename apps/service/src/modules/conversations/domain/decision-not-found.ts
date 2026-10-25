export class DecisionNotFound extends Error {
  constructor(readonly decisionId: string) {
    super(`There is no Decision "${decisionId}".`);
    this.name = "DecisionNotFound";
  }
}
