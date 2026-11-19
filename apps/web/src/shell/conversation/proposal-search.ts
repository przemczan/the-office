/** The search parameter Show it on the flow opens a Pipeline with: the Proposal's id. */
export interface ProposalSearch {
  readonly proposal?: string;
}

export function proposalSearchOf(search: Record<string, unknown>): ProposalSearch {
  return typeof search["proposal"] === "string" ? { proposal: search["proposal"] } : {};
}
