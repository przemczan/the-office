import { proposalSearchOf, type ProposalSearch } from "../conversation/proposal-search.ts";

/**
 * A Pipeline's address search: an open Proposal (Show it on the flow), and the key of the Stage its
 * flow editor opens picked, such as a template's linked Stage links to.
 */
export interface PipelineSearch extends ProposalSearch {
  readonly stage?: string;
}

export function pipelineSearchOf(search: Record<string, unknown>): PipelineSearch {
  const stage = search["stage"];
  return { ...proposalSearchOf(search), ...(typeof stage === "string" ? { stage } : {}) };
}
