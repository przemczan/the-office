import {
  entryPointShapeProblems,
  sameEntryPoint,
  trimmedEntryPoint,
  type EntryPoint,
} from "./entry-point.js";
import { keyShapeProblem } from "./project.js";
import {
  repeatedNameProblems,
  variableNameProblem,
  variableValueProblems,
  type ProjectVariable,
} from "./project-environment.js";

/**
 * The kinds a test target may be; only the first two are built (spec §2.12, "Kinds"). The outlined
 * ones take a Hosted's fields, so they can be named and refused in words.
 */
export const TEST_TARGET_KINDS = [
  "hosted",
  "build-to-install",
  "install-on-a-device",
  "deployed-elsewhere",
] as const;
export type TestTargetKind = (typeof TEST_TARGET_KINDS)[number];

export const TEST_TARGET_KIND_NAMES: Readonly<Record<TestTargetKind, string>> = {
  hosted: "Hosted",
  "build-to-install": "Build to install",
  "install-on-a-device": "Install on a device",
  "deployed-elsewhere": "Deployed elsewhere",
};

export const TEST_TARGET_NAME_LENGTH = 60;

/** The fields of a test target that each record who set them last. */
export const TEST_TARGET_FIELDS = [
  "name",
  "kind",
  "entryPoint",
  "port",
  "outputPatterns",
  "variables",
  "secretVariables",
  "commandsBefore",
  "portVariable",
  "memoryMegabytes",
] as const;
export type TestTargetField = (typeof TEST_TARGET_FIELDS)[number];

/** The variable a Hosted target's port is set in when it names none (spec §2.12). */
export const DEFAULT_PORT_VARIABLE = "PORT";

/**
 * The names a target's port variable can't take: The Office sets `OFFICE_TEST_INSTANCE` in every
 * test instance itself, so the app can't have its port there.
 */
const RESERVED_PORT_VARIABLES: readonly string[] = ["OFFICE_TEST_INSTANCE"];

/**
 * A target's own Memory per service, in MB: the bounds of the Office-wide setting (Settings ›
 * Office limits), which the HTTP adapter's test holds equal to the contracts' ones.
 */
export const TEST_TARGET_MEMORY_MEGABYTES = { min: 512, max: 65_536, step: 512 } as const;

/** Who set a field last: a user on the Project page, or a Proposal an Agent drafted. */
export type TestTargetSetter =
  | { readonly by: "user"; readonly user: { readonly userId: string; readonly name: string } }
  | {
      readonly by: "proposal";
      readonly proposalId: string;
      readonly agent: { readonly roleKey: string; readonly name: string };
    };

/** Who set each field last; a field missing was never set by anyone known. */
export type TestTargetSetBy = Readonly<Partial<Record<TestTargetField, TestTargetSetter>>>;

/** A plain variable of a test target. */
export interface TestTargetVariable {
  readonly name: string;
  readonly value: string;
}

/** A test target's Secret variable as kept: its value null until the user types one. */
export interface TestTargetSecret {
  readonly name: string;
  readonly value: string | null;
}

/**
 * A test target's fields, its Secret variables in the form `Secret` gives: with their values as
 * kept, with an optional value as the page saves them, or by name alone as a Proposal carries them.
 */
export type TestTargetFields<Secret> = {
  readonly key: string;
  readonly name: string;
  readonly entryPoint: EntryPoint;
  readonly variables: readonly TestTargetVariable[];
  readonly secretVariables: readonly Secret[];
  /** The keys of the Project's commands run in the checkout before the entry point, in order. */
  readonly commandsBefore: readonly string[];
  /** The target's own Memory per service in MB; null when the Office-wide value applies. */
  readonly memoryMegabytes: number | null;
} & (
  | HostedFields<"hosted">
  | HostedFields<"install-on-a-device">
  | HostedFields<"deployed-elsewhere">
  | {
      readonly kind: "build-to-install";
      /** Relative to the repository's root, `*` and `**` allowed. */
      readonly outputPatterns: readonly string[];
    }
);

/** The fields of a kind that serves a port: Hosted's, which the outlined kinds take too. */
interface HostedFields<Kind extends TestTargetKind> {
  readonly kind: Kind;
  readonly port: number;
  /** The variable The Office sets to `port` in the app's service. */
  readonly portVariable: string;
}

/** A Project's test target as kept (spec §2.12, "Test target"). */
export type TestTarget = TestTargetFields<TestTargetSecret> & { readonly setBy: TestTargetSetBy };

/** A Secret variable as the page saves it: without a value, or with an empty one, it keeps its own. */
export interface EditedTestTargetSecret {
  readonly name: string;
  readonly value?: string | undefined;
}

