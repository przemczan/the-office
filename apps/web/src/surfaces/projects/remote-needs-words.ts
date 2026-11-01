import type { RemoteNeeds } from "@the-office/contracts";

/** The Project page's line on its remote: which part of the Office identity it needs, and what is missing. */
export interface RemoteNeedsLine {
  readonly needs: string;
  /** What is missing, in the user's words; empty when nothing is. */
  readonly missing: readonly string[];
  /** Whether Settings › Office identity is where the user sees or fixes it. */
  readonly inSettings: boolean;
}

export function remoteNeedsLine(needs: RemoteNeeds): RemoteNeedsLine {
  switch (needs.kind) {
    case "github-https":
      return {
        needs: "Its remote is GitHub over https, reached with Sign in with GitHub.",
        missing: needs.missing.length > 0 ? ["Not signed in with GitHub."] : [],
        inSettings: true,
      };
    case "ssh":
      return {
        needs: `Its remote, ${hostOf(needs.host, needs.port)}, is reached over ssh with the Office ssh key, whose public half the host needs.`,
        missing: needs.missing.map(
          (missing) =>
            ({
              "office-ssh-key": "The Office ssh key isn't made yet.",
              // Reading the remote's needs lists the host among the Unconfirmed hosts.
              "host-key": `${needs.host}'s host key isn't confirmed yet: it becomes a Trusted host once its fingerprint is confirmed.`,
            })[missing],
        ),
        inSettings: true,
      };
    case "anonymous-https":
      return {
        needs: `Its remote, ${needs.host}, is reached anonymously over https, so only a public repository can be fetched.`,
        missing: [],
        inSettings: false,
      };
    case "local":
      return {
        needs:
          "Its remote is a folder on this workstation, which needs nothing of the Office identity.",
        missing: [],
        inSettings: false,
      };
    case "refused":
      return {
        needs: `Its remote is reached by ${needs.scheme}, which The Office refuses: it reaches remotes over https and ssh only.`,
        missing: [],
        inSettings: false,
      };
  }
}

const SSH_PORT = 22;

/** ssh's own port is left out, as a remote's URL leaves it out. */
function hostOf(host: string, port: number): string {
  return port === SSH_PORT ? host : `${host}:${port}`;
}
