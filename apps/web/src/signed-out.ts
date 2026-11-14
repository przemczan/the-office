import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { shouldRetry, SignedOut } from "./api/api-client.ts";
import { SIGN_IN_CODE_PATH, SIGN_IN_PATH } from "./api/users.ts";
import type { OfficeRouter } from "./router.tsx";

/**
 * The app's query client: a query or a change the service answers 401 (`SignedOut`) calls
 * `onSignedOut`, whichever page asked.
 */
export function officeQueryClient(onSignedOut: () => void): QueryClient {
  const signedOut = (error: Error): void => {
    if (error instanceof SignedOut) onSignedOut();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: signedOut }),
    mutationCache: new MutationCache({ onError: signedOut }),
    defaultOptions: { queries: { retry: shouldRetry } },
  });
}

/**
 * Sends the browser to the sign-in page, which returns to the page shown now once signed in (its
 * path and query, as `?returnTo=`). On the sign-in page already, it stays. From the code page,
 * whose pending sign-in has ended, it signs in again for where that page was to return to.
 */
export function sendToSignIn(router: OfficeRouter): void {
  const { pathname, searchStr, search } = router.state.location;
  if (pathname === SIGN_IN_PATH) return;
  const returnTo = pathname === SIGN_IN_CODE_PATH ? search.returnTo : `${pathname}${searchStr}`;
  void router.navigate({
    to: SIGN_IN_PATH,
    search: returnTo === undefined ? {} : { returnTo },
    replace: true,
  });
}
