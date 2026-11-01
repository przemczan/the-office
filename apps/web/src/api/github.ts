import { queryOptions } from "@tanstack/react-query";
import {
  gitHubAppManifestFormSchema,
  gitHubRepositoryListSchema,
  gitHubSignInSchema,
  gitHubStateSchema,
  type GitHubAppManifestForm,
  type GitHubSignIn,
  type GitHubWebEvent,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";
import { REMOTE_NEEDS } from "./projects.ts";

const GITHUB = ["github"] as const;

export const gitHubQueries = {
  /** Sign in with GitHub: whether the App is registered, and who is signed in. */
  state: () =>
    queryOptions({
      queryKey: GITHUB,
      queryFn: ({ signal }) => getFromApi("/github", gitHubStateSchema, signal),
    }),
  /**
   * The repositories the App is installed on that the signed-in user reaches; the service refuses
   * it while signed out. Under Sign in with GitHub's key, so signing in or out refreshes it.
   */
  repositories: () =>
    queryOptions({
      queryKey: [...GITHUB, "repositories"],
      queryFn: ({ signal }) =>
        getFromApi("/github/repositories", gitHubRepositoryListSchema, signal),
    }),
};

/** The form the browser posts to GitHub to register the GitHub App by its manifest. */
export function gitHubAppManifestForm(): Promise<GitHubAppManifestForm> {
  return getFromApi("/github/app/manifest", gitHubAppManifestFormSchema);
}

/** GitHub's authorize page for this sign-in, which sends the browser back to The Office. */
export function startGitHubSignIn(): Promise<GitHubSignIn> {
  return sendToApi("POST", "/github/sign-in", {}, gitHubSignInSchema);
}

/** Forgets the user token. */
export function signOutOfGitHub(): Promise<void> {
  return deleteFromApi("/github/sign-in");
}

export const gitHubEventInvalidations: Readonly<
  Record<GitHubWebEvent["type"], EventInvalidations[string]>
> = {
  // What a Project's remote lacks may be the sign-in.
  "github.changed": () => [GITHUB, REMOTE_NEEDS],
};
