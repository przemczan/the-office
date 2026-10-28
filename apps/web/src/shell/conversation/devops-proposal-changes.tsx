import type { ProjectCommandFields, ProposedChange, Stage } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { stageChanges, stagesLine, type StageChange } from "../pipelines/pipeline-words.ts";
import {
  COMMAND_KEYS,
  COMMAND_LABELS,
  INSTALL_INPUTS_LABEL,
  installInputsLine,
} from "../project-words.ts";
import { pinnedVersionLabel, sourceLabel } from "../skill-words.ts";

type ProposedSkillInstall = Extract<ProposedChange, { kind: "skill-install" }>;

const STAGE_CHANGE_WORDS: Readonly<Record<StageChange["change"], string>> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

/** Each command and the install inputs a Proposal rewrites, from now to as proposed. */
export function ProposedCommandChanges({
  from,
  to,
}: {
  readonly from: ProjectCommandFields;
  readonly to: ProjectCommandFields;
}): ReactNode {
  return (
    <ul className="proposal-changes">
      {COMMAND_KEYS.flatMap((key) => {
        const proposed = to[key];
        if (proposed === undefined) return [];
        return [
          <ChangeRow
            key={key}
            label={`${COMMAND_LABELS[key]} command`}
            from={from[key] || "None"}
            to={proposed}
          />,
        ];
      })}
      {to.installInputs && (
        <ChangeRow
          label={INSTALL_INPUTS_LABEL}
          from={installInputsLine(from.installInputs ?? []) || "None"}
          to={installInputsLine(to.installInputs) || "None"}
        />
      )}
    </ul>
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
        <dd>
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
