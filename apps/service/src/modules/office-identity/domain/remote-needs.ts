/** GitHub in the user's words, and the sign-in its https remotes take. */
export const GITHUB_SIGN_IN = { site: "GitHub", signIn: "Sign in with GitHub" } as const;

/** What a remote reached over ssh may lack: the key not yet made, or the host's key not trusted. */
export type MissingForSsh = "office-ssh-key" | "host-key";

/**
 * Which part of the Office identity a git remote needs (spec §5.5 Defaults) and what of it is
 * missing. A local remote needs none; a transport other than https and ssh is refused.
 */
export type RemoteNeeds =
  | {
      /** An https host whose remotes take a sign-in of the identity: GitHub's website. */
      readonly kind: "signed-in-https";
      /** The host in the user's words, such as GitHub. */
      readonly site: string;
      /** The sign-in it takes, in the user's words, such as Sign in with GitHub. */
      readonly signIn: string;
      readonly missing: readonly "sign-in"[];
    }
  | {
      readonly kind: "ssh";
      readonly host: string;
      readonly port: number;
      readonly missing: readonly MissingForSsh[];
    }
  | { readonly kind: "anonymous-https"; readonly host: string }
  | { readonly kind: "local" }
  | { readonly kind: "refused"; readonly scheme: string };
