import { useQuery } from "@tanstack/react-query";
import {
  publishingModeSchema,
  runEnvironmentAnswerSchema,
  type NewProject,
  type RunEnvironmentAnswer,
} from "@the-office/contracts";
import { Badge, Button, Field, Icon, Input, RadioGroup, RadioList, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { stagesLine } from "../../shell/pipelines/pipeline-words.ts";
import { INSTALL_INPUTS_LABEL, INSTALL_LABEL, publishingLabel } from "../../shell/project-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import {
  RUN_ENVIRONMENT_ANSWERS,
  RUN_ENVIRONMENT_ANSWER_LABELS,
  RUN_ENVIRONMENT_QUESTION,
  RUN_ENVIRONMENT_QUESTION_HINT,
} from "../../shell/run-environment-words.ts";
import { WHERE_IT_IS_OPTIONS, type ProjectSource } from "./add-project-source.ts";
import { MarkPicker } from "./mark-picker.tsx";

/** An example line for install and for each command a Project starts with, by its key. */
const COMMAND_EXAMPLES: Readonly<Record<string, string>> = {
  install: "npm ci",
  build: "npm run build",
  lint: "npm run lint",
  test: "npm test",
};

const COMMANDS_HINT =
  "Optional. Leave any you don't know yet: set them later on the Project's page, or ask whoever onboards Projects.";

const BASE_BRANCH_HINT = "Tasks branch from it and publish to it.";

/** Under an empty clone's Base branch: what adding the Project does to the repository. */
function emptyCloneNote(baseBranch: string): string {
  const branch = baseBranch.trim() === "" ? "the base branch" : baseBranch.trim();
  return `The repository has no commits yet. Adding the Project makes ${branch} with an empty first commit and pushes it to the repository.`;
}

const SOURCE_ICONS: Readonly<Record<ProjectSource["whereItIs"], string>> = {
  folder: "folder",
  "git-url": "link",
  github: "github",
};

/**
 * Step 2 of Add a Project: where the repository is, as one line with Change, then the Project's
 * fields. Its form is submitted by the bar's Add the Project.
 */
