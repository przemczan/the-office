import { ProjectRefused } from "./project-refused.js";
import {
  changedFields,
  fieldsOfKind,
  sameField,
  setByAfter,
  testTargetLabel,
  testTargetProblems,
  trimmedTestTarget,
  TEST_TARGET_FIELDS,
  type TestTarget,
  type TestTargetField,
  type TestTargetFields,
  type TestTargetSetter,
} from "./test-target.js";

/** A test target's fields as a Proposal carries them: its Secret variables by name alone. */
export type ProposedTestTargetFields = TestTargetFields<string>;

/**
 * A target added (`from` null), changed, or removed (`to` null), by its key, as the Project had it
 * when the Proposal was drafted and as proposed. `userSet` names the fields the user set that it
 * changes, each named by the Agent on purpose, which its card flags "You set this".
 */
export interface ProposedTestTarget {
  readonly key: string;
  readonly from: ProposedTestTargetFields | null;
  readonly to: ProposedTestTargetFields | null;
  readonly userSet: readonly TestTargetField[];
}

/** What a Proposal of test targets changes (spec §2.12, "Writing test targets"); the rest stay. */
export interface ProposedTestTargets {
  readonly targets: readonly ProposedTestTarget[];
}

/** What the Agent gives: only what changes. */
export interface TestTargetsToPropose {
  /** Each added, or changed by its key, whole, its Secret variables by name. */
  readonly targets: readonly ProposedTestTargetFields[];
  /** The keys of the targets to remove. */
  readonly removeTargets?: readonly string[] | undefined;
  /** The values the user set that it changes on purpose, each as `key.field`, such as `web.port`. */
  readonly changeUserSet?: readonly string[] | undefined;
}

/** The target as a Proposal carries it: Secret variables by name, without who set what. */
export function proposedFieldsOf(target: TestTarget): ProposedTestTargetFields {
  const { setBy: _setBy, secretVariables, ...fields } = target;
  return { ...fields, secretVariables: secretVariables.map(({ name }) => name) };
}

const sameName = (one: string, other: string): boolean => one === other;

/**
 * What of `given` differs from the Project's targets, each with the target now and as proposed. A
 * key given twice keeps the last; a key also removed is removed. Refused when it changes a value the
 * user set that `changeUserSet` doesn't name (removing a target changes each of its values), when
 * it removes a key the Project lacks, or when it changes nothing.
 */
export function proposedTestTargets(
  current: readonly TestTarget[],
  given: TestTargetsToPropose,
): ProposedTestTargets {
  const proposed = new Map<string, ProposedTestTarget>();
  const missing: string[] = [];
  for (const target of given.targets.map((each) =>
    trimmedTestTarget(each, (name) => name.trim()),
  )) {
    const now = current.find(({ key }) => key === target.key);
    const from = now ? proposedFieldsOf(now) : null;
    const changed = from ? changedFields(from, target, sameName) : fieldsOfKind(target.kind);
    if (from && changed.length === 0) proposed.delete(target.key);
    else {
      proposed.set(target.key, {
        key: target.key,
        from,
        to: target,
        userSet: now && from ? userSetAmong(now, changedOrDropped(from, target, changed)) : [],
      });
    }
  }
  for (const key of (given.removeTargets ?? []).map((each) => each.trim())) {
    const now = current.find((target) => target.key === key);
    if (!now) {
      missing.push(key);
      continue;
    }
    proposed.set(key, {
      key,
      from: proposedFieldsOf(now),
      to: null,
      userSet: userSetAmong(now, TEST_TARGET_FIELDS),
    });
  }
  if (missing.length > 0) {
    throw new ProjectRefused(
      missing.map((key) => `The Project has no test target with the key "${key}" to remove.`),
    );
  }
  const targets = [...proposed.values()];
  if (targets.length === 0) {
    throw new ProjectRefused([
      "Nothing changes: give the test targets to add or change, each one whole, or the keys to remove.",
    ]);
  }
  const named = new Set((given.changeUserSet ?? []).map((each) => each.trim()));
  const unnamed = targets.flatMap(({ key, userSet }) =>
    userSet.map((field) => `${key}.${field}`).filter((value) => !named.has(value)),
  );
  if (unnamed.length > 0) {
    throw new ProjectRefused([
      `The user set ${unnamed.join(", ")}, which this changes: name each in changeUserSet to change it on purpose, or leave it as it is.`,
    ]);
  }
  return { targets };
}

