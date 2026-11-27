import type { GitHubState } from "@the-office/contracts";
import type { GitHubPermissions, LackedPermissions } from "../../application/github-permissions.js";
import type { GitHubSignIn, SignInState } from "../../application/github-sign-in.js";
import { appInstallUrl, type GitHubUrls } from "../../application/github-urls.js";

/** Sign in with GitHub as the web reads it: the sign-in, and for a signed-in user what the App still lacks. */
export async function githubStateResponse(
  signIn: GitHubSignIn,
  permissions: GitHubPermissions,
  urls: GitHubUrls,
): Promise<GitHubState> {
  const state = await signIn.state();
  const lacking = state.status === "signed-in" ? await permissions.lacking() : undefined;
  return webStateOf(state, lacking, urls);
}

/** Only the App's slug, owner and install page reach the web: never its client secret or a token. */
function webStateOf(
  state: SignInState,
  lacking: LackedPermissions | undefined,
  urls: GitHubUrls,
): GitHubState {
  if (state.status === "not-registered") return state;
  const { slug, owner } = state.app;
  const app = { slug, owner, installUrl: appInstallUrl(urls, slug).href };
  if (state.status === "signed-in") {
    const permissions = lacking && {
      missing: lacking.missing.map(({ name, level }) => ({ name, level })),
      appPermissionsUrl: lacking.appPermissionsUrl,
      installations: lacking.installations.map(({ account, acceptUrl }) => ({
        account,
        acceptUrl,
      })),
    };
    return { status: "signed-in", app, login: state.login, permissions: permissions ?? null };
  }
  return {
    status: "signed-out",
    app,
    ...(state.reason && { reason: { text: state.reason.text } }),
  };
}
