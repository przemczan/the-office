import {
  DEFAULT_PORT_VARIABLE,
  type EditedTestTarget,
  type EntryPoint,
  type EntryPointKind,
  type Project,
  type RunEnvironmentSetting,
  type TestTarget,
  type TestTargetKind,
  type TestTargetSetter,
} from "@the-office/contracts";
import {
  commandsBeforeWords,
  memoryWords,
  testTargetFieldsOf,
} from "../../shell/test-target-words.ts";
import type { SecretVariableDraft } from "./environment-labels.ts";

/** Install's key among the Project's commands, which runs its install command. */
const INSTALL_COMMAND_KEY = "install";

/** Who set a value, as its mark names them: "you" for the signed-in user, else their name. */
export function setterName(setter: TestTargetSetter, signedInUserId: string | undefined): string {
  if (setter.by === "proposal") return setter.agent.name;
  return setter.user.userId === signedInUserId ? "you" : setter.user.name;
}

/** "Set by you", or "Set by Nina" for a value a Proposal of hers set. */
export function setByWords(setter: TestTargetSetter, signedInUserId: string | undefined): string {
  return `Set by ${setterName(setter, signedInUserId)}`;
}

/**
 * Who set the target's values last, as its row marks it: "Set by you", "Set by Nina", or with
 * values set by both, "Set by you and Nina"; undefined when no value records anyone.
 */
export function targetSetByWords(
  target: TestTarget,
  signedInUserId: string | undefined,
): string | undefined {
  const names = [
    ...new Set(
      testTargetFieldsOf(target.kind).flatMap((field) => {
        const setter = target.setBy[field];
        return setter ? [setterName(setter, signedInUserId)] : [];
      }),
    ),
  ];
  if (names.length === 0) return undefined;
  // "you" first, as the user reads their own share first.
  names.sort((one, other) => Number(other === "you") - Number(one === "you"));
  const last = names.pop();
  return `Set by ${names.length === 0 ? last : `${names.join(", ")} and ${last}`}`;
}

/** The Secret variables whose value isn't typed yet, such as those a Proposal named. */
export function secretsNeedingValues(target: TestTarget): readonly string[] {
  return target.secretVariables.filter(({ valueSet }) => !valueSet).map(({ name }) => name);
}

/** Whether the target can't launch until the Project's Run environment is On. */
export function needsRunEnvironment(target: TestTarget, setting: RunEnvironmentSetting): boolean {
  return target.kind === "hosted" && setting !== "on";
}

/** A test target as its editor shows it: lists one per line, the port as typed. */
export interface TestTargetDraft {
  readonly key: string;
  readonly name: string;
  readonly kind: TestTargetKind;
  readonly entryPointKind: EntryPointKind;
  /** The repository file's path. */
  readonly path: string;
  readonly manifest: string;
  readonly script: string;
  readonly task: string;
  readonly service: string;
  /** One argument per line. */
  readonly arguments: string;
  readonly port: string;
  /** One pattern per line. */
  readonly outputPatterns: string;
  /** One `NAME=value` per line. */
  readonly variables: string;
  readonly secrets: readonly SecretVariableDraft[];
  /** The Project's commands run before the entry point, by key, in order. */
  readonly commandsBefore: readonly string[];
  /** Hosted: the variable The Office sets to the port. */
  readonly portVariable: string;
  /** The target's own Memory per service in MB; null for the Office-wide value. */
  readonly memoryMegabytes: number | null;
}

/** A new target's editor: Hosted, on the root package manifest's script. */
export const NEW_TEST_TARGET_DRAFT: TestTargetDraft = {
  key: "",
  name: "",
  kind: "hosted",
  entryPointKind: "package-script",
  path: "",
  manifest: "package.json",
  script: "",
  task: "",
  service: "",
  arguments: "",
  port: "",
  outputPatterns: "",
  variables: "",
  secrets: [],
  commandsBefore: [],
  portVariable: DEFAULT_PORT_VARIABLE,
  memoryMegabytes: null,
};

export function testTargetDraftOf(target: TestTarget): TestTargetDraft {
  const { entryPoint } = target;
  return {
    ...NEW_TEST_TARGET_DRAFT,
    key: target.key,
    name: target.name,
    kind: target.kind,
    entryPointKind: entryPoint.kind,
    ...entryPointDraftOf(entryPoint),
    port: "port" in target ? String(target.port) : "",
    outputPatterns: "outputPatterns" in target ? target.outputPatterns.join("\n") : "",
    variables: target.variables.map(({ name, value }) => `${name}=${value}`).join("\n"),
    secrets: target.secretVariables.map(({ name, valueSet }, key) => ({
      key,
      name,
      keptName: valueSet ? name : undefined,
      typed: undefined,
    })),
    commandsBefore: target.commandsBefore,
    portVariable: "portVariable" in target ? target.portVariable : DEFAULT_PORT_VARIABLE,
    memoryMegabytes: target.memoryMegabytes,
  };
}

/** A command a target may run before its entry point, as the editor names it. */
export interface RunnableCommand {
  readonly key: string;
  readonly name: string;
}

/**
 * The commands a target may run before its entry point: Install, by its key, when the Project has
 * an install command, then the Project's own commands.
 */
export function runnableCommandsOf(
  project: Pick<Project, "installCommand" | "commands">,
): readonly RunnableCommand[] {
  const install =
    project.installCommand === "" ? [] : [{ key: INSTALL_COMMAND_KEY, name: "Install" }];
  return [...install, ...project.commands.map(({ key, name }) => ({ key, name }))];
}

