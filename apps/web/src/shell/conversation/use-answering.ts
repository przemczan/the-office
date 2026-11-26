import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Proposal, ProposalApplication } from "@the-office/contracts";
import { applyProposal, declineProposal, threadQueries } from "../../api/conversations.ts";

export interface ProposalAnswering {
  readonly applying: UseMutationResult<Proposal, Error, ProposalApplication>;
  readonly declining: UseMutationResult<Proposal, Error, void>;
  /** Either is on its way, so neither can be clicked. */
  readonly busy: boolean;
  readonly error: Error | null;
}

/**
 * Applying and declining the Proposal; each refreshes the Thread's log, whose message carries the
 * Proposal as it is now, and applying also what it changed (`changes`). A refusal leaves it open
 * and is shown on the card.
 */
export function useAnswering(
  proposal: Proposal,
  changes: readonly QueryKey[],
  onApplied: (applied: Proposal) => void,
): ProposalAnswering {
  const queryClient = useQueryClient();
  const refreshThread = (): Promise<void> =>
    queryClient.invalidateQueries(threadQueries.messages(proposal.threadId));
  const applying = useMutation({
    mutationFn: (application: ProposalApplication) => applyProposal(proposal.id, application),
    // A refusal may have marked the Proposal Out of date, which the log's message now carries.
    onError: refreshThread,
    onSuccess: async (applied) => {
      onApplied(applied);
      await Promise.all([
        refreshThread(),
        ...changes.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ]);
    },
  });
  const declining = useMutation({
    mutationFn: () => declineProposal(proposal.id),
    onSuccess: refreshThread,
  });
  return {
    applying,
    declining,
    busy: applying.isPending || declining.isPending,
    error: applying.error ?? declining.error,
  };
}
