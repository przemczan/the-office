import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useMatches, useSearch } from "@tanstack/react-router";
import {
  GITHUB_APP_REGISTRATION_FAILED_PARAMETER,
  GITHUB_SIGN_IN_FAILED_PARAMETER,
  type FirstRunSetup,
} from "@the-office/contracts";
import type { ReactNode } from "react";
import { SignedOut } from "../api/api-client.ts";
import { useConnectedEventStream } from "../api/event-stream-provider.tsx";
import { SIGN_IN_CODE_PATH, SIGN_IN_PATH, userQueries } from "../api/users.ts";
import { AccountAppearance } from "./account-appearance.tsx";
import { Shell } from "./shell.tsx";
import "./shell.css";
import { TestInstanceBanner } from "./test-instance-banner.tsx";
import { ToastProvider } from "./toasts.tsx";

/** The pages shown before signing in, bare: the sign-in page and the authenticator code's. */
const BARE_PAGES: ReadonlySet<string> = new Set([SIGN_IN_PATH, SIGN_IN_CODE_PATH]);

/** First-run setup's page, signed in but outside the shell. */
const SETUP_PAGE = "/setup";

/** Settings › Office identity, where GitHub's return always lands. */
const OFFICE_IDENTITY_PAGE = "/settings/office-identity";

/**
 * Pages that stay reachable while First-run setup is open: Settings › Engines, which its engine
 * step links to for an API engine.
 */
const OPEN_DURING_SETUP: ReadonlySet<string> = new Set([SETUP_PAGE, "/settings/engines"]);

/**
 * Every page's frame: the sign-in pages alone, bare; First-run setup signed in, without the shell;
 * and every other page in the shell, shown only once the account has answered (spec §2.10). A test
 * instance's banner is above each of them.
 */
export function RootLayout(): ReactNode {
  // By the matches shown rather than the location, which changes as a navigation starts: the
  // shell's pages would otherwise show for a moment outside it, and the sign-in page inside it.
  const frame = useMatches({
    select: (matches) =>
      matches.some((match) => BARE_PAGES.has(match.routeId))
        ? "bare"
        : matches.some((match) => match.routeId === SETUP_PAGE)
          ? "setup"
          : "shell",
  });
  return (
    <>
      <TestInstanceBanner />
      {frame === "bare" ? (
        <Outlet />
      ) : (
        <SignedIn>{frame === "setup" ? <SetupFrame /> : <Shell />}</SignedIn>
      )}
    </>
  );
}

/**
 * First-run setup's frame: the account's appearance and the toasts its cards confirm with, but no
 * rail, top bar or strip.
 */
function SetupFrame(): ReactNode {
  return (
    <ToastProvider>
      <AccountAppearance />
      <Outlet />
    </ToastProvider>
  );
}

/**
 * Shows the page once the account and First-run setup have answered, and only then connects the
 * event stream, so a browser that isn't signed in opens no WebSocket: its account's 401 sends it
 * to the sign-in page. Any other failure, such as the service being down, still shows the shell,
 * which says so. While First-run setup's basics are open every page goes to it; once closed, its
 * page goes home.
 */
function SignedIn({ children }: { readonly children: ReactNode }): ReactNode {
  const account = useQuery(userQueries.account());
  const signedIn = account.data !== undefined;
  useConnectedEventStream(signedIn);
  const setup = useQuery({ ...userQueries.firstRunSetup(), enabled: signedIn });
  if (account.isPending || account.error instanceof SignedOut) return null;
  if (signedIn && setup.isPending) return null;
  return <FirstRunSetupRedirect basics={setup.data?.basics}>{children}</FirstRunSetupRedirect>;
}

/** Sends the page to First-run setup while its basics are open, and its page home once closed. */
function FirstRunSetupRedirect({
  basics,
  children,
}: {
  /** Undefined when it couldn't be read: the page shows as it is. */
  readonly basics: FirstRunSetup["basics"] | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const shown = useMatches({ select: (matches) => matches.at(-1)?.routeId });
  const search = useSearch({ strict: false });
  if (basics === "closed" && shown === SETUP_PAGE) return <Navigate to="/now" replace />;
  if (basics !== "open" || (shown !== undefined && OPEN_DURING_SETUP.has(shown))) return children;
  if (shown === OFFICE_IDENTITY_PAGE) {
    // GitHub's return lands on Settings › Office identity: on to the GitHub step, with why it failed.
    const registrationFailed = search[GITHUB_APP_REGISTRATION_FAILED_PARAMETER];
    const signInFailed = search[GITHUB_SIGN_IN_FAILED_PARAMETER];
    return (
      <Navigate
        to="/setup"
        search={{
          step: "github",
          ...(registrationFailed !== undefined && {
            [GITHUB_APP_REGISTRATION_FAILED_PARAMETER]: registrationFailed,
          }),
          ...(signInFailed !== undefined && { [GITHUB_SIGN_IN_FAILED_PARAMETER]: signInFailed }),
        }}
        replace
      />
    );
  }
  return <Navigate to="/setup" replace />;
}
