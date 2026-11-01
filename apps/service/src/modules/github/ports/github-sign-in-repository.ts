import type { KeptSignIn } from "../domain/sign-in.js";

/** Where Sign in with GitHub is kept: one at a time, its tokens never leaving the service. */
export abstract class GitHubSignInRepository {
  /** Undefined when signed out by the user, or never signed in. */
  abstract read(): Promise<KeptSignIn | undefined>;
  /** Replaces whatever was kept; undefined forgets it, tokens and reason alike. */
  abstract replace(signIn: KeptSignIn | undefined): Promise<void>;
}
