import {
  projectCommandKeySchema,
  type ProjectCommandKey,
  type PublishingMode,
} from "@the-office/contracts";

/** How Publish ships a Task's branch in a Project, wherever a Project or a Stage names it. */
export function publishingLabel(mode: PublishingMode, baseBranch: string): string {
  return mode === "merge" ? `Merge into ${baseBranch}` : "Push and open a pull request";
}

/** In the order a fresh worktree runs them. */
export const COMMAND_KEYS: readonly ProjectCommandKey[] = projectCommandKeySchema.options;

export const COMMAND_LABELS: Readonly<Record<ProjectCommandKey, string>> = {
  install: "Install",
  build: "Build",
  lint: "Lint",
  test: "Test",
};

export const INSTALL_INPUTS_LABEL = "Install inputs";

/** The install inputs as one line to read or edit: "package-lock.json, apps/web/package.json". */
export function installInputsLine(installInputs: readonly string[]): string {
  return installInputs.join(", ");
}
