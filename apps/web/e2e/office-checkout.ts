// The Office's own checkout as the end-to-end service sees it: a clone of a local bare upstream
// that has moved ahead by two commits, so Settings › Updates finds an update. Nothing installs it:
// the tests cancel every update they schedule. The Office device helper this checkout's build made
// is copied into it, where the service takes it from, kept out of git as a build's is.
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The helper `npm run build` made (`npm run build:device-helper`), which the service copies. */
const BUILT_DEVICE_HELPER = path.resolve(import.meta.dirname, "../../../tools/device-helper/dist");
const DEVICE_HELPER_FOLDER = "tools/device-helper/dist";

/** The subjects of the commits the checkout is behind, oldest first. */
export const NEWER_SUBJECTS = ["Add the launcher", "Add Settings › Updates"] as const;

/** Makes the checkout in `folder` and gives its path. */
export function createOfficeCheckout(folder: string): string {
  const upstream = path.join(folder, "upstream.git");
  const checkout = path.join(folder, "checkout");
  const other = path.join(folder, "other");
  mkdirSync(folder, { recursive: true });
  git(folder, "init", "--quiet", "--bare", "--initial-branch=main", upstream);
  git(folder, "clone", "--quiet", upstream, checkout);
  commit(checkout, "The version running");
  git(checkout, "push", "--quiet", "--set-upstream", "origin", "main");
  git(folder, "clone", "--quiet", upstream, other);
  for (const subject of NEWER_SUBJECTS) commit(other, subject);
  git(other, "push", "--quiet");
  if (existsSync(BUILT_DEVICE_HELPER)) {
    cpSync(BUILT_DEVICE_HELPER, path.join(checkout, DEVICE_HELPER_FOLDER), { recursive: true });
    appendFileSync(path.join(checkout, ".git", "info", "exclude"), `/${DEVICE_HELPER_FOLDER}/\n`);
  }
  return checkout;
}

function commit(repository: string, subject: string): void {
  writeFileSync(path.join(repository, "version.txt"), `${subject}\n`);
  git(repository, "add", "version.txt");
  git(repository, "commit", "--quiet", "-m", subject);
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    stdio: "pipe",
  });
}
