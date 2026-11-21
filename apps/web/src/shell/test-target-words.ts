import {
  gigabytesOf,
  type EntryPoint,
  type EntryPointKind,
  type ProposedTestTargetFields,
  type TestTargetField,
  type TestTargetKind,
} from "@the-office/contracts";

/** A test target's kind as the Project page and a Proposal's card name it (spec §2.12, "Kinds"). */
export const TEST_TARGET_KIND_LABELS: Readonly<Record<TestTargetKind, string>> = {
  hosted: "Hosted",
  "build-to-install": "Build to install",
  "install-on-a-device": "Install on a device",
  "deployed-elsewhere": "Deployed elsewhere",
};

/** The kinds built now; the others are outlined only and refused when written. */
export const BUILT_TEST_TARGET_KINDS: readonly TestTargetKind[] = ["hosted", "build-to-install"];

export const ENTRY_POINT_KIND_LABELS: Readonly<Record<EntryPointKind, string>> = {
  "repository-file": "File in the repository",
  "package-script": "Package script",
  "gradle-task": "Gradle task",
  "devcontainer-service": ".devcontainer/ service",
};

export const TEST_TARGET_FIELD_LABELS: Readonly<Record<TestTargetField, string>> = {
  name: "Name",
  kind: "Kind",
  entryPoint: "Entry point",
  port: "Port",
  outputPatterns: "Output files",
  variables: "Variables",
  secretVariables: "Secret variables",
  commandsBefore: "Commands before the entry point",
  portVariable: "Port variable",
  memoryMegabytes: "Memory per service",
};

/**
 * An entry point in one line, its arguments after it: `scripts/start.sh --watch`,
 * `package.json › start`, `./gradlew assembleDebug`, or `.devcontainer/ › web`.
 */
export function entryPointWords(entryPoint: EntryPoint): string {
  switch (entryPoint.kind) {
    case "repository-file":
      return withArguments(entryPoint.path, entryPoint.arguments);
    case "package-script":
      return withArguments(`${entryPoint.manifest} › ${entryPoint.script}`, entryPoint.arguments);
    case "gradle-task":
      return withArguments(`./gradlew ${entryPoint.task}`, entryPoint.arguments);
    case "devcontainer-service":
      return `.devcontainer/ › ${entryPoint.service}`;
  }
}

function withArguments(head: string, args: readonly string[]): string {
  return [head, ...args].join(" ");
}

/** The fields a target of this kind has. */
export function testTargetFieldsOf(kind: TestTargetKind): readonly TestTargetField[] {
  if (kind === "build-to-install") {
    return [
      "name",
      "kind",
      "entryPoint",
      "commandsBefore",
      "outputPatterns",
      "variables",
      "secretVariables",
      "memoryMegabytes",
    ];
  }
  return [
    "name",
    "kind",
    "entryPoint",
    "commandsBefore",
    "port",
    "portVariable",
    "variables",
    "secretVariables",
    "memoryMegabytes",
  ];
}

/** One field of a target as a Proposal's card shows it; Secret variables by name alone. */
export function testTargetFieldWords(
  target: ProposedTestTargetFields,
  field: TestTargetField,
): string {
  switch (field) {
    case "name":
      return target.name;
    case "kind":
      return TEST_TARGET_KIND_LABELS[target.kind];
    case "entryPoint":
      return entryPointWords(target.entryPoint);
    case "port":
      return "port" in target ? String(target.port) : "None";
    case "outputPatterns":
      return "outputPatterns" in target ? listWords(target.outputPatterns) : "None";
    case "variables":
      return listWords(target.variables.map(({ name, value }) => `${name}=${value}`));
    case "secretVariables":
      return listWords(target.secretVariables);
    case "commandsBefore":
      return commandsBeforeWords(target.commandsBefore);
    case "portVariable":
      return "portVariable" in target ? target.portVariable : "None";
    case "memoryMegabytes":
      return memoryWords(target.memoryMegabytes);
  }
}

/** The Project's commands run before the entry point, by key in order: `install-tools → seed`. */
export function commandsBeforeWords(commandKeys: readonly string[]): string {
  return commandKeys.length === 0 ? "None" : commandKeys.join(" → ");
}

/** A target's own Memory per service, or "Office default" when it has none. */
export function memoryWords(memoryMegabytes: number | null): string {
  return memoryMegabytes === null ? "Office default" : gigabytesOf(memoryMegabytes);
}

function listWords(items: readonly string[]): string {
  return items.length === 0 ? "None" : items.join(", ");
}