/** A test target as the Project page saves it. */
export type EditedTestTarget = TestTargetFields<EditedTestTargetSecret>;

/** A test target's Secret variable as answered: by name, with whether a value is set. */
export interface ShownTestTargetSecret {
  readonly name: string;
  readonly valueSet: boolean;
}

/** A test target as answered and announced: no Secret variable's value. */
export type ShownTestTarget = TestTargetFields<ShownTestTargetSecret> & {
  readonly setBy: TestTargetSetBy;
};

/** How a target is named in a refusal. */
export function testTargetLabel(key: string): string {
  return `Test target "${key}"`;
}

/** The fields `kind` holds besides those every kind has. */
export function fieldsOfKind(kind: TestTargetKind): readonly TestTargetField[] {
  const own: readonly TestTargetField[] =
    kind === "build-to-install" ? ["outputPatterns"] : ["port", "portVariable"];
  return TEST_TARGET_FIELDS.filter((field) => own.includes(field) || !KIND_FIELDS.includes(field));
}

/** The fields only some kinds have. */
const KIND_FIELDS: readonly TestTargetField[] = ["port", "portVariable", "outputPatterns"];

/**
 * The target with the spaces around its key, name, entry point, names and patterns left out, each
 * Secret variable's name by `trimmedSecret`.
 */
export function trimmedTestTarget<Secret>(
  target: TestTargetFields<Secret>,
  trimmedSecret: (secret: Secret) => Secret,
): TestTargetFields<Secret> {
  const common = {
    key: target.key.trim(),
    name: target.name.trim(),
    entryPoint: trimmedEntryPoint(target.entryPoint),
    variables: target.variables
      .map((variable) => ({ ...variable, name: variable.name.trim() }))
      .filter(({ name, value }) => name !== "" || value !== ""),
    secretVariables: target.secretVariables.map(trimmedSecret),
    commandsBefore: target.commandsBefore.map((key) => key.trim()).filter((key) => key !== ""),
    memoryMegabytes: target.memoryMegabytes,
  };
  return target.kind === "build-to-install"
    ? {
        ...common,
        kind: target.kind,
        outputPatterns: target.outputPatterns
          .map((pattern) => pattern.trim())
          .filter((pattern) => pattern !== ""),
      }
    : {
        ...common,
        kind: target.kind,
        port: target.port,
        portVariable: target.portVariable.trim(),
      };
}

/**
 * The targets the page's whole list describes, each Secret variable sent without a value (or with
 * an empty one) keeping the value the stored target of the same key has under its name, else none.
 * Who set each field is the stored target's until `setByAfter` stamps the changes.
 */
export function editedTestTargets(
  stored: readonly TestTarget[],
  edit: readonly EditedTestTarget[],
): TestTarget[] {
  return edit.map((edited) => {
    const target = trimmedTestTarget(edited, (secret) => ({ ...secret, name: secret.name.trim() }));
    const before = stored.find((each) => each.key === target.key);
    const keptValueOf = (name: string): string | null =>
      before?.secretVariables.find((secret) => secret.name === name)?.value ?? null;
    return {
      ...target,
      secretVariables: target.secretVariables.map(({ name, value }) => ({
        name,
        value: value === undefined || value === "" ? keptValueOf(name) : value,
      })),
      setBy: before?.setBy ?? {},
    };
  });
}

/** The targets without their Secret variables' values. */
export function shownTestTargets(targets: readonly TestTarget[]): ShownTestTarget[] {
  return targets.map((target) => ({
    ...target,
    secretVariables: target.secretVariables.map(({ name, value }) => ({
      name,
      valueSet: value !== null,
    })),
  }));
}

/** The names of the Secret variables still waiting for a value. */
export function secretsWithoutValue(target: TestTarget): string[] {
  return target.secretVariables.filter(({ value }) => value === null).map(({ name }) => name);
}