/** The keys among `commandKeys` the Project no longer has as a command. */
export function unknownCommandKeys(
  commandKeys: readonly string[],
  commands: readonly RunnableCommand[],
): readonly string[] {
  return commandKeys.filter((key) => !commands.some((command) => command.key === key));
}

/** The warning on a command key the Project no longer has. */
export function notACommandWords(key: string): string {
  return `${key} isn't one of the Project's commands anymore.`;
}

/**
 * What the target's row shows under its entry point: the commands run before it, a Hosted target's
 * port as the variable it is set in (`PORT=3000`), and its own Memory per service when it has one.
 */
export function targetDetailsWords(target: TestTarget): readonly string[] {
  return [
    ...(target.commandsBefore.length > 0
      ? [`Commands before: ${commandsBeforeWords(target.commandsBefore)}`]
      : []),
    ...(target.kind === "hosted" ? [`${target.portVariable}=${target.port}`] : []),
    ...(target.memoryMegabytes === null
      ? []
      : [`Memory per service ${memoryWords(target.memoryMegabytes)}`]),
  ];
}

/** The list with the item at `index` moved by `by` places, or as it was at either end. */
export function movedBy<T>(items: readonly T[], index: number, by: -1 | 1): readonly T[] {
  const to = index + by;
  if (to < 0 || to >= items.length) return items;
  const moved = [...items];
  [moved[index], moved[to]] = [moved[to] as T, moved[index] as T];
  return moved;
}

function entryPointDraftOf(entryPoint: EntryPoint): Partial<TestTargetDraft> {
  switch (entryPoint.kind) {
    case "repository-file":
      return { path: entryPoint.path, arguments: entryPoint.arguments.join("\n") };
    case "package-script":
      return {
        manifest: entryPoint.manifest,
        script: entryPoint.script,
        arguments: entryPoint.arguments.join("\n"),
      };
    case "gradle-task":
      return { task: entryPoint.task, arguments: entryPoint.arguments.join("\n") };
    case "devcontainer-service":
      return { service: entryPoint.service };
  }
}

/** A new, empty row for a Secret variable. */
export function withNewTargetSecret(draft: TestTargetDraft): TestTargetDraft {
  const key = Math.max(-1, ...draft.secrets.map((secret) => secret.key)) + 1;
  return {
    ...draft,
    secrets: [...draft.secrets, { key, name: "", keptName: undefined, typed: undefined }],
  };
}

/**
 * The target the draft describes, or what it can't read. The service checks the rest of the rules
 * (the key, the name, the entry point against the base branch); a Secret variable without a typed
 * value keeps the one kept under its name.
 */
export function editedTestTargetOf(
  draft: TestTargetDraft,
): { readonly target: EditedTestTarget } | { readonly problems: readonly string[] } {
  const problems: string[] = [];
  const variables = linesOf(draft.variables).flatMap((line) => {
    const equals = line.indexOf("=");
    if (equals < 0) {
      problems.push(`Write each variable as NAME=value; "${line.trim()}" has no "=".`);
      return [];
    }
    return [{ name: line.slice(0, equals).trim(), value: line.slice(equals + 1) }];
  });
  const port = Number(draft.port.trim());
  if (draft.kind !== "build-to-install" && !(draft.port.trim() !== "" && Number.isInteger(port))) {
    problems.push("Give the port the app listens on, a whole number.");
  }
  if (problems.length > 0) return { problems };
  const fields = {
    key: draft.key.trim(),
    name: draft.name.trim(),
    entryPoint: entryPointOf(draft),
    variables,
    secretVariables: draft.secrets.map(({ name, typed }) => ({
      name: name.trim(),
      ...(typed === undefined ? {} : { value: typed }),
    })),
    commandsBefore: [...draft.commandsBefore],
    memoryMegabytes: draft.memoryMegabytes,
  };
  if (draft.kind === "build-to-install") {
    return {
      target: { ...fields, kind: draft.kind, outputPatterns: linesOf(draft.outputPatterns) },
    };
  }
  return {
    target: {
      ...fields,
      kind: draft.kind,
      port,
      portVariable: draft.portVariable.trim() || DEFAULT_PORT_VARIABLE,
    },
  };
}

function entryPointOf(draft: TestTargetDraft): EntryPoint {
  const args = linesOf(draft.arguments);
  switch (draft.entryPointKind) {
    case "repository-file":
      return { kind: "repository-file", path: draft.path.trim(), arguments: args };
    case "package-script":
      return {
        kind: "package-script",
        manifest: draft.manifest.trim(),
        script: draft.script.trim(),
        arguments: args,
      };
    case "gradle-task":
      return { kind: "gradle-task", task: draft.task.trim(), arguments: args };
    case "devcontainer-service":
      return { kind: "devcontainer-service", service: draft.service.trim() };
  }
}

function linesOf(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/** A target as the whole list sends it back unchanged: each Secret variable keeps its value. */
export function keptTestTarget(target: TestTarget): EditedTestTarget {
  const { setBy: _setBy, secretVariables, ...fields } = target;
  return { ...fields, secretVariables: secretVariables.map(({ name }) => ({ name })) };
}

/**
 * The Project's whole list with `edited` in place of the target of its key, or added last; or
 * without the target of `removedKey`.
 */
export function testTargetsWith(
  targets: readonly TestTarget[],
  change: { readonly edited: EditedTestTarget } | { readonly removedKey: string },
): EditedTestTarget[] {
  if ("removedKey" in change) {
    return targets.filter(({ key }) => key !== change.removedKey).map(keptTestTarget);
  }
  const { edited } = change;
  const kept = targets.map((target) =>
    target.key === edited.key ? edited : keptTestTarget(target),
  );
  return targets.some(({ key }) => key === edited.key) ? kept : [...kept, edited];
}
