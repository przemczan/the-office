import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import type { SignInOutcome } from "@the-office/contracts";
import { returnPathOf, SIGN_IN_CODE_PATH } from "../../api/users.ts";

/**
 * What a sign-in's outcome leads to. Signed in, the page returns to where `?returnTo=` says (a path of
 * this app only, else home), with nothing kept from before, which may have been another user's.
 * Asked for the authenticator code, it goes to the code page, which returns there in turn.
 */
export function useSignedIn(): (outcome: SignInOutcome) => void {
  const queryClient = useQueryClient();
  const router = useRouter();
  // The sign-in page and the code page both carry it.
  const returnTo = useSearch({ strict: false, select: (search) => search.returnTo });
  return (outcome) => {
    switch (outcome.outcome) {
      case "signed-in":
        queryClient.clear();
        router.history.replace(returnPathOf(returnTo));
        return;
      case "code-needed":
        void router.navigate({
          to: SIGN_IN_CODE_PATH,
          search: returnTo === undefined ? {} : { returnTo },
          replace: true,
        });
        return;
      default: {
        const unknown: never = outcome;
        throw new Error(`The sign-in ended as nothing the page knows: ${JSON.stringify(unknown)}.`);
      }
    }
  };
}
