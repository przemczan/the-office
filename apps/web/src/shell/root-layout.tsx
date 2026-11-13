import { useQuery } from "@tanstack/react-query";
import { Outlet, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SignedOut } from "../api/api-client.ts";
import { useConnectedEventStream } from "../api/event-stream-provider.tsx";
import { SIGN_IN_PATH, userQueries } from "../api/users.ts";
import { Shell } from "./shell.tsx";

/**
 * Every page's frame: the sign-in page alone, bare, and every other page in the shell, shown only
 * once the account has answered (spec §2.10).
 */
export function RootLayout(): ReactNode {
  // By the matches shown rather than the location, which changes as a navigation starts: the
  // shell's pages would otherwise show for a moment outside it, and the sign-in page inside it.
  const onSignInPage = useMatches({
    select: (matches) => matches.some((match) => match.routeId === SIGN_IN_PATH),
  });
  if (onSignInPage) return <Outlet />;
  return (
    <SignedIn>
      <Shell />
    </SignedIn>
  );
}

/**
 * Shows the shell once the account has answered, and only then connects the event stream, so a
 * browser that isn't signed in opens no WebSocket: its account's 401 sends it to the sign-in page.
 * Any other failure, such as the service being down, still shows the shell, which says so.
 */
function SignedIn({ children }: { readonly children: ReactNode }): ReactNode {
  const account = useQuery(userQueries.account());
  useConnectedEventStream(account.data !== undefined);
  if (account.isPending || account.error instanceof SignedOut) return null;
  return children;
}