/** Whether `field` holds the same in both; a field only one of them has counts as changed. */
export function sameField<Secret>(
  field: TestTargetField,
  one: TestTargetFields<Secret>,
  other: TestTargetFields<Secret>,
  secretsMatch: (one: Secret, other: Secret) => boolean,
): boolean {
  switch (field) {
    case "name":
      return one.name === other.name;
    case "kind":
      return one.kind === other.kind;
    case "entryPoint":
      return sameEntryPoint(one.entryPoint, other.entryPoint);
    case "port":
      return ("port" in one ? one.port : undefined) === ("port" in other ? other.port : undefined);
    case "outputPatterns":
      if (!("outputPatterns" in one) || !("outputPatterns" in other)) {
        return !("outputPatterns" in one) && !("outputPatterns" in other);
      }
      return sameList(one.outputPatterns, other.outputPatterns, (a, b) => a === b);
    case "variables":
      return sameList(
        one.variables,
        other.variables,
        (a, b) => a.name === b.name && a.value === b.value,
      );
    case "secretVariables":
      return sameList(one.secretVariables, other.secretVariables, secretsMatch);
    case "commandsBefore":
      return sameList(one.commandsBefore, other.commandsBefore, (a, b) => a === b);
    case "portVariable":
      return (
        ("portVariable" in one ? one.portVariable : undefined) ===
        ("portVariable" in other ? other.portVariable : undefined)
      );
    case "memoryMegabytes":
      return one.memoryMegabytes === other.memoryMegabytes;
  }
}

/** Kept secrets are the same when their names and values are. */
export function sameSecret(one: TestTargetSecret, other: TestTargetSecret): boolean {
  return one.name === other.name && one.value === other.value;
}

/** The fields of `after`'s kind that differ from `before`'s, every one for a target added. */
export function changedFields<Secret>(
  before: TestTargetFields<Secret> | undefined,
  after: TestTargetFields<Secret>,
  same: (one: Secret, other: Secret) => boolean,
): TestTargetField[] {
  return fieldsOfKind(after.kind).filter(
    (field) => before === undefined || !sameField(field, before, after, same),
  );
}

/**
 * Who set each of `after`'s fields: `setter` for each that changed from `before` (every one for a
 * target added; Secret variables when a name or a value changed), the earlier setter for the rest.
 * With no `setter`, as for a person's change on a Task, a field that changed has no known setter.
 * A field `after`'s kind doesn't have is forgotten.
 */
export function setByAfter(
  before: TestTarget | undefined,
  after: TestTargetFields<TestTargetSecret>,
  setter: TestTargetSetter | undefined,
): TestTargetSetBy {
  const changed = changedFields(before, after, sameSecret);
  const setBy: Partial<Record<TestTargetField, TestTargetSetter>> = {};
  for (const field of fieldsOfKind(after.kind)) {
    const kept = before?.setBy[field];
    if (changed.includes(field)) {
      if (setter) setBy[field] = setter;
    } else if (kept) setBy[field] = kept;
  }
  return setBy;
}

function sameSetter(
  one: TestTargetSetter | undefined,
  other: TestTargetSetter | undefined,
): boolean {
  if (one === undefined || other === undefined) return one === other;
  if (one.by === "user") {
    return (
      other.by === "user" &&
      one.user.userId === other.user.userId &&
      one.user.name === other.user.name
    );
  }
  return (
    other.by === "proposal" &&
    one.proposalId === other.proposalId &&
    one.agent.roleKey === other.agent.roleKey &&
    one.agent.name === other.agent.name
  );
}

/** Whether the two lists hold the same targets, in the same order, with the same values. */
export function sameTestTargets(one: readonly TestTarget[], other: readonly TestTarget[]): boolean {
  return sameList(
    one,
    other,
    (a, b) =>
      a.key === b.key &&
      TEST_TARGET_FIELDS.every((field) => sameField(field, a, b, sameSecret)) &&
      TEST_TARGET_FIELDS.every((field) => sameSetter(a.setBy[field], b.setBy[field])),
  );
}

/**
 * Every reason the Project's test targets, whole, can't be saved, each naming its target (spec
 * §2.12; the Project page's rules, which a Proposal's result is checked by too). A Secret variable
 * may be without a value: the target says which values are missing until the user types them.
 */
export function testTargetProblems(
  targets: readonly TestTargetFields<TestTargetSecret>[],
  commandKeys: readonly string[],
): string[] {
  const problems: string[] = [];
  const keys = targets.map(({ key }) => key);
  for (const key of new Set(keys.filter((each, index) => keys.indexOf(each) !== index))) {
    problems.push(`The key "${key}" is given to more than one test target.`);
  }
  for (const target of targets) {
    problems.push(
      ...oneTargetProblems(target, commandKeys).map(
        (problem) => `${testTargetLabel(target.key)}: ${problem}`,
      ),
    );
  }
  return problems;
}

