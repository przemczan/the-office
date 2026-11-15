// What an Office release's tarball holds (docs/releasing.md), apart from the filesystem: its names,
// its trimmed root package.json, its files, its stamp, and the checks of its node_modules.

export const RELEASE_ARCHES = ["x64", "arm64"] as const;
/** The Linux CPU a tarball is for, in Node's and npm's words (`process.arch`, `--cpu`). */
export type ReleaseArch = (typeof RELEASE_ARCHES)[number];

/** The workspaces a release carries: the service, the web app it serves, their contract, the launcher. */
export const RELEASE_WORKSPACES = [
  "apps/service",
  "apps/web",
  "packages/contracts",
  "tools/office-launcher",
] as const;

/**
 * The workspaces whose production dependencies the release installs. The web app's are bundled
 * into `apps/web/dist` by its build, so it needs none at run time.
 */
export const INSTALLED_WORKSPACES = [
  "apps/service",
  "packages/contracts",
  "tools/office-launcher",
] as const;

/** A release's version, as `--version` gives it: `major.minor.patch[-prerelease]`. */
export const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The root scripts a release keeps: what runs The Office and what sets it up. */
export const RELEASE_SCRIPTS = ["start", "set-password", "setup-token"] as const;

/** The file at a release's root that says which version and commit it is. */
export const RELEASE_STAMP_FILE = "office-release.json";

/** A file or folder the release copies from the checkout, at the same path. */
export interface ReleaseFile {
  readonly path: string;
}

/** What the release copies once `npm run build` has run; node_modules is installed separately. */
export const RELEASE_FILES: readonly ReleaseFile[] = [
  { path: "LICENSE" },
  { path: ".env.example" },
  { path: "apps/service/package.json" },
  { path: "apps/service/dist" },
  { path: "apps/service/drizzle" },
  { path: "apps/web/package.json" },
  { path: "apps/web/dist" },
  { path: "packages/contracts/package.json" },
  { path: "packages/contracts/dist" },
  { path: "tools/office-launcher/package.json" },
  { path: "tools/office-launcher/src" },
];

/** Whether a file inside one of RELEASE_FILES belongs in the release: no build state, no tests. */
export function isReleased(path: string): boolean {
  return !path.endsWith(".tsbuildinfo") && !/\.test\.[cm]?[jt]sx?$/.test(path);
}

export function releaseFolderName(version: string): string {
  return `the-office-${version}`;
}

export function tarballName(version: string, arch: ReleaseArch): string {
  return `the-office-${version}-linux-${arch}.tar.gz`;
}

/** A checksum file's line, as `sha256sum` writes it and `sha256sum -c` reads it. */
export function checksumLine(sha256: string, fileName: string): string {
  return `${sha256}  ${fileName}\n`;
}

export interface RootPackageJson {
  readonly name?: string;
  readonly private?: boolean;
  readonly license?: string;
  readonly type?: string;
  readonly workspaces?: readonly string[];
  readonly scripts?: Readonly<Record<string, string>>;
  readonly engines?: Readonly<Record<string, string>>;
  readonly [field: string]: unknown;
}

/**
 * The release's root package.json: the checkout's, at `version`, with only the released
 * workspaces and the scripts a release runs, and no devDependencies, as nothing is built on the target.
 */
export function releasePackageJson(root: RootPackageJson, version: string): RootPackageJson {
  const scripts = Object.fromEntries(
    RELEASE_SCRIPTS.flatMap((script) => {
      const command = root.scripts?.[script];
      return command === undefined ? [] : [[script, command]];
    }),
  );
  return {
    name: root.name,
    version,
    private: root.private,
    license: root.license,
    type: root.type,
    workspaces: [...RELEASE_WORKSPACES],
    scripts,
    engines: root.engines,
  };
}

/** The stamp the service reads (office-updates' `FilesystemOfficeReleaseStamp`). */
export interface ReleaseStamp {
  readonly version: string;
  readonly commit: string;
  readonly committedAt: string;
  readonly subject: string;
  /**
   * The GitHub repository it is released from, as `owner/name`, where the service looks for newer
   * releases; absent when packed outside GitHub Actions.
   */
  readonly repository?: string;
}

/** The format `releaseStamp` reads: `git log -1 --format=<this>`. */
export const STAMP_COMMIT_FORMAT = "%H%x1f%cI%x1f%s";

/**
 * The stamp of `version`, from the released commit as `git log -1 --format=STAMP_COMMIT_FORMAT`
 * shows it, and the repository GitHub Actions names (`GITHUB_REPOSITORY`).
 */
export function releaseStamp(
  version: string,
  commitLine: string,
  repository?: string,
): ReleaseStamp {
  const [commit = "", committedAt = "", ...subject] = commitLine.trim().split("\x1f");
  if (!/^[0-9a-f]{40,64}$/.test(commit) || Number.isNaN(Date.parse(committedAt))) {
    throw new Error(`Not a commit as git log shows it: '${commitLine.trim()}'.`);
  }
  if (repository !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error(`Not a GitHub repository as owner/name: '${repository}'.`);
  }
  return {
    version,
    commit,
    committedAt,
    subject: subject.join("\x1f"),
    ...(repository && { repository }),
  };
}

/** The prefix of the SDK's per-platform packages, each holding a Claude Code binary. */
const CLAUDE_CODE_PACKAGE = "@anthropic-ai/claude-agent-sdk-";

/** The Claude Agent SDK's package holding Claude Code for glibc Linux on `arch`. */
export function claudeCodePackage(arch: ReleaseArch): string {
  return `${CLAUDE_CODE_PACKAGE}linux-${arch}`;
}

/**
 * The Claude Code packages to remove from an install for `arch`: the musl builds, which npm
 * installs alongside as it doesn't tell the C libraries apart. A release targets glibc.
 */
export function unwantedClaudeCodePackages(
  installed: readonly string[],
  arch: ReleaseArch,
): string[] {
  return installed.filter((name) => name === `${claudeCodePackage(arch)}-musl`);
}

/** Why the Claude Code packages installed don't suit a release for `arch`; none when they do. */
export function claudeCodeProblems(installed: readonly string[], arch: ReleaseArch): string[] {
  const own = claudeCodePackage(arch);
  // Every other platform's build: another CPU, musl, macOS or Windows.
  const problems = installed
    .filter((name) => name.startsWith(CLAUDE_CODE_PACKAGE) && name !== own)
    .map((name) => `${name} doesn't belong in a release for linux-${arch}.`);
  if (!installed.includes(own)) {
    problems.unshift(`${own}, with Claude Code for linux-${arch}, is missing.`);
  }
  return problems;
}

/** A package as installed in the release: its folder from the release's root, and its version. */
export interface InstalledPackage {
  readonly path: string;
  readonly version: string;
}

/** What the checkout's package-lock.json says of each package folder. */
export interface Lockfile {
  readonly packages: Readonly<
    Record<string, { readonly version?: string; readonly dev?: boolean; readonly link?: boolean }>
  >;
}

/** Why the installed packages aren't the lockfile's production packages; none when they are. */
export function installedPackageProblems(
  installed: readonly InstalledPackage[],
  lockfile: Lockfile,
): string[] {
  return installed.flatMap(({ path, version }) => {
    const locked = lockfile.packages[path];
    if (!locked) return [`${path} isn't in package-lock.json.`];
    if (locked.dev) return [`${path} is a devDependency.`];
    if (locked.version !== version) {
      return [`${path} is at ${version}, but package-lock.json holds ${locked.version}.`];
    }
    return [];
  });
}
