import type { KeptSignIn } from "../domain/sign-in.js";
import { GitHubSignInRepository } from "./github-sign-in-repository.js";

/** Sign in with GitHub in memory, for tests that don't need the database. */
export class GitHubSignInForTests extends GitHubSignInRepository {
  signIn: KeptSignIn | undefined;

  read(): Promise<KeptSignIn | undefined> {
    return Promise.resolve(this.signIn);
  }

  replace(signIn: KeptSignIn | undefined): Promise<void> {
    this.signIn = signIn;
    return Promise.resolve();
  }
}

/**
 * Replaces the kept sign-in with one signed in on `accessToken`, wherever the github module is
 * imported, for a test that checks the token goes nowhere it shouldn't.
 */
export function signedInWithGitHubForTests(accessToken: string): {
  readonly provide: typeof GitHubSignInRepository;
  readonly useValue: GitHubSignInRepository;
} {
  const signIns = new GitHubSignInForTests();
  signIns.signIn = {
    status: "signed-in",
    login: "office-user",
    tokens: {
      accessToken,
      accessTokenExpiresAt: undefined,
      refreshToken: undefined,
      refreshTokenExpiresAt: undefined,
    },
  };
  return { provide: GitHubSignInRepository, useValue: signIns };
}
