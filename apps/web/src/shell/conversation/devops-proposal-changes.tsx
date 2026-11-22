import type {
  BuiltStage,
  Duty,
  ProjectCommandFields,
  ProjectPipelineCheck,
  ProjectPipelineFields,
  ProposedChange,
  ProposedActions,
  ProposedProjectCommands,
  ProposedTestTargets,
  Role,
  Stage,
  StageChange as ProjectStageChange,
} from "@the-office/contracts";
import { Badge, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  sameStageChange,
  stageChangeLine,
  stageChanges,
  stageFieldChanges,
  stagesLine,
  type StageChange,
} from "../pipelines/pipeline-words.ts";
import { ACTION_FIELD_LABELS, ACTION_FIELDS, actionFieldWords } from "../action-words.ts";
import { COMMAND_KIND_LABELS, INSTALL_INPUTS_LABEL, installInputsLine } from "../project-words.ts";
import {
  TEST_TARGET_FIELD_LABELS,
  testTargetFieldsOf,
  testTargetFieldWords,
} from "../test-target-words.ts";
import type { ProposedStageRoutes } from "../pipelines/flow/proposal-flow.ts";
import { SkillUpdateDiff } from "../skill-update-diff.tsx";
import { pinnedVersionLabel, sourceLabel } from "../skill-words.ts";
import { RoutesOutChange } from "./proposed-route-changes.tsx";

type ProposedSkillInstall = Extract<ProposedChange, { kind: "skill-install" }>;
type ProposedSkillUpdate = Extract<ProposedChange, { kind: "skill-update" }>;
type ProposedProjectPipeline = Extract<ProposedChange, { kind: "project-pipeline" }>;

const STAGE_CHANGE_WORDS: Readonly<Record<StageChange["change"], string>> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

/**
 * The install command, the install inputs, the before and after publishing lines and each command a
 * Proposal changes, from now to as proposed: a command added comes from nothing, one removed goes to
 * nothing, and a publishing line cleared goes to None.
 */
export function ProposedCommandChanges({
  changes,
}: {
  readonly changes: ProposedProjectCommands;
}): ReactNode {
  const {
    installCommand,
    installInputs,
    beforePublishingCommand,
    afterPublishingCommand,
    commands,
  } = changes;
  return (
    <ul className="proposal-changes">
      {installCommand && (
        <ChangeRow
          label="Install command"
          from={installCommand.from || "None"}
          to={installCommand.to}
        />
      )}
      {installInputs && (
        <ChangeRow
          label={INSTALL_INPUTS_LABEL}
          from={installInputsLine(installInputs.from) || "None"}
          to={installInputsLine(installInputs.to) || "None"}
        />
      )}
      {beforePublishingCommand && (
        <ChangeRow
          label="Before publishing"
          from={beforePublishingCommand.from || "None"}
          to={beforePublishingCommand.to || "None"}
        />
      )}
      {afterPublishingCommand && (
        <ChangeRow
          label="After publishing"
          from={afterPublishingCommand.from || "None"}
          to={afterPublishingCommand.to || "None"}
        />
      )}
      {commands.map(({ key, from, to }) => {
        // A rename shows the name on both sides, as the label gives only the one it has now.
        const withName = from !== null && to !== null && from.name !== to.name;
        return (
          <ChangeRow
            key={key}
            label={`${(from ?? to)?.name ?? key} (${key})`}
            from={from ? commandWords(from, { withName }) : "None: added"}
            to={to ? commandWords(to, { withName }) : "Removed"}
          />
        );
      })}
    </ul>
  );
}

/**
 * A command's kind and line, as a Proposal shows it: "Test · npm test", with its re-run command
 * when it has one, "Test · npm test · re-run npm test -- --last-failed", or with its name first,
 * "Unit tests · Test · npm test".
 */
export function commandWords(
  { name, kind, commandLine, rerunCommandLine }: ProjectCommandFields,
  { withName = false }: { readonly withName?: boolean } = {},
): string {
  const rerun = rerunCommandLine === "" ? "" : ` · re-run ${rerunCommandLine}`;
  const words = `${COMMAND_KIND_LABELS[kind]} · ${commandLine || "Not set"}${rerun}`;
  return withName ? `${name} · ${words}` : words;
}

/**
 * Each test target a Proposal adds, changes or removes, by key: every value it changes from now to
 * as proposed (a target added from nothing, one removed struck through), each value the user set
 * flagged "You set this", and Secret variables by name alone.
 */
