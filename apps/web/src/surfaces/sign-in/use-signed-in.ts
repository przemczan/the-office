import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import type { SignInOutcome } from "@the-office/contracts";
import { returnPathOf } from "../../api/users.ts";

/**
 * What a sign-in's outcome leads to. Signed in, the page returns to where `?returnTo=` says (a path of
 * this app only, else home), with nothing kept from before, which may have been another user's.
 * A second step, such as an authenticator code, joins the switch with its Task.
 */
export function useSignedIn(): (outcome: SignInOutcome) => void {
  const queryClient = useQueryClient();
  const router = useRouter();
  const returnTo = useSearch({ from: "/sign-in", select: (search) => search.returnTo });
  return (outcome) => {
    switch (outcome.outcome) {
      case "signed-in":
        queryClient.clear();
        router.history.replace(returnPathOf(returnTo));
        return;
      default: {
        const unknown: never = outcome.outcome;
        throw new Error(`The sign-in ended as nothing the page knows: ${String(unknown)}.`);
      }
    }
  };
}
