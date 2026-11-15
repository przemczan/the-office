// What `npm start` and a direct install's unit run: the service under the launcher, which updates
// it when the service asks (docs/running-the-office.md). Never built: Node runs it with its types
// stripped.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { installLayoutOf, type InstallLayout } from "./install-layout.ts";
import { runLauncher, type LauncherInstall } from "./launcher.ts";
import { NPM_COMMANDS } from "./office-update.ts";
import { CURRENT_LINK } from "./release-update.ts";

const root = realpathSync(resolve(import.meta.dirname, "../../.."));
const layout = installLayoutOf(root);

/**
 * `<office-data>/update`, the Office data directory found as the service finds it on Linux:
 * OFFICE_DATA_DIR, else `the-office` in the XDG data home.
 */
function updateFolder(environment: NodeJS.ProcessEnv): string {
  const configured = environment["OFFICE_DATA_DIR"]?.trim();
  if (configured) return join(configured, "update");
  const dataHome = environment["XDG_DATA_HOME"];
  const base = dataHome && isAbsolute(dataHome) ? dataHome : join(homedir(), ".local", "share");
  return join(base, "the-office", "update");
}

function launcherInstall(found: InstallLayout): LauncherInstall {
  switch (found.mode) {
    case "checkout":
      return {
        mode: "checkout",
        updateFolder: updateFolder(process.env),
        repository: found.repository,
        commands: NPM_COMMANDS,
      };
    case "release":
      return {
        mode: "release",
        updateFolder: updateFolder(process.env),
        installRoot: found.installRoot,
        launcherRelease: found.release,
      };
    case "not-installed":
      return { mode: "not-installed" };
  }
}

/** A release starts from wherever `current` points as it starts; any other copy from itself. */
function serviceDirectory(): string {
  const office =
    layout.mode === "release" ? realpathSync(join(layout.installRoot, CURRENT_LINK)) : root;
  return join(office, "apps", "service");
}

process.exitCode = await runLauncher({
  install: launcherInstall(layout),
  service: [
    process.execPath,
    "--enable-source-maps",
    "--env-file-if-exists=../../.env",
    "dist/main.js",
  ],
  serviceDirectory,
  environment: process.env,
  log: (line) => console.log(`[launcher] ${line}`),
});
