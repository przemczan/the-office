/** What a remote reached over ssh may lack: the key not yet made, or the host's key not trusted. */
export type MissingForSsh = "office-ssh-key" | "host-key";

/**
 * Which part of the Office identity a git remote needs (spec §5.5 Defaults) and what of it is
 * missing. A local remote needs none; a transport other than https and ssh is refused.
 */
export type RemoteNeeds =
  | { readonly kind: "github-https"; readonly missing: readonly "sign-in-with-github"[] }
  | {
      readonly kind: "ssh";
      readonly host: string;
      readonly port: number;
      readonly missing: readonly MissingForSsh[];
    }
  | { readonly kind: "anonymous-https"; readonly host: string }
  | { readonly kind: "local" }
  | { readonly kind: "refused"; readonly scheme: string };
