import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import type { SignInOutcome } from "@the-office/contracts";
import { returnPathOf, userQueries } from "../../api/users.ts";
import { adoptAccountAppearance } from "../../shell/account-appearance.tsx";

/**
 * A sign-in's outcome once it has signed in or goes on to a step after its way; a one-time
 * password's `set-password` is the password form's own, which asks for the new one in place.
 */
export type SignedInOutcome = Exclude<SignInOutcome, { readonly outcome: "set-password" }>;

/**
 * What a sign-in's outcome leads to. Signed in, the page reads the account first and shows its
 * appearance, so the shell's first paint is the user's own, then returns to where `?returnTo=` says
 * (a path of this app only, else home), with nothing kept from before, which may have been another
 * user's. A second step, such as an authenticator code, joins the switch with its Task.
 */
export function useSignedIn(): (outcome: SignedInOutcome) => Promise<void> {
  const queryClient = useQueryClient();
  const router = useRouter();
  const returnTo = useSearch({ from: "/sign-in", select: (search) => search.returnTo });
  return async (outcome) => {
    switch (outcome.outcome) {
      case "signed-in": {
        queryClient.clear();
        // Should the account not answer, the shell reads it again and says why.
        const account = await queryClient.fetchQuery(userQueries.account()).catch(() => undefined);
        if (account !== undefined) adoptAccountAppearance(account);
        router.history.replace(returnPathOf(returnTo));
        return;
      }
      default: {
        const unknown: never = outcome.outcome;
        throw new Error(`The sign-in ended as nothing the page knows: ${String(unknown)}.`);
      }
    }
  };
}
