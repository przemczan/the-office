import type { ConditionGroup, ConditionTest, Stage, StageProblem } from "@the-office/contracts";
import { Button, Icon, IconButton, SegmentedControl, Select, Stepper } from "@the-office/ui";
import type { ReactNode } from "react";
import type { StageCommandSource } from "../stage-commands.ts";
import { conditionCommandChoices } from "./condition-commands.ts";
import {
  isGroup,
  withCombine,
  withCommandKey,
  withGroupAdded,
  withoutTest,
  withSubject,
  withTestAdded,
  withTestIs,
  withTimes,
  type DefinitionOfDoneIs,
  type StageTestIs,
  type TestPath,
  type TestSubject,
} from "./condition-edits.ts";
import {
  DEFINITION_OF_DONE_TEST_WORDS,
  previousStageLabel,
  STAGE_TEST_WORDS,
  stageNameOrGone,
} from "./condition-words.ts";
import { earlierStages } from "./flow-model.ts";

/** The most runs "ran N or more times" offers. */
const MOST_TIMES = 20;

const PREVIOUS = "previous";
const DEFINITION_OF_DONE = "definitionOfDone";
const COMMAND = "command";
const STAGE_PREFIX = "stage:";

export interface ConditionBuilderProps {
  readonly condition: ConditionGroup;
  readonly onChange: (condition: ConditionGroup) => void;
  /** The route's own Stage, which "The previous Stage" names. */
  readonly from: Stage;
  readonly stages: readonly Stage[];
  /** What a command test may run: the Project's commands, or every Project's in Settings. */
  readonly commands: StageCommandSource | undefined;
  /** The route's problems: each test's shows on its select, matched by `at.testPath`. */
  readonly problems: readonly StageProblem[];
  readonly readOnly?: boolean;
}

/**
 * "When these hold" (docs/design/pipeline-flow.html): a group's All of / Any of and its tests, each
 * two selects joined by "and" or "or", and its nested groups, to any depth, with Add a test and Add a
 * group at each group's foot.
 */
export function ConditionBuilder(props: ConditionBuilderProps): ReactNode {
  return <GroupEditor {...props} group={props.condition} path={[]} />;
}

interface GroupEditorProps extends ConditionBuilderProps {
  readonly group: ConditionGroup;
  readonly path: TestPath;
}

