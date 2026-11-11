import type {
  ProjectCommandFields,
  ProposedChange,
  ProposedProjectCommands,
  Role,
  Stage,
} from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  stageChanges,
  stageFieldChanges,
  stagesLine,
  type StageChange,
} from "../pipelines/pipeline-words.ts";
import { COMMAND_KIND_LABELS, INSTALL_INPUTS_LABEL, installInputsLine } from "../project-words.ts";
import { SkillUpdateDiff } from "../skill-update-diff.tsx";
import { pinnedVersionLabel, sourceLabel } from "../skill-words.ts";

type ProposedSkillInstall = Extract<ProposedChange, { kind: "skill-install" }>;
type ProposedSkillUpdate = Extract<ProposedChange, { kind: "skill-update" }>;

const STAGE_CHANGE_WORDS: Readonly<Record<StageChange["change"], string>> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

/**
 * The install command, the install inputs and each command a Proposal changes, from now to as
 * proposed: a command added comes from nothing, one removed goes to nothing.
 */
export function ProposedCommandChanges({
  changes,
}: {
  readonly changes: ProposedProjectCommands;
}): ReactNode {
  const { installCommand, installInputs, commands } = changes;
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
 * A command's kind and line, as a Proposal shows it: "Test · npm test", or with its name first,
 * "Unit tests · Test · npm test".
 */
export function commandWords(
  { name, kind, commandLine }: ProjectCommandFields,
  { withName = false }: { readonly withName?: boolean } = {},
): string {
  const words = `${COMMAND_KIND_LABELS[kind]} · ${commandLine || "Not set"}`;
  return withName ? `${name} · ${words}` : words;
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
}: {
  readonly from: Stage;
  readonly to: Stage;
  readonly roles: readonly Role[];
}): ReactNode {
  return (
    <ul className="proposal-changes">
      {stageFieldChanges(from, to, roles).map((change) => (
        <ChangeRow key={change.label} {...change} />
      ))}
    </ul>
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

function ChangeRow({
  label,
  from,
  to,
}: {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}): ReactNode {
  return (
    <li>
      <span className="proposal-change-label">{label}</span>
      <span className="proposal-change-from">{from}</span>
      <Icon name="arrow-right" size={14} aria-label="to" />
      <span className="proposal-change-to">{to}</span>
    </li>
  );
}
