import type { OfficeInstall, OfficeUpdateResult, OfficeUpdateStep } from "@the-office/contracts";

const STEP_WORDS: Readonly<Record<OfficeUpdateStep, string>> = {
  fetch: "fetching the newest commits",
  merge: "moving to the newest commit",
  install: "installing (npm ci)",
  build: "the build",
  download: "downloading the new version",
  verify: "checking the download",
  unpack: "unpacking the new version",
  switch: "switching to the new version",
  start: "starting the new version",
};

const INSTALL_WORDS: Readonly<Record<OfficeInstall, string>> = {
  checkout: "Runs from a git checkout",
  release: "Installed from a release tarball",
  container: "Runs in a container",
};

const INSTALL_NOTES: Readonly<Record<OfficeInstall, string>> = {
  checkout:
    "The Office updates its own checkout to the newest commit of its upstream branch. A check runs every day and installs nothing; Update waits until nobody is mid-turn and nothing runs, then The Office restarts on the new version.",
  release:
    "The Office installs newer released versions from GitHub Releases. A check runs every day and installs nothing; Update waits until nobody is mid-turn and nothing runs, then the launcher downloads the new version, restarts The Office on it, and goes back to this one if it doesn't start.",
  container:
    "The Office installs newer released versions' images from GitHub Releases. A check runs every day and installs nothing; Update waits until nobody is mid-turn and nothing runs, then the Office updater restarts The Office's container on the new image through Docker Compose, and goes back to this version if it doesn't start.",
};

const VERSION = /^\d+\.\d+\.\d+$/;

/** A version shown whole, a commit shortened, as an update goes from one to the other. */
export function versionWords(ref: string): string {
  return VERSION.test(ref) ? ref : ref.slice(0, 7);
}

/** How The Office was installed, beside the version it runs. */
export function installWords(install: OfficeInstall): string {
  return INSTALL_WORDS[install];
}

/** The note at the top of Settings › Updates: how this install updates. */
export function installNote(install: OfficeInstall): string {
  return INSTALL_NOTES[install];
}

/** How the last Office update ended, as its card's title says it. */
export function lastResultWords(result: OfficeUpdateResult): string {
  if (result.outcome === "updated") return `The Office updated to ${versionWords(result.to)}.`;
  const failedAt = `The Office's update failed at ${STEP_WORDS[result.failedStep]}`;
  return result.rollbackFailed
    ? `${failedAt}, and going back to ${versionWords(result.from)} failed too.`
    : `${failedAt}; it is back on ${versionWords(result.from)}.`;
}

/** "Waiting for 2 things", or that it goes ahead now. */
export function waitingWords(busy: number): string {
  if (busy === 0) return "Nothing is busy, so The Office is restarting for it.";
  return busy === 1 ? "Waiting for 1 thing:" : `Waiting for ${busy} things:`;
}