export function ProjectDetailsStep({
  formId,
  source,
  draft,
  mark,
  installInputs,
  runEnvironmentAnswer,
  refusal,
  onChange,
  onMarkChange,
  onInstallInputsChange,
  onRunEnvironmentAnswerChange,
  onChangeSource,
  onSubmit,
}: {
  readonly formId: string;
  readonly source: ProjectSource;
  readonly draft: NewProject;
  /** The mark shown, its label following the name until the user writes one. */
  readonly mark: NewProject["mark"];
  readonly installInputs: string;
  readonly runEnvironmentAnswer: RunEnvironmentAnswer;
  /** Why the service refused the last Add the Project. */
  readonly refusal: Error | null;
  readonly onChange: (fields: Partial<NewProject>) => void;
  readonly onMarkChange: (mark: NewProject["mark"]) => void;
  readonly onInstallInputsChange: (installInputs: string) => void;
  readonly onRunEnvironmentAnswerChange: (answer: RunEnvironmentAnswer) => void;
  readonly onChangeSource: () => void;
  readonly onSubmit: () => void;
}): ReactNode {
  const pipelines = useQuery(pipelineQueries.list());
  const defaultPipeline = pipelines.data?.find((pipeline) => pipeline.id === draft.defaultPipeline);
  const emptyClone = source.whereItIs !== "folder" && source.clone.empty;
  // A folder's branches aren't read before Continue, and an empty clone has none: both are typed.
  const branches = source.whereItIs === "folder" || emptyClone ? undefined : source.clone.branches;
  return (
    <form
      id={formId}
      className="add-project-stack"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <SourceLine source={source} onChange={onChangeSource} />
      {refusal && <RefusalAlert title="The Project can't be added yet" error={refusal} />}
      <div className="add-project-columns">
        <Input
          label="Name"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          autoFocus
        />
        <Field label="Mark">
          <MarkPicker projectName={draft.name} mark={mark} onChange={onMarkChange} />
        </Field>
      </div>
      <div className="add-project-columns">
        {branches ? (
          <Select
            label="Base branch"
            hint={BASE_BRANCH_HINT}
            value={draft.baseBranch}
            options={branches.map((branch) => ({ value: branch, label: branch }))}
            onChange={(branch) => onChange({ baseBranch: branch })}
          />
        ) : (
          <Input
            label="Base branch"
            hint={emptyClone ? emptyCloneNote(draft.baseBranch) : BASE_BRANCH_HINT}
            value={draft.baseBranch}
            onChange={(event) => onChange({ baseBranch: event.target.value })}
            inputStyle={{ fontFamily: "var(--font-mono)" }}
          />
        )}
        <Select
          label="Default Pipeline"
          hint={defaultPipeline && stagesLine(defaultPipeline)}
          value={draft.defaultPipeline}
          options={(pipelines.data ?? []).map((pipeline) => ({
            value: pipeline.id,
            label: pipeline.name,
          }))}
          onChange={(pipelineId) => onChange({ defaultPipeline: pipelineId })}
        />
      </div>
      <Field label="Commands" hint={COMMANDS_HINT}>
        <div className="add-project-columns">
          <Input
            label={INSTALL_LABEL}
            placeholder={COMMAND_EXAMPLES.install}
            value={draft.installCommand}
            onChange={(event) => onChange({ installCommand: event.target.value })}
            inputStyle={{ fontFamily: "var(--font-mono)" }}
          />
          {draft.commands.map((command) => (
            <Input
              key={command.key}
              label={command.name}
              placeholder={COMMAND_EXAMPLES[command.key]}
              value={command.commandLine}
              onChange={(event) =>
                onChange({
                  commands: draft.commands.map((each) =>
                    each.key === command.key ? { ...each, commandLine: event.target.value } : each,
                  ),
                })
              }
              inputStyle={{ fontFamily: "var(--font-mono)" }}
            />
          ))}
        </div>
      </Field>
      <Input
        label={INSTALL_INPUTS_LABEL}
        hint="Files whose change makes a worktree install again, separated by commas. With none, a worktree installs once."
        placeholder="package-lock.json"
        value={installInputs}
        onChange={(event) => onInstallInputsChange(event.target.value)}
        inputStyle={{ fontFamily: "var(--font-mono)" }}
      />
      <Field label="Publishing">
        <RadioGroup
          value={draft.publishingMode}
          options={publishingModeSchema.options.map((mode) => ({
            value: mode,
            label: publishingLabel(mode, draft.baseBranch.trim() || "the base branch"),
          }))}
          onChange={(mode) => onChange({ publishingMode: publishingModeSchema.parse(mode) })}
        />
      </Field>
      <Field label={RUN_ENVIRONMENT_QUESTION} hint={RUN_ENVIRONMENT_QUESTION_HINT}>
        <RadioList
          label={RUN_ENVIRONMENT_QUESTION}
          name={`${formId}-run-environment`}
          value={runEnvironmentAnswer}
          options={RUN_ENVIRONMENT_ANSWERS.map((answer) => ({
            value: answer,
            label: RUN_ENVIRONMENT_ANSWER_LABELS[answer],
          }))}
          onChange={(answer) =>
            onRunEnvironmentAnswerChange(runEnvironmentAnswerSchema.parse(answer))
          }
        />
      </Field>
    </form>
  );
}

/** What step 1 chose: its kind, the folder or the repository, Private, and where it was cloned. */
function SourceLine({
  source,
  onChange,
}: {
  readonly source: ProjectSource;
  readonly onChange: () => void;
}): ReactNode {
  const kind = WHERE_IT_IS_OPTIONS.find((option) => option.value === source.whereItIs)?.label;
  const value =
    source.whereItIs === "folder"
      ? source.path
      : source.whereItIs === "github" && source.repository
        ? source.repository.fullName
        : source.clone.url;
  return (
    <div className="add-project-source" role="group" aria-label="Where it is">
      <Icon name={SOURCE_ICONS[source.whereItIs]} />
      <span className="add-project-source-words">
        <span className="add-project-source-kind">{kind}</span>
        <span className="add-project-source-value" title={value}>
          {value}
        </span>
        {source.whereItIs === "github" && source.repository?.private && (
          <Badge tone="neutral">Private</Badge>
        )}
        {source.whereItIs !== "folder" && (
          <span className="add-project-source-cloned" title={`Cloned into ${source.clone.path}`}>
            cloned into {source.clone.path}
          </span>
        )}
      </span>
      <Button variant="secondary" size="sm" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}
