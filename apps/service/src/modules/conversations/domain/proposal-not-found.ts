export class ProposalNotFound extends Error {
  constructor(readonly proposalId: string) {
    super(`There is no Proposal "${proposalId}".`);
    this.name = "ProposalNotFound";
  }
}