function oneTargetProblems(
  target: TestTargetFields<TestTargetSecret>,
  commandKeys: readonly string[],
): string[] {
  const problems: string[] = [];
  const keyProblem = keyShapeProblem(target.key, "A test target's");
  if (keyProblem) problems.push(keyProblem);
  if (target.name === "") problems.push("Give it a name.");
  else if (target.name.length > TEST_TARGET_NAME_LENGTH) {
    problems.push(`Its name may be at most ${TEST_TARGET_NAME_LENGTH} characters.`);
  } else if (/[\r\n\0]/.test(target.name)) problems.push("Its name must be one line.");
  if (target.kind === "install-on-a-device" || target.kind === "deployed-elsewhere") {
    problems.push(`${TEST_TARGET_KIND_NAMES[target.kind]} isn't built yet.`);
    return problems;
  }
  if (target.kind === "hosted") {
    if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
      problems.push("Its port must be a whole number from 1 to 65535.");
    }
    problems.push(...portVariableProblems(target));
  } else {
    if (target.entryPoint.kind === "devcontainer-service") {
      problems.push("A .devcontainer/ service is an entry point for Hosted only.");
    }
    if (target.outputPatterns.length === 0) {
      problems.push(
        "Give at least one output file pattern, such as app/build/outputs/apk/debug/*.apk.",
      );
    }
    problems.push(...target.outputPatterns.flatMap(outputPatternProblems));
  }
  problems.push(
    ...entryPointShapeProblems(target.entryPoint),
    ...variablesProblems(target),
    ...commandsBeforeProblems(target.commandsBefore, commandKeys),
    ...memoryProblems(target.memoryMegabytes),
  );
  return problems;
}

/**
 * A command before the entry point is one of the Project's commands by its key; one removed from
 * the Project later is the launch's to refuse, as the target was saved with it.
 */
function commandsBeforeProblems(
  commandsBefore: readonly string[],
  commandKeys: readonly string[],
): string[] {
  return [...new Set(commandsBefore)]
    .filter((key) => !commandKeys.includes(key))
    .map(
      (key) =>
        `The command ${key} in its commands before the entry point isn't one of the Project's commands.`,
    );
}

/** The port variable is a variable's name the app can read, and nothing else sets it. */
function portVariableProblems(
  target: TestTargetFields<TestTargetSecret> & HostedFields<"hosted">,
): string[] {
  const name = target.portVariable;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return [
      `Its port variable must be a variable's name: letters, digits and _, not starting with a digit, such as ${DEFAULT_PORT_VARIABLE}.`,
    ];
  }
  if (RESERVED_PORT_VARIABLES.includes(name)) {
    return [`Its port variable can't be ${name}: The Office sets it in every test instance.`];
  }
  const own = [...target.variables, ...target.secretVariables].some((each) => each.name === name);
  return own
    ? [`Its port variable ${name} is one of its own variables too: give the port its own name.`]
    : [];
}

function memoryProblems(megabytes: number | null): string[] {
  if (megabytes === null) return [];
  const { min, max, step } = TEST_TARGET_MEMORY_MEGABYTES;
  const within =
    Number.isInteger(megabytes) && megabytes >= min && megabytes <= max && megabytes % step === 0;
  return within
    ? []
    : [
        `Its memory per service is between ${gigabytes(min)} and ${gigabytes(max)}, in steps of ${gigabytes(step)}.`,
      ];
}

function gigabytes(megabytes: number): string {
  return `${megabytes / 1024} GB`;
}

function outputPatternProblems(pattern: string): string[] {
  if (/[\r\n\0]/.test(pattern)) return [`The output file pattern ${pattern} must be one line.`];
  const slashed = pattern.replaceAll("\\", "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed) || slashed.split("/").includes("..")) {
    return [
      `The output file pattern ${pattern} must stay inside the repository: relative to its root, with no "..".`,
    ];
  }
  return [];
}

function variablesProblems({
  variables,
  secretVariables,
}: TestTargetFields<TestTargetSecret>): string[] {
  const all: ProjectVariable[] = [
    ...variables.map(({ name, value }) => ({ name, value, secret: false })),
    ...secretVariables.map(({ name, value }) => ({ name, value: value ?? "", secret: true })),
  ];
  const problems: string[] = [];
  for (const variable of all) {
    const nameProblem = variableNameProblem(variable.name);
    if (nameProblem) problems.push(nameProblem);
    // A Secret variable without a value waits for one; only a value given is checked.
    if (!variable.secret || variable.value !== "") {
      problems.push(...variableValueProblems(variable));
    }
  }
  problems.push(...repeatedNameProblems(all));
  return problems;
}

function sameList<Item>(
  ones: readonly Item[],
  others: readonly Item[],
  same: (one: Item, other: Item) => boolean,
): boolean {
  return (
    ones.length === others.length &&
    ones.every((item, index) => {
      const other = others[index];
      return other !== undefined && same(item, other);
    })
  );
}
