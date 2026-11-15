// `npm run pack-release -- --version <version> --arch x64|arm64`, after `npm ci && npm run build`:
// packs the built checkout into an Office release's tarball for Linux on that CPU, with its
// production node_modules, and its .sha256 (docs/releasing.md). Linux only, as it runs GNU tar.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  checksumLine,
  claudeCodeProblems,
  INSTALLED_WORKSPACES,
  installedPackageProblems,
  isReleased,
  RELEASE_ARCHES,
  RELEASE_FILES,
  RELEASE_STAMP_FILE,
  RELEASE_WORKSPACES,
  releaseFolderName,
  releasePackageJson,
  releaseStamp,
  STAMP_COMMIT_FORMAT,
  tarballName,
  unwantedClaudeCodePackages,
  type InstalledPackage,
  type Lockfile,
  type ReleaseArch,
  type RootPackageJson,
} from "./release-package.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const releaseFolder = join(repositoryRoot, "dist", "release");

const { version, arch } = argumentsGiven();
const stageFolder = join(releaseFolder, `stage-${arch}`);
const installFolder = join(releaseFolder, `install-${arch}`);
const releaseRoot = join(stageFolder, releaseFolderName(version));

rmSync(stageFolder, { recursive: true, force: true });
rmSync(installFolder, { recursive: true, force: true });
console.log(
  `Packing The Office ${version} for linux-${arch} in ${relative(repositoryRoot, stageFolder)}`,
);
copyReleaseFiles();
installProductionPackages();
checkInstalledPackages();
const written = writeTarball();
console.log(`Packed ${relative(repositoryRoot, written)} and its .sha256.`);

function argumentsGiven(): { version: string; arch: ReleaseArch } {
  const { values } = parseArgs({
    options: { version: { type: "string" }, arch: { type: "string" } },
  });
  const given = values.arch;
  if (!values.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(values.version)) {
    throw new Error("Give the release's version as --version <major.minor.patch[-prerelease]>.");
  }
  if (!RELEASE_ARCHES.some((each) => each === given)) {
    throw new Error(`Give the CPU as --arch ${RELEASE_ARCHES.join("|")}.`);
  }
  return { version: values.version, arch: given as ReleaseArch };
}