function GroupEditor(props: GroupEditorProps): ReactNode {
  const { group, path, condition, onChange, readOnly = false } = props;
  const all = group.combine === "all";
  const nested = path.length > 0;
  return (
    <div className="condition-group" role="group" aria-label={nested ? "A group" : "Condition"}>
      <div className="condition-group-head">
        <span role="group" aria-label="How these combine">
          <SegmentedControl
            size="sm"
            options={[
              { value: "all", label: "All of" },
              { value: "any", label: "Any of" },
            ]}
            value={group.combine}
            onChange={(combine) => {
              if (readOnly || (combine !== "all" && combine !== "any")) return;
              onChange(withCombine(condition, path, combine));
            }}
          />
        </span>
        <span className="condition-group-words">these {all ? "hold" : "holds"}</span>
        {nested && !readOnly && (
          <IconButton
            size="sm"
            icon={<Icon name="x" size={13} />}
            label="Remove this group"
            onClick={() => onChange(withoutTest(condition, path))}
          />
        )}
      </div>
      {group.tests.length > 0 ? (
        <ul className="condition-items">
          {group.tests.map((item, index) => {
            const at = [...path, index];
            return (
              <li key={JSON.stringify(at)} className="condition-item">
                {index > 0 && <span className="condition-join">{all ? "and" : "or"}</span>}
                {isGroup(item) ? (
                  <GroupEditor {...props} group={item} path={at} />
                ) : (
                  <TestEditor {...props} test={item} path={at} />
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="condition-empty">No test yet: add one, or remove this group.</p>
      )}
      {problemsAt(props.problems, path).map((text) => (
        <p key={text} className="condition-why" role="status">
          {text}
        </p>
      ))}
      {!readOnly && (
        <div className="condition-foot">
          <Button
            size="sm"
            variant="secondary"
            iconLeft={<Icon name="plus" size={12} />}
            onClick={() => onChange(withTestAdded(condition, path))}
          >
            Add a test
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<Icon name="layers" size={12} />}
            onClick={() => onChange(withGroupAdded(condition, path))}
          >
            Add a group
          </Button>
        </div>
      )}
    </div>
  );
}

interface TestEditorProps extends ConditionBuilderProps {
  readonly test: ConditionTest;
  readonly path: TestPath;
}

function TestEditor(props: TestEditorProps): ReactNode {
  const { test, path, condition, onChange, from, readOnly = false } = props;
  const why = problemsAt(props.problems, path).join(" ") || undefined;
  return (
    <div
      className={`condition-test${test.kind === "stage" && test.is === "ran" ? " condition-test--times" : ""}`}
    >
      <Select
        size="sm"
        aria-label="What it tests"
        value={subjectValue(test, from)}
        options={subjectChoices(test, from, props.stages)}
        error={test.kind === "command" ? undefined : why}
        disabled={readOnly}
        onChange={(value) => onChange(withSubject(condition, path, subjectOfValue(value)))}
      />
      <SecondSelect {...props} error={test.kind === "command" ? why : undefined} />
      {test.kind === "stage" && test.is === "ran" && (
        <Stepper
          label="Times"
          value={test.times}
          min={1}
          max={MOST_TIMES}
          disabled={readOnly}
          onChange={(times) => onChange(withTimes(condition, path, times))}
        />
      )}
      {!readOnly && (
        <IconButton
          size="sm"
          icon={<Icon name="x" size={13} />}
          label="Remove this test"
          onClick={() => onChange(withoutTest(condition, path))}
        />
      )}
      {test.kind === "command" && <p className="condition-test-note">Holds when it exits 0.</p>}
    </div>
  );
}

/** The test of a Stage or the Definition of Done, or a command test's command. */
function SecondSelect({
  test,
  path,
  condition,
  onChange,
  commands,
  readOnly = false,
  error,
}: TestEditorProps & { readonly error: string | undefined }): ReactNode {
  switch (test.kind) {
    case "stage":
      return (
        <Select
          size="sm"
          aria-label="Test"
          value={test.is}
          options={Object.entries(STAGE_TEST_WORDS).map(([value, label]) => ({ value, label }))}
          disabled={readOnly}
          onChange={(is) => onChange(withTestIs(condition, path, is as StageTestIs))}
        />
      );
    case "definitionOfDone":
      return (
        <Select
          size="sm"
          aria-label="Test"
          value={test.is}
          options={Object.entries(DEFINITION_OF_DONE_TEST_WORDS).map(([value, label]) => ({
            value,
            label,
          }))}
          disabled={readOnly}
          onChange={(is) => onChange(withTestIs(condition, path, is as DefinitionOfDoneIs))}
        />
      );
    case "command":
      return (
        <Select
          size="sm"
          aria-label="Project command"
          value={test.key}
          options={conditionCommandChoices(test.key, commands)}
          error={error}
          disabled={readOnly}
          onChange={(key) => onChange(withCommandKey(condition, path, key))}
        />
      );
  }
}

function subjectValue(test: ConditionTest, from: Stage): string {
  if (test.kind !== "stage") return test.kind;
  return test.stage === null || test.stage === from.key ? PREVIOUS : STAGE_PREFIX + test.stage;
}

function subjectOfValue(value: string): TestSubject {
  if (value === DEFINITION_OF_DONE) return { kind: "definitionOfDone" };
  if (value === COMMAND) return { kind: "command" };
  return {
    kind: "stage",
    stage: value.startsWith(STAGE_PREFIX) ? value.slice(STAGE_PREFIX.length) : null,
  };
}

/**
 * The first select: the previous Stage, each earlier Stage by name, the Definition of Done and a
 * Project command. A Stage the test names that is no longer earlier stays listed, flagged.
 */
function subjectChoices(
  test: ConditionTest,
  from: Stage,
  stages: readonly Stage[],
): { value: string; label: string }[] {
  const earlier = earlierStages(stages, from.key);
  const named = test.kind === "stage" && test.stage !== null && test.stage !== from.key;
  const stale =
    named && !earlier.some(({ key }) => key === test.stage)
      ? [
          {
            value: STAGE_PREFIX + test.stage,
            label: `${stageNameOrGone(test.stage ?? "", test.stageName, stages)} (${
              stages.some(({ key }) => key === test.stage) ? "later" : "gone"
            })`,
          },
        ]
      : [];
  return [
    { value: PREVIOUS, label: previousStageLabel(from) },
    ...earlier.map(({ key, name }) => ({ value: STAGE_PREFIX + key, label: name })),
    ...stale,
    { value: DEFINITION_OF_DONE, label: "The Definition of Done" },
    { value: COMMAND, label: "A Project command" },
  ];
}

/** The words of the problems on the test or group at `path`. */
function problemsAt(problems: readonly StageProblem[], path: TestPath): readonly string[] {
  return problems
    .filter(
      ({ at }) =>
        at?.kind === "route" &&
        at.testPath !== undefined &&
        at.testPath.length === path.length &&
        at.testPath.every((index, position) => index === path[position]),
    )
    .map(({ text }) => text);
}
