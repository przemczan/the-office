import {
  projectCommandKindSchema,
  type ProjectCommand,
  type ProjectCommandKind,
  type PublishingMode,
} from "@the-office/contracts";

/** How Publish ships a Task's branch in a Project, wherever a Project or a Stage names it. */
export function publishingLabel(mode: PublishingMode, baseBranch: string): string {
  return mode === "merge" ? `Merge into ${baseBranch}` : "Push and open a pull request";
}

export const INSTALL_LABEL = "Install";

export const COMMAND_KINDS: readonly ProjectCommandKind[] = projectCommandKindSchema.options;

export const COMMAND_KIND_LABELS: Readonly<Record<ProjectCommandKind, string>> = {
  build: "Build",
  lint: "Lint",
  test: "Test",
};

/** The commands every Project starts with, their command lines given when it is added. */
export const STARTING_COMMANDS: readonly Omit<ProjectCommand, "commandLine">[] = [
  { key: "build", name: "Build", kind: "build" },
  { key: "lint", name: "Lint", kind: "lint" },
  { key: "test", name: "Test", kind: "test" },
];

export const INSTALL_INPUTS_LABEL = "Install inputs";

/** The install inputs as one line to read or edit: "package-lock.json, apps/web/package.json". */
export function installInputsLine(installInputs: readonly string[]): string {
  return installInputs.join(", ");
}