function copyReleaseFiles(): void {
  for (const { path } of RELEASE_FILES) {
    const from = join(repositoryRoot, path);
    if (!existsSync(from)) throw new Error(`${path} is missing: run npm run build first.`);
    cpSync(from, join(releaseRoot, path), {
      recursive: true,
      filter: (source) => isReleased(source),
    });
  }
  const root = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  ) as RootPackageJson;
  writeJson(join(releaseRoot, "package.json"), releasePackageJson(root, version));
  const commitLine = execFileSync("git", ["log", "-1", `--format=${STAMP_COMMIT_FORMAT}`, "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  writeJson(join(releaseRoot, RELEASE_STAMP_FILE), releaseStamp(version, commitLine));
}

/**
 * Installs the released workspaces' production packages for linux/`arch` in a folder of their
 * own, laid out as the checkout is (its root package.json, the lockfile and every workspace's
 * package.json), so `npm ci` finds the lockfile in step, then moves them into the release.
 */
function installProductionPackages(): void {
  for (const file of ["package.json", "package-lock.json", ".npmrc"]) {
    cpSync(join(repositoryRoot, file), join(installFolder, file));
  }
  for (const workspace of lockedWorkspaces()) {
    cpSync(
      join(repositoryRoot, workspace, "package.json"),
      join(installFolder, workspace, "package.json"),
    );
  }
  const workspaces = INSTALLED_WORKSPACES.map((workspace) => `--workspace=${workspace}`);
  execFileSync(
    "npm",
    [
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--os=linux",
      `--cpu=${arch}`,
      ...workspaces,
    ],
    { cwd: installFolder, stdio: "inherit" },
  );
  for (const folder of ["", ...RELEASE_WORKSPACES]) {
    const installed = join(installFolder, folder, "node_modules");
    if (existsSync(installed)) renameSync(installed, join(releaseRoot, folder, "node_modules"));
  }
  rmSync(installFolder, { recursive: true, force: true });
  removeUnreleasedLinks();
  removeEmptyScopes();
  const unwanted = unwantedClaudeCodePackages(installedNames(), arch);
  for (const name of unwanted) rmSync(join(releaseRoot, "node_modules", name), { recursive: true });
}

/** The workspaces package-lock.json knows, as their folders: every one but the root's. */
function lockedWorkspaces(): string[] {
  return Object.keys(lockfile().packages).filter(
    (path) => path !== "" && !path.split("/").includes("node_modules"),
  );
}

/** npm links every workspace into node_modules; a release keeps the links to the ones it carries. */
function removeUnreleasedLinks(): void {
  const scope = join(releaseRoot, "node_modules", "@the-office");
  if (!existsSync(scope)) return;
  for (const name of readdirSync(scope)) {
    const link = join(scope, name);
    if (!lstatSync(link).isSymbolicLink()) continue;
    const target = relative(releaseRoot, resolve(scope, readlinkSync(link))).replaceAll("\\", "/");
    if (!(RELEASE_WORKSPACES as readonly string[]).includes(target)) rmSync(link);
  }
}

/** npm leaves the folder of a scope whose packages it skipped, such as another platform's builds. */
function removeEmptyScopes(): void {
  for (const folder of ["", ...RELEASE_WORKSPACES]) {
    const nodeModules = join(releaseRoot, folder, "node_modules");
    if (!existsSync(nodeModules)) continue;
    for (const name of readdirSync(nodeModules)) {
      const scope = join(nodeModules, name);
      if (name.startsWith("@") && readdirSync(scope).length === 0)
        rmSync(scope, { recursive: true });
    }
  }
}

function checkInstalledPackages(): void {
  const installed = installedPackages();
  const problems = [
    ...claudeCodeProblems(installedNames(installed), arch),
    ...installedPackageProblems(installed, lockfile()),
  ];
  if (problems.length > 0) {
    throw new Error(`The release's node_modules isn't right:\n${problems.join("\n")}`);
  }
}

/** Every package folder installed in the release, nested ones too; workspace links left out. */
function installedPackages(): InstalledPackage[] {
  return ["", ...RELEASE_WORKSPACES].flatMap((folder) =>
    packagesIn(join(releaseRoot, folder, "node_modules")),
  );
}

function packagesIn(nodeModules: string): InstalledPackage[] {
  if (!existsSync(nodeModules)) return [];
  return readdirSync(nodeModules)
    .filter((name) => !name.startsWith("."))
    .flatMap((name) =>
      name.startsWith("@")
        ? readdirSync(join(nodeModules, name)).map((scoped) => join(nodeModules, name, scoped))
        : [join(nodeModules, name)],
    )
    .filter((folder) => !lstatSync(folder).isSymbolicLink())
    .flatMap((folder) => {
      const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
        version: string;
      };
      const path = relative(releaseRoot, folder).replaceAll("\\", "/");
      return [{ path, version: manifest.version }, ...packagesIn(join(folder, "node_modules"))];
    });
}

function installedNames(installed = installedPackages()): string[] {
  return installed.map(({ path }) =>
    path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length),
  );
}

function lockfile(): Lockfile {
  return JSON.parse(readFileSync(join(repositoryRoot, "package-lock.json"), "utf8")) as Lockfile;
}

/** The tarball, with the release's folder at its top, owned by root, and its .sha256 beside it. */
function writeTarball(): string {
  const name = tarballName(version, arch);
  const tarball = join(releaseFolder, name);
  execFileSync(
    "tar",
    [
      "--create",
      "--gzip",
      "--file",
      tarball,
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--directory",
      stageFolder,
      releaseFolderName(version),
    ],
    { stdio: "inherit" },
  );
  writeFileSync(`${tarball}.sha256`, checksumLine(sha256Of(tarball), name));
  return tarball;
}

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