/** The fields changed, and those the target had that its new kind drops. */
function changedOrDropped(
  from: ProposedTestTargetFields,
  to: ProposedTestTargetFields,
  changed: readonly TestTargetField[],
): TestTargetField[] {
  const kept = fieldsOfKind(to.kind);
  const dropped = fieldsOfKind(from.kind).filter((field) => !kept.includes(field));
  return [...changed, ...dropped];
}

function userSetAmong(target: TestTarget, fields: readonly TestTargetField[]): TestTargetField[] {
  return TEST_TARGET_FIELDS.filter(
    (field) => fields.includes(field) && target.setBy[field]?.by === "user",
  );
}

/**
 * Every reason the Proposal can't apply to the targets as they are: it changes nothing, a target
 * it changes changed since it was drafted (each named, and checked first), or its result breaks a
 * rule the Project page keeps too.
 */
export function proposedTestTargetsProblems(
  current: readonly TestTarget[],
  proposed: ProposedTestTargets,
): string[] {
  if (proposed.targets.length === 0) {
    return ["Nothing changes: the Proposal adds, changes or removes no test target."];
  }
  const keys = proposed.targets.map(({ key }) => key);
  const repeated = new Set(keys.filter((key, index) => keys.indexOf(key) !== index));
  if (repeated.size > 0) {
    return [...repeated].map((key) => `${testTargetLabel(key)} is proposed more than once.`);
  }
  const stale = proposed.targets.flatMap((target) => staleProblems(current, target));
  if (stale.length > 0) return stale;
  return testTargetProblems(appliedTargets(current, proposed));
}

function staleProblems(
  current: readonly TestTarget[],
  { key, from, to }: ProposedTestTarget,
): string[] {
  const now = current.find((target) => target.key === key);
  if (from === null) {
    if (to === null) return [`The Project has no test target with the key "${key}".`];
    return now ? [`${testTargetLabel(key)} was added since this was proposed.`] : [];
  }
  if (!now) return [`${testTargetLabel(key)} was removed since this was proposed.`];
  const nowFields = proposedFieldsOf(now);
  const same =
    nowFields.kind === from.kind &&
    TEST_TARGET_FIELDS.every((field) => sameField(field, nowFields, from, sameName));
  return same ? [] : [`${testTargetLabel(key)} changed since this was proposed.`];
}

/**
 * The targets with the Proposal applied, in their order with added ones last: a Secret variable
 * kept by name keeps its value, a new one has none until the user types it; `setter` is stamped
 * on each field it changed. Check `proposedTestTargetsProblems` first.
 */
export function appliedTargets(
  current: readonly TestTarget[],
  proposed: ProposedTestTargets,
  setter?: TestTargetSetter,
): TestTarget[] {
  const byKey = new Map(proposed.targets.map((target) => [target.key, target]));
  const applied: TestTarget[] = [];
  for (const now of current) {
    const change = byKey.get(now.key);
    if (!change) applied.push(now);
    else if (change.to !== null) applied.push(withProposed(now, change.to, setter));
  }
  for (const change of proposed.targets) {
    if (change.to !== null && !current.some((target) => target.key === change.key)) {
      applied.push(withProposed(undefined, change.to, setter));
    }
  }
  return applied;
}

function withProposed(
  before: TestTarget | undefined,
  to: ProposedTestTargetFields,
  setter: TestTargetSetter | undefined,
): TestTarget {
  const fields = {
    ...to,
    secretVariables: to.secretVariables.map((name) => ({
      name,
      value: before?.secretVariables.find((secret) => secret.name === name)?.value ?? null,
    })),
  };
  return { ...fields, setBy: setter ? setByAfter(before, fields, setter) : (before?.setBy ?? {}) };
}
