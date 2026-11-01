/** The default port of ssh, which known hosts name without one. */
export const SSH_PORT = 22;

/** What a git remote reaches, read as git reads a URL; which part of the Office identity it needs follows from it. */
export type GitRemote =
  | { readonly transport: "https"; readonly host: string }
  | { readonly transport: "ssh"; readonly host: string; readonly port: number }
  | { readonly transport: "local" }
  | { readonly transport: "other"; readonly scheme: string };

/** `<transport>::<address>`, which git hands to the remote helper of that name. */
const REMOTE_HELPER = /^([a-zA-Z0-9+.-]+)::/;
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;
const SSH_SCHEMES: ReadonlySet<string> = new Set(["ssh", "git+ssh", "ssh+git"]);
/** `C:\…` or `C:/…`, a Windows path, never a host named C. */
const DRIVE_PATH = /^[a-zA-Z]:[\\/]/;
/** git's scp-like syntax, `[user@]host:path` or `[user@][host:port]:path`. */
const SCP_LIKE = /^(?:[^@/]+@)?(?:\[([^\]/]+)\]|([^:/[\]]+)):/;

/** Reads a remote as git does (git's `url.c` and `connect.c`): a URL, the scp-like syntax or a path. */
export function parseGitRemote(remote: string): GitRemote {
  const helper = REMOTE_HELPER.exec(remote)?.[1];
  if (helper !== undefined) return { transport: "other", scheme: helper.toLowerCase() };
  const scheme = SCHEME.exec(remote)?.[1]?.toLowerCase();
  if (scheme !== undefined) return fromUrl(remote, scheme);
  if (DRIVE_PATH.test(remote)) return { transport: "local" };
  const scpLike = SCP_LIKE.exec(remote);
  if (scpLike === null) return { transport: "local" };
  const bracketed = scpLike[1];
  if (bracketed === undefined) return { transport: "ssh", host: scpLike[2] ?? "", port: SSH_PORT };
  const hostAndPort = /^(.+):(\d+)$/.exec(bracketed);
  return hostAndPort === null || hostAndPort[1]?.includes(":")
    ? { transport: "ssh", host: bracketed, port: SSH_PORT }
    : { transport: "ssh", host: hostAndPort[1] ?? "", port: Number(hostAndPort[2]) };
}

function fromUrl(remote: string, scheme: string): GitRemote {
  if (scheme === "file") return { transport: "local" };
  if (scheme !== "https" && !SSH_SCHEMES.has(scheme)) return { transport: "other", scheme };
  // A URL git couldn't reach either is none the identity serves.
  if (!URL.canParse(remote)) return { transport: "other", scheme };
  const url = new URL(remote);
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (scheme === "https") return { transport: "https", host };
  return { transport: "ssh", host, port: url.port === "" ? SSH_PORT : Number(url.port) };
}
