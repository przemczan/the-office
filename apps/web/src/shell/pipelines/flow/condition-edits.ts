import type { ConditionGroup, ConditionTest, StageTestOutcome } from "@the-office/contracts";

/**
 * The route panel's edits of a condition (docs/design/pipeline-flow.html, "When these hold"), each
 * answering a new group. A test or a group is addressed by its indexes into the nested `tests`, as
 * the service's `StageProblemAt.testPath`; `[]` is the condition itself. What makes a condition
 * unusable (an empty group, a command the Project lacks) is for a check to say (flow-checks, the
 * service's), so these only keep it well formed.
 */

export type TestPath = readonly number[];
export type ConditionItem = ConditionTest | ConditionGroup;
export type StageTest = Extract<ConditionTest, { kind: "stage" }>;
export type StageTestIs = StageTestOutcome | "ran";
export type DefinitionOfDoneIs = Extract<ConditionTest, { kind: "definitionOfDone" }>["is"];

/** What a test tests, the first of its two selects: `stage: null` is the previous Stage. */
export type TestSubject =
  | { readonly kind: "stage"; readonly stage: string | null }
  | { readonly kind: "definitionOfDone" }
  | { readonly kind: "command" };

/** How many runs "ran N or more times" starts with: a Stage running again is the case worth a route. */
const DEFAULT_TIMES = 2;

const DEFAULT_TEST: StageTest = { kind: "stage", stage: null, is: "done" };

/** The condition "When these hold" starts with: the previous Stage ended Done. */
export const NEW_CONDITION: ConditionGroup = { combine: "all", tests: [DEFAULT_TEST] };

export function isGroup(item: ConditionItem): item is ConditionGroup {
  return "combine" in item;
}

/** The test or group at `path`; undefined when the path leads nowhere. */
export function testAt(group: ConditionGroup, path: TestPath): ConditionItem | undefined {
  let item: ConditionItem = group;
  for (const index of path) {
    if (!isGroup(item)) return undefined;
    const next: ConditionItem | undefined = item.tests[index];
    if (next === undefined) return undefined;
    item = next;
  }
  return item;
}

/** The group with a test added at the foot of the group at `groupPath`. */
export function withTestAdded(
  group: ConditionGroup,
  groupPath: TestPath,
  test: ConditionTest = DEFAULT_TEST,
): ConditionGroup {
  return withGroupEdited(group, groupPath, (at) => ({ ...at, tests: [...at.tests, test] }));
}

/**
 * The group with a nested group added at the foot of the group at `groupPath`. It combines the other
 * way, as nesting one that combines the same way would say nothing more, and starts with the test a
 * second case most often asks: the previous Stage ended Failed.
 */
export function withGroupAdded(group: ConditionGroup, groupPath: TestPath): ConditionGroup {
  return withGroupEdited(group, groupPath, (at) => ({
    ...at,
    tests: [
      ...at.tests,
      {
        combine: at.combine === "all" ? "any" : "all",
        tests: [{ kind: "stage", stage: null, is: "failed" }],
      },
    ],
  }));
}

/** The group without the test or group at `path`; a group left empty stays, for the check to flag. */
export function withoutTest(group: ConditionGroup, path: TestPath): ConditionGroup {
  const index = path.at(-1);
  if (index === undefined) return group;
  return withGroupEdited(group, path.slice(0, -1), (at) =>
    index < at.tests.length ? { ...at, tests: at.tests.toSpliced(index, 1) } : at,
  );
}

export function withTestReplaced(
  group: ConditionGroup,
  path: TestPath,
  test: ConditionItem,
): ConditionGroup {
  return withItemEdited(group, path, () => test);
}

export function subjectOf(test: ConditionTest): TestSubject {
  return test.kind === "stage" ? { kind: "stage", stage: test.stage } : { kind: test.kind };
}

/**
 * The test at `path` testing another subject, with the test that fits it: a Stage keeps what a
 * Stage test said (its outcome, its times), the Definition of Done starts as not met, the case a
 * route usually tests, and a command as `defaultCommandKey`, or none picked yet.
 */
