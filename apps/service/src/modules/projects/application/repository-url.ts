import { join } from "node:path";
import { parseGitRemote } from "../../../platform/git-identity/git-remote.js";
import { GITHUB_HOST } from "../../../platform/git-identity/office-known-hosts.js";

/**
 * A Repository URL (spec §5.5 Defaults): an https, `ssh://` or `user@host:path` address of a
 * repository The Office clones, with where its clone goes.
 */
export interface RepositoryUrl {
  /** As the user gave it, without the spaces around it: what git is given and the Project keeps. */
  readonly url: string;
  /** Lower case, as hosts compare. */
  readonly host: string;
  /** The repository's path on the host, its owner's name or names first, without `.git`. */
  readonly path: readonly string[];
  readonly onGitHub: boolean;
}

export type RepositoryUrlReading =
  | { readonly kind: "url"; readonly repositoryUrl: RepositoryUrl }
  | { readonly kind: "refused"; readonly problem: string };

/** `[user@]host:path` or `[user@][host]:path`, as git's scp-like syntax reads it. */
const SCP_LIKE = /^(?:[^@/]+@)?(?:\[([^\]/]+)\]|([^:/[\]]+)):(.*)$/;
/** A host name or IPv4 address, which also names a folder on every system. */
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
/** A segment of the path that also names a folder on every system. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
/** Names Windows keeps for devices, with or without an extension. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

const CLONED_SCHEMES: ReadonlySet<string> = new Set(["https", "ssh", "git+ssh", "ssh+git"]);

const NOT_A_URL =
  "Give a git URL: https://host/owner/repository, ssh://host/owner/repository or user@host:owner/repository.";

/** Reads what the user typed as a Repository URL, or says why it isn't one The Office clones. */
export function readRepositoryUrl(given: string): RepositoryUrlReading {
  const url = given.trim();
  if (url === "") return refused("Give the repository's URL.");
  const remote = parseGitRemote(url);
  switch (remote.transport) {
    case "local":
      return refused(`${NOT_A_URL} A folder on this computer is added by its path.`);
    case "other":
      // parseGitRemote names https or ssh too when the URL can't be parsed.
      return refused(
        CLONED_SCHEMES.has(remote.scheme)
          ? NOT_A_URL
          : `The Office clones over https and ssh only, not ${remote.scheme}.`,
      );
    case "https":
    case "ssh":
      return hostAndPath(url);
  }
}

/** Where the repository's clone goes inside the repositories folder: its host, then its path. */
export function cloneFolderOf(repositoryUrl: RepositoryUrl): readonly string[] {
  // Lower case, so two spellings of one GitHub repository share a folder on every system.
  return [repositoryUrl.host, ...repositoryUrl.path.map((segment) => segment.toLowerCase())];
}

/** The full path of the repository's clone, given The Office's repositories folder. */
export function clonePathOf(repositoriesFolder: string, repositoryUrl: RepositoryUrl): string {
  return join(repositoriesFolder, ...cloneFolderOf(repositoryUrl));
}

function hostAndPath(url: string): RepositoryUrlReading {
  const parts = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? fromUrl(url) : fromScpLike(url);
  if (typeof parts === "string") return refused(parts);
  const host = parts.host.toLowerCase();
  if (!HOST.test(host)) return refused(`The Office can't keep a clone of a repository on ${host}.`);
  const path = pathSegments(parts.path);
  if (typeof path === "string") return refused(path);
  return { kind: "url", repositoryUrl: { url, host, path, onGitHub: host === GITHUB_HOST } };
}

function fromUrl(url: string): { host: string; path: string } | string {
  const parsed = new URL(url);
  if (parsed.protocol === "https:" && parsed.username !== "") {
    return "Give the URL without a user name or token in it: The Office reaches the repository with its own identity.";
  }
  if (parsed.password !== "") return "Give the URL without a password in it.";
  if (parsed.search !== "" || parsed.hash !== "") return NOT_A_URL;
  return { host: parsed.hostname, path: parsed.pathname };
}

function fromScpLike(url: string): { host: string; path: string } | string {
  const match = SCP_LIKE.exec(url);
  if (match === null) return NOT_A_URL;
  return { host: match[1] ?? match[2] ?? "", path: match[3] ?? "" };
}

function pathSegments(path: string): readonly string[] | string {
  const segments = path.replace(/^\/+|\/+$/g, "").split("/");
  const last = segments.length - 1;
  segments[last] = (segments[last] ?? "").replace(/\.git$/, "");
  if (segments.length < 2) return `${NOT_A_URL} It names a repository and its owner.`;
  const unusable = segments.find(
    (segment) => !SEGMENT.test(segment) || segment.endsWith(".") || WINDOWS_DEVICE.test(segment),
  );
  return unusable === undefined
    ? segments
    : `The Office can't keep a clone under the name "${unusable}": a repository's path holds letters, digits, ".", "_" and "-".`;
}

function refused(problem: string): RepositoryUrlReading {
  return { kind: "refused", problem };
}