export function ProposedTestTargetChanges({
  changes,
}: {
  readonly changes: ProposedTestTargets;
}): ReactNode {
  return (
    <>
      {changes.targets.map(({ key, from, to, userSet }) => {
        const shown = to ?? from;
        if (!shown) return null;
        const change = from === null ? "Added" : to === null ? "Removed" : "Changed";
        const fields = [
          ...new Set([
            ...(from ? testTargetFieldsOf(from.kind) : []),
            ...(to ? testTargetFieldsOf(to.kind) : []),
          ]),
        ];
        const label = `${shown.name} (${key})`;
        return (
          <div className="proposal-section" role="group" aria-label={label} key={key}>
            <span className="proposal-section-title">
              {to === null ? <s>{label}</s> : label} · {change}
            </span>
            <ul className="proposal-changes">
              {fields.flatMap((field) => {
                const was = from && testTargetFieldWords(from, field);
                const proposed = to && testTargetFieldWords(to, field);
                if (was === proposed) return [];
                return [
                  <ChangeRow
                    key={field}
                    label={TEST_TARGET_FIELD_LABELS[field]}
                    from={was ?? undefined}
                    to={proposed ?? "Removed"}
                    flag={
                      userSet.includes(field) && (
                        <Badge tone="warning" size="sm">
                          You set this
                        </Badge>
                      )
                    }
                  />,
                ];
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

/**
 * Each Action a Proposal adds, changes or removes, by key, as the test targets' card shows them:
 * every value it changes from now to as proposed (one added from nothing, one removed struck
 * through), each value the user set flagged "You set this", and a Leaves the workstation mark it
 * adds flagged "Marks it Leaves the workstation".
 */
export function ProposedActionChanges({
  changes,
}: {
  readonly changes: ProposedActions;
}): ReactNode {
  return (
    <>
      {changes.actions.map(({ key, from, to, userSet }) => {
        const shown = to ?? from;
        if (!shown) return null;
        const change = from === null ? "Added" : to === null ? "Removed" : "Changed";
        const label = `${shown.name} (${key})`;
        const marks = to !== null && to.leavesTheWorkstation && from?.leavesTheWorkstation !== true;
        return (
          <div className="proposal-section" role="group" aria-label={label} key={key}>
            <span className="proposal-section-title">
              {to === null ? <s>{label}</s> : label} · {change}
            </span>
            <ul className="proposal-changes">
              {ACTION_FIELDS.flatMap((field) => {
                const was = from && actionFieldWords(from, field);
                const proposed = to && actionFieldWords(to, field);
                if (was === proposed) return [];
                const youSet = userSet.includes(field);
                const marking = marks && field === "leavesTheWorkstation";
                return [
                  <ChangeRow
                    key={field}
                    label={ACTION_FIELD_LABELS[field]}
                    from={was ?? undefined}
                    to={proposed ?? "Removed"}
                    flag={
                      (youSet || marking) && (
                        <>
                          {youSet && (
                            <Badge tone="warning" size="sm">
                              You set this
                            </Badge>
                          )}
                          {marking && (
                            <Badge tone="warning" size="sm">
                              Marks it Leaves the workstation
                            </Badge>
                          )}
                        </>
                      )
                    }
                  />,
                ];
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

/** A Pipeline's Stages from now to as proposed, and each Stage the change adds, removes or rewrites. */
export function ProposedStageChanges({
  from,
  to,
}: {
  readonly from: readonly Stage[];
  readonly to: readonly Stage[];
}): ReactNode {
  return (
    <>
      <ul className="proposal-changes">
        <ChangeRow
          label="Stages"
          from={stagesLine({ stages: from })}
          to={stagesLine({ stages: to })}
        />
      </ul>
      <dl className="proposal-fields">
        {stageChanges(from, to).map(({ name, change }) => (
          <div className="proposal-field" key={`${change}-${name}`}>
            <dt>{STAGE_CHANGE_WORDS[change]}</dt>
            <dd>{name}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** A Stage template's Stage from now to as proposed: each field the change rewrites. */
export function ProposedStageFieldChanges({
  from,
  to,
  roles,
  duties,
}: {
  readonly from: Stage;
  readonly to: Stage;
  readonly roles: readonly Role[];
  /** Who holds each duty, for a Stage naming one. */
  readonly duties?: readonly Duty[];
}): ReactNode {
  return (
    <ul className="proposal-changes">
      {stageFieldChanges(from, to, roles, duties).map((change) => (
        <ChangeRow key={change.label} {...change} />
      ))}
    </ul>
  );
}

/**
 * A Project Pipeline a Proposal adds or changes (the adopted design, "Devops' Proposal of a Project
 * Pipeline"): a new one's every value, or each value a change rewrites, as was → proposed; its Stage
 * changes, each Kept or New; and the Stages the Project gets, built by the service (`was` from the
 * fields as drafted, `proposed` from those proposed), once they are read.
 */
export function ProposedProjectPipelineFields({
  change,
  projectName,
  pipelineName,
  was,
  proposed,
  roles,
  duties,
}: {
  readonly change: ProposedProjectPipeline;
  readonly projectName: string;
  /** An office-wide Pipeline's name by its id. */
  readonly pipelineName: (pipelineId: string) => string;
  readonly was: ProjectPipelineCheck | undefined;
  readonly proposed: ProjectPipelineCheck | undefined;
  readonly roles: readonly Role[];
  /** Who holds each duty, for a Stage naming one. */
  readonly duties?: readonly Duty[];
}): ReactNode {
  const { from, to } = change;
  const stageChangesDiffer = !from || !sameStageChanges(from.stageChanges, to.stageChanges);
  return (
    <>
      <ul className="proposal-changes">
        {from === null ? (
          <>
            <ChangeRow label="Project" to={projectName} />
            <ChangeRow label="Name" to={to.name} />
            <ChangeRow label="Base Pipeline" to={pipelineName(to.basePipelineId)} />
            <ChangeRow label="Description" to={to.description || "None"} />
          </>
        ) : (
          projectPipelineFieldChanges(from, to, pipelineName).map((row) => (
            <ChangeRow key={row.label} {...row} />
          ))
        )}
      </ul>
      {stageChangesDiffer && to.stageChanges.length > 0 && (
        <div className="proposal-section">
          <span className="proposal-section-title">
            {from === null
              ? `Stage changes · ${to.stageChanges.length}`
              : "Stage changes, as proposed"}
          </span>
          <dl className="proposal-fields">
            {to.stageChanges.map((stageChange, index) => (
              <ProposedStageChange
                // Stage changes have no id: the list is shown as proposed, never reordered.
                key={index}
                stageChange={stageChange}
                kept={
                  from?.stageChanges.some((each) => sameStageChange(each, stageChange)) ?? false
                }
                row={proposed?.rows.find(({ stageChangeIndexes }) =>
                  stageChangeIndexes.includes(index),
                )}
                rows={proposed?.rows ?? []}
                routes={routesOf(change, stageChange)}
                was={was?.stages ?? proposed?.stages ?? []}
                proposed={proposed?.stages ?? []}
                roles={roles}
                duties={duties}
              />
            ))}
          </dl>
        </div>
      )}
      {proposed && (
        <ul className="proposal-changes">
          <ChangeRow
            label={`${projectName} gets`}
            from={was && stagesLine(was) !== stagesLine(proposed) ? stagesLine(was) : undefined}
            to={stagesLine(proposed)}
          />
        </ul>
      )}
    </>
  );
}

/**
 * One Stage change as proposed: its line in the editor's words, Kept or New, and a Change's fields
 * or a Change routes' routes out as Was and Proposed.
 */
function ProposedStageChange({
  stageChange,
  kept,
  row,
  rows,
  routes,
  was,
  proposed,
  roles,
  duties,
}: {
  readonly stageChange: ProjectStageChange;
  readonly kept: boolean;
  /** The built Stage it made, once read. */
  readonly row: BuiltStage | undefined;
  readonly rows: readonly BuiltStage[];
  /** A Change routes' Stage's routes as they were and as proposed, when it changes them. */
  readonly routes: ProposedStageRoutes | undefined;
  /** The Stages the Project gets now and as proposed, which name where routes lead. */
  readonly was: readonly Stage[];
  readonly proposed: readonly Stage[];
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[] | undefined;
}): ReactNode {
  const stageName =
    rows.find(({ stage }) => stage.key === stageChange.stageKey)?.stage.name ??
    stageChange.stageName ??
    stageChange.stageKey;
  const fields =
    stageChange.kind === "change" && row?.baseStage
      ? stageFieldChanges(row.baseStage, row.stage, roles, duties)
      : [];
  return (
    <div className="proposal-field">
      <dt>{kept ? "Kept" : <Badge tone="success">New</Badge>}</dt>
      <dd>
        {stageChangeLine(stageChange, stageName)}
        {fields.length > 0 && (
          <ul className="proposal-changes">
            {fields.map((field) => (
              <ChangeRow key={field.label} {...field} />
            ))}
          </ul>
        )}
        {routes && (
          <ul className="proposal-changes">
            <RoutesOutChange change={routes} was={was} proposed={proposed} />
          </ul>
        )}
      </dd>
    </div>
  );
}

/** The routes a Change routes Stage change gives its Stage, as the Proposal words them. */
function routesOf(
  change: ProposedProjectPipeline,
  stageChange: ProjectStageChange,
): ProposedStageRoutes | undefined {
  if (stageChange.kind !== "change-routes") return undefined;
  return change.routes?.stages.find(({ stageKey }) => stageKey === stageChange.stageKey);
}

/** The values a change of a Project Pipeline rewrites, as was → proposed. */
function projectPipelineFieldChanges(
  from: ProjectPipelineFields,
  to: ProjectPipelineFields,
  pipelineName: (pipelineId: string) => string,
): { readonly label: string; readonly from: string; readonly to: string }[] {
  const rows = [
    { label: "Name", from: from.name, to: to.name },
    {
      label: "Base Pipeline",
      from: pipelineName(from.basePipelineId),
      to: pipelineName(to.basePipelineId),
    },
    { label: "Description", from: from.description || "None", to: to.description || "None" },
  ].filter((row) => row.from !== row.to);
  return sameStageChanges(from.stageChanges, to.stageChanges)
    ? rows
    : [
        ...rows,
        {
          label: "Stage changes",
          from: String(from.stageChanges.length),
          to: String(to.stageChanges.length),
        },
      ];
}

function sameStageChanges(
  one: readonly ProjectStageChange[],
  other: readonly ProjectStageChange[],
): boolean {
  return (
    one.length === other.length &&
    one.every((stageChange, index) => {
      const otherChange = other[index];
      return otherChange !== undefined && sameStageChange(stageChange, otherChange);
    })
  );
}

/** A skill to install: its Source, what it is, its pinned version and its files. */
export function ProposedSkillInstallFields({
  change,
}: {
  readonly change: ProposedSkillInstall;
}): ReactNode {
  return (
    <dl className="proposal-fields">
      <div className="proposal-field">
        <dt>Source</dt>
        <dd>{sourceLabel(change)}</dd>
      </div>
      <div className="proposal-field">
        <dt>Skill</dt>
        <dd className="proposal-clamp">
          {change.name} · {change.description}
        </dd>
      </div>
      <div className="proposal-field">
        <dt>Pinned version</dt>
        <dd title={change.pinnedVersion.commit}>{pinnedVersionLabel(change.pinnedVersion)}</dd>
      </div>
      <div className="proposal-field">
        <dt>Files</dt>
        <dd>
          <ul className="proposal-files">
            {change.files.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </dd>
      </div>
    </dl>
  );
}

/** An installed skill's update: the version from and to, Devops' notes, its Source and its diff. */
export function ProposedSkillUpdateFields({
  change,
}: {
  readonly change: ProposedSkillUpdate;
}): ReactNode {
  return (
    <>
      <ul className="proposal-changes">
        <ChangeRow
          label="Version"
          from={pinnedVersionLabel(change.from)}
          to={pinnedVersionLabel(change.to)}
        />
      </ul>
      <p className="proposal-notes">{change.notes}</p>
      <dl className="proposal-fields">
        <div className="proposal-field">
          <dt>Source</dt>
          <dd>{sourceLabel(change)}</dd>
        </div>
        <div className="proposal-field">
          <dt>Files</dt>
          <dd>
            <SkillUpdateDiff
              name={change.name}
              from={change.from}
              to={change.to}
              appliedDiff={change.appliedDiff}
            />
          </dd>
        </div>
      </dl>
    </>
  );
}

/** A value from one to another; a value new with the change has no `from`. */
function ChangeRow({
  label,
  from,
  to,
  flag,
}: {
  readonly label: string;
  readonly from?: string | undefined;
  readonly to: string;
  /** After the proposed value, such as "You set this". */
  readonly flag?: ReactNode;
}): ReactNode {
  return (
    <li>
      <span className="proposal-change-label">{label}</span>
      {from !== undefined && (
        <>
          <span className="proposal-change-from">{from}</span>
          <Icon name="arrow-right" size={14} aria-label="to" />
        </>
      )}
      <span className="proposal-change-to">{to}</span>
      {flag}
    </li>
  );
}