export function withSubject(
  group: ConditionGroup,
  path: TestPath,
  subject: TestSubject,
  defaultCommandKey = "",
): ConditionGroup {
  return withTestEdited(group, path, (test) => {
    if (sameSubject(subjectOf(test), subject)) return test;
    switch (subject.kind) {
      case "stage":
        return stageTestOf(subject.stage, test.kind === "stage" ? test : DEFAULT_TEST);
      case "definitionOfDone":
        return { kind: "definitionOfDone", is: "some-not-met" };
      case "command":
        return { kind: "command", key: defaultCommandKey };
    }
  });
}

/** The test at `path` with another test of its subject; one that doesn't fit its subject is ignored. */
export function withTestIs(
  group: ConditionGroup,
  path: TestPath,
  is: StageTestIs | DefinitionOfDoneIs,
): ConditionGroup {
  return withTestEdited(group, path, (test) => {
    if (test.kind === "definitionOfDone" && (is === "all-met" || is === "some-not-met")) {
      return { ...test, is };
    }
    if (test.kind !== "stage" || is === "all-met" || is === "some-not-met") return test;
    const { is: _is, ...tested } = withoutTimes(test);
    return is === "ran"
      ? { ...tested, is, times: test.is === "ran" ? test.times : DEFAULT_TIMES }
      : { ...tested, is };
  });
}

/** The "ran N or more times" test at `path` with another N, at least 1. */
export function withTimes(group: ConditionGroup, path: TestPath, times: number): ConditionGroup {
  return withTestEdited(group, path, (test) =>
    test.kind === "stage" && test.is === "ran"
      ? { ...test, times: Math.max(1, Math.round(times)) }
      : test,
  );
}

export function withCommandKey(group: ConditionGroup, path: TestPath, key: string): ConditionGroup {
  return withTestEdited(group, path, (test) => (test.kind === "command" ? { ...test, key } : test));
}

export function withCombine(
  group: ConditionGroup,
  groupPath: TestPath,
  combine: ConditionGroup["combine"],
): ConditionGroup {
  return withGroupEdited(group, groupPath, (at) => ({ ...at, combine }));
}

function sameSubject(one: TestSubject, other: TestSubject): boolean {
  if (one.kind === "stage" && other.kind === "stage") return one.stage === other.stage;
  return one.kind === other.kind;
}

/** A test of `stage` saying what `like` said; its saved name was another Stage's, so it goes. */
function stageTestOf(stage: string | null, like: StageTest): StageTest {
  return like.is === "ran"
    ? { kind: "stage", stage, is: "ran", times: like.times }
    : { kind: "stage", stage, is: like.is };
}

function withoutTimes(test: StageTest): Omit<StageTest, "times"> {
  if (test.is !== "ran") return test;
  const { times: _times, ...rest } = test;
  return rest;
}

function withTestEdited(
  group: ConditionGroup,
  path: TestPath,
  edit: (test: ConditionTest) => ConditionTest,
): ConditionGroup {
  return withItemEdited(group, path, (item) => (isGroup(item) ? item : edit(item)));
}

function withGroupEdited(
  group: ConditionGroup,
  path: TestPath,
  edit: (group: ConditionGroup) => ConditionGroup,
): ConditionGroup {
  return withItemEdited(group, path, (item) => (isGroup(item) ? edit(item) : item));
}

/** The group with the item at `path` edited; a path that leads nowhere leaves it as it is. */
function withItemEdited(
  group: ConditionGroup,
  path: TestPath,
  edit: (item: ConditionItem) => ConditionItem,
): ConditionGroup {
  const [index, ...rest] = path;
  if (index === undefined) {
    const edited = edit(group);
    return isGroup(edited) ? edited : group;
  }
  const item = group.tests[index];
  if (item === undefined) return group;
  if (rest.length === 0) return { ...group, tests: group.tests.with(index, edit(item)) };
  if (!isGroup(item)) return group;
  return { ...group, tests: group.tests.with(index, withItemEdited(item, rest, edit)) };
}
