// What `npm start` runs: the service under the launcher, which updates it when the service asks
// (docs/running-the-office.md). Never built: Node runs it with its types stripped.
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { runLauncher } from "./launcher.ts";
import { NPM_COMMANDS } from "./office-update.ts";

const repository = resolve(import.meta.dirname, "../../..");

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

process.exitCode = await runLauncher({
  repository,
  updateFolder: updateFolder(process.env),
  commands: NPM_COMMANDS,
  service: [
    process.execPath,
    "--enable-source-maps",
    "--env-file-if-exists=../../.env",
    "dist/main.js",
  ],
  serviceDirectory: join(repository, "apps", "service"),
  environment: process.env,
  log: (line) => console.log(`[launcher] ${line}`),
});
