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
