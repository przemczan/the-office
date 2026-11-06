import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type {
  Preset,
  Proposal,
  ProposalApplication,
  ProposedChange,
  Role,
  RoleCard,
} from "@the-office/contracts";
import { Badge, Button, Icon, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  applyProposal,
  declineProposal,
  officeInstructionsQuery,
  sizeThresholdQuery,
  threadQueries,
} from "../../api/conversations.ts";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { skillQueries } from "../../api/skills.ts";
import { initiativeQueries, officeWideLimitQuery, taskQueries } from "../../api/work.ts";
import { useEngineName } from "../use-engine-name.ts";
import { personName, roleName } from "../person-name.ts";
import {
  COMMAND_KEYS,
  COMMAND_LABELS,
  INSTALL_INPUTS_LABEL,
  installInputsLine,
  publishingLabel,
} from "../project-words.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import {
  CAPABILITIES,
  fieldLabel,
  fieldValueText,
  HARD_SWITCH_LABELS,
  hardSwitchValueLabel,
  permissionProfileLines,
  proposedFieldChanges,
  SESSION_DEFAULTS,
  taskLimitLabel,
  type RoleTitles,
  worksWithText,
} from "../role-card-words.ts";
import { SkillChip } from "../skill-chip.tsx";
import { pinnedVersionLabel } from "../skill-words.ts";
import { momentWords } from "../time.ts";
import { PRIORITY_NAMES } from "../work/work-words.ts";
import { useToast } from "../toasts.tsx";
import { tokensShort } from "./context-words.ts";
import {
  ProposedCommandChanges,
  ProposedSkillInstallFields,
  ProposedSkillUpdateFields,
  ProposedStageChanges,
} from "./devops-proposal-changes.tsx";
import "./conversation.css";

type ProposedHire = Extract<ProposedChange, { kind: "hire" }>;
type ProposedPresetHire = Extract<ProposedChange, { kind: "hire-from-preset" }>;
type ProposedRoleChange = Extract<ProposedChange, { kind: "change" }>;
type ProposedLimitChange = Extract<ProposedChange, { kind: OfficeLimit }>;
type InitiativeEdit = Extract<ProposedChange, { kind: "initiative" }>["edit"];
type OfficeLimit = "office-wide-limit" | "size-threshold";

/** How the card words each number on Settings › Office limits, as that page does. */
const OFFICE_LIMITS: Record<
  OfficeLimit,
  {
    readonly title: string;
    readonly label: string;
    readonly valueText: (value: number) => string;
    readonly appliesWhen: string;
    readonly query: () => { readonly queryKey: QueryKey };
  }
> = {
  "office-wide-limit": {
    title: "Change the Office-wide limit",
    label: "Running Tasks at once",
    valueText: String,
    appliesWhen: "Applies to the next Start; running Tasks finish",
    query: officeWideLimitQuery,
  },
  "size-threshold": {
    title: "Change the size threshold",
    label: "Size threshold",
    valueText: (tokens) => `${tokensShort(tokens)} tokens`,
    appliesWhen: "Applies from each Thread's next message",
    query: sizeThresholdQuery,
  },
};

/**
 * A Proposal as a card in the drafting person's chat (spec §2.4): a new Role to hire, from scratch
 * (as proposed or edited first on the hire page) or from a preset (under the proposed name or one
 * the user gives), a change to a Role's card, a new value for an Office setting, the CTO's change to
 * an Initiative, or Devops' change to a Project's commands or a library Pipeline's Stages, a
 * Project to onboard, a skill to install from a Source or its update, or a written skill drafted
 * in a chat. Nothing changes until the user applies it; "Not now" declines it.
 */
export function ProposalCard({ proposal }: { readonly proposal: Proposal }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const options = useQuery(roleCardQueries.options()).data;
  const presets = useQuery(roleCardQueries.presets()).data;
  const projects = useQuery(projectQueries.list()).data;
  const pipelines = useQuery(pipelineQueries.list()).data;
  const roleTitles: RoleTitles = new Map(options?.knownRoles.map(({ key, title }) => [key, title]));
  const { change } = proposal;
  switch (change.kind) {
    case "hire":
      return (
        <ProposalFrame title={`New Role · ${change.card.name} · ${change.card.title}`}>
          <ProposedCard card={change.card} roleTitles={roleTitles} />
          <HireFoot proposal={proposal} change={change} />
        </ProposalFrame>
      );
    case "hire-from-preset": {
      const preset = presets?.find(({ roleKey }) => roleKey === change.roleKey);
      const title = preset?.card.title ?? change.roleKey;
      return (
        <ProposalFrame title={`New Role · ${change.name} · ${title}`}>
          {preset && (
            <ProposedCard card={presetCard(preset, change.name)} roleTitles={roleTitles} />
          )}
          <PresetHireFoot proposal={proposal} change={change} title={title} />
        </ProposalFrame>
      );
    }
    case "change":
      return (
        <ProposalFrame title={`Change ${roleName(change.roleKey, roles)}`}>
          <ProposedChanges change={change} roleTitles={roleTitles} />
          <ChangeFoot proposal={proposal} personFirstName={firstName(change.roleKey, roles)} />
        </ProposalFrame>
      );
    case "office-wide-limit":
    case "size-threshold":
      return (
        <ProposalFrame title={OFFICE_LIMITS[change.kind].title}>
          <ProposedLimit change={change} />
          <LimitFoot proposal={proposal} setting={change.kind} />
        </ProposalFrame>
      );
    case "office-instructions":
      return (
        <ProposalFrame title="Change the Office instructions">
          <ProposedOfficeInstructions text={change.to} />
          <AnswerFoot
            proposal={proposal}
            changes={[officeInstructionsQuery().queryKey]}
            appliedToast="Change applied. Sessions that start from now on get them."
            openNote={`Applies to sessions that start after it. ${STALE_NOTE}`}
          />
        </ProposalFrame>
      );
    case "initiative":
      return (
        <ProposalFrame title={INITIATIVE_EDIT_TITLES[change.edit.kind]}>
          <ProposedInitiativeEdit edit={change.edit} />
          <AnswerFoot
            proposal={proposal}
            changes={[initiativeQueries.list().queryKey, taskQueries.list().queryKey]}
            appliedToast="Change applied to the Initiative."
            openNote="Changes the Initiative once applied"
          />
        </ProposalFrame>
      );
    case "project-commands": {
      const name = projects?.find(({ id }) => id === change.projectId)?.name ?? change.projectId;
      return (
        <ProposalFrame title={`Change ${name}'s commands`}>
          <ProposedCommandChanges from={change.from} to={change.to} />
          <AnswerFoot
            proposal={proposal}
            changes={[projectQueries.list().queryKey]}
            appliedToast={`${name}'s commands changed.`}
            openNote={STALE_NOTE}
          />
        </ProposalFrame>
      );
    }
    case "pipeline": {
      const name = pipelines?.find(({ id }) => id === change.pipelineId)?.name ?? change.pipelineId;
      return (
        <ProposalFrame title={`Change the ${name} Pipeline`}>
          <ProposedStageChanges from={change.from} to={change.to} />
          <AnswerFoot
            proposal={proposal}
            changes={[pipelineQueries.list().queryKey]}
            appliedToast={`${name} changed. Tasks that haven't started follow it.`}
            openNote={STALE_NOTE}
          />
        </ProposalFrame>
      );
    }
    case "project": {
      const { project } = change;
      const pipelineName =
        pipelines?.find(({ id }) => id === project.defaultPipeline)?.name ??
        project.defaultPipeline;
      return (
        <ProposalFrame title={`Onboard ${project.name}`}>
          <dl className="proposal-fields">
            {project.repositoryUrl === undefined ? (
              <ProposedField label="Repository">{project.path}</ProposedField>
            ) : (
              <>
                <ProposedField label="Repository URL">{project.repositoryUrl}</ProposedField>
                <ProposedField label="Cloned into">{project.path}</ProposedField>
              </>
            )}
            <ProposedField label="Base branch">{project.baseBranch}</ProposedField>
            {COMMAND_KEYS.map((key) => (
              <ProposedField key={key} label={COMMAND_LABELS[key]}>
                {project.commands[key] || "None"}
              </ProposedField>
            ))}
            <ProposedField label={INSTALL_INPUTS_LABEL}>
              {installInputsLine(project.installInputs)}
            </ProposedField>
            <ProposedField label="Publishing">
              {publishingLabel(project.publishingMode, project.baseBranch)}
            </ProposedField>
            <ProposedField label="Default Pipeline">{pipelineName}</ProposedField>
          </dl>
          <AnswerFoot
            proposal={proposal}
            changes={[projectQueries.list().queryKey, taskQueries.list().queryKey]}
            appliedToast={`${project.name} added, with its Onboard Task Ready to start.`}
            openNote="Adds the Project and its Onboard Task once applied"
          />
          {change.projectId !== null && change.taskId !== null && (
            <div className="proposal-foot">
              <Link
                className="proposal-link"
                to="/projects/$projectId"
                params={{ projectId: change.projectId }}
              >
                Open {project.name}
              </Link>
              <Link
                className="proposal-link"
                to="/tasks/$taskId"
                params={{ taskId: change.taskId }}
              >
                Open the Onboard Task
              </Link>
            </div>
          )}
        </ProposalFrame>
      );
    }
    case "skill-install":
      return (
        <ProposalFrame title={`Install ${change.name}`}>
          <ProposedSkillInstallFields change={change} />
          <AnswerFoot
            proposal={proposal}
            changes={[skillQueries.list().queryKey]}
            appliedToast={`${change.name} installed. It is off until you review it.`}
            openNote="Fetched into the library once applied, off until you review it"
          />
        </ProposalFrame>
      );
    case "skill-update":
      return (
        <ProposalFrame title={`Update ${change.name}`}>
          <ProposedSkillUpdateFields change={change} />
          <AnswerFoot
            proposal={proposal}
            changes={[skillQueries.list().queryKey]}
            appliedToast={`${change.name} pinned at ${pinnedVersionLabel(change.to)}.`}
            openNote="Applying it is your review: the skill stays on or off as it is"
          />
        </ProposalFrame>
      );
    case "skill":
      return (
        <ProposalFrame title={`New skill · ${change.name}`}>
          <dl className="proposal-fields">
            <ProposedField label="Description">
              <span className="proposal-clamp">{change.description}</span>
            </ProposedField>
            <ProposedField label="Instructions">
              <span className="proposal-clamp">{change.instructions}</span>
            </ProposedField>
          </dl>
          <AnswerFoot
            proposal={proposal}
            changes={[skillQueries.list().queryKey]}
            appliedToast={`${change.name} added. It is off until you review it.`}
            openNote="Added to the library once applied, off until you review it"
          />
        </ProposalFrame>
      );
  }
}

/** These Proposals change what the user may edit by hand meanwhile, which refuses them. */
const STALE_NOTE = "Refused if it changes before you apply this";

function ProposalFrame({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="message proposal-card" aria-label={`Proposal: ${title}`}>
      <div className="proposal-head">
        <Badge tone="accent">Proposal</Badge>
        <span className="proposal-title">{title}</span>
      </div>
      {children}
    </section>
  );
}

/** The preset's card under the person's name; a preset's Role has only the skills for everyone. */
function presetCard({ card }: Preset, name: string): RoleCard {
  return { ...card, name, skills: [] };
}

/** The new Role's card, read-only, in the few lines a chat has room for. */
function ProposedCard({
  card,
  roleTitles,
}: {
  readonly card: RoleCard;
  readonly roleTitles: RoleTitles;
}): ReactNode {
  const engineName = useEngineName();
  const capabilities = CAPABILITIES.filter(({ key }) => card.capabilities[key]);
  return (
    <dl className="proposal-fields">
      <ProposedField label="Responsibilities">{card.responsibilities}</ProposedField>
      <ProposedField label="Instructions">
        <span className="proposal-clamp">{card.instructions}</span>
      </ProposedField>
      <ProposedField label="Capabilities">
        {capabilities.length > 0 ? capabilities.map(({ label }) => label).join(" · ") : "None"}
      </ProposedField>
      <ProposedField label="Task limit">{taskLimitLabel(card.taskLimit)}</ProposedField>
      <ProposedField label="Works with">
        {worksWithText(card, engineName)}
        <span className="proposal-note">
          Sessions: {SESSION_DEFAULTS[card.sessionDefault].label}
        </span>
      </ProposedField>
      <ProposedField label="Skills">
        {card.skills.length > 0 ? (
          <span className="proposal-skills">
            {card.skills.map((skill) => (
              <SkillChip key={skill} name={skill} />
            ))}
          </span>
        ) : (
          "Only the skills for everyone"
        )}
      </ProposedField>
      <ProposedField label="Permission profile">
        {permissionProfileLines(card.permissionProfile).join(" · ")}
      </ProposedField>
      <ProposedField label="Hard switches">
        {(Object.keys(HARD_SWITCH_LABELS) as (keyof typeof HARD_SWITCH_LABELS)[])
          .map(
            (key) =>
              `${HARD_SWITCH_LABELS[key]}: ${hardSwitchValueLabel(card.hardSwitches[key], roleTitles)}`,
          )
          .join(" · ")}
      </ProposedField>
    </dl>
  );
}

function ProposedField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="proposal-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Each field the change rewrites, from what the card had when drafted to what is proposed. */
function ProposedChanges({
  change,
  roleTitles,
}: {
  readonly change: ProposedRoleChange;
  readonly roleTitles: RoleTitles;
}): ReactNode {
  const names = { roleTitles, engineName: useEngineName() };
  return (
    <ul className="proposal-changes">
      {proposedFieldChanges(change.from, change.to).map(({ field, from, to }) => (
        <li key={field}>
          <span className="proposal-change-label">{fieldLabel(field)}</span>
          <span className="proposal-change-from">{fieldValueText(field, from, names)}</span>
          <Icon name="arrow-right" size={14} aria-label="to" />
          <span className="proposal-change-to">{fieldValueText(field, to, names)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The setting from its value when drafted to the one proposed. */
const INITIATIVE_EDIT_TITLES: Readonly<Record<InitiativeEdit["kind"], string>> = {
  outcome: "New outcome for the Initiative",
  "add-task": "New Task in the Initiative",
  "add-dependency": "A Task waits for another",
  "remove-dependency": "A Task stops waiting",
  "task-title": "New title for a Task",
  "task-description": "New Description for a Task",
};

/** The CTO's change to the Initiative, its Tasks and Projects by name. */
function ProposedInitiativeEdit({ edit }: { readonly edit: InitiativeEdit }): ReactNode {
  const tasks = useQuery(taskQueries.list()).data;
  const projects = useQuery(projectQueries.list()).data;
  const taskTitle = (id: string): string => tasks?.find((task) => task.id === id)?.title ?? id;
  switch (edit.kind) {
    case "outcome":
      return (
        <dl className="proposal-fields">
          <ProposedField label="Outcome">{edit.outcome}</ProposedField>
        </dl>
      );
    case "add-task":
      return (
        <dl className="proposal-fields">
          <ProposedField label="Title">{edit.title}</ProposedField>
          <ProposedField label="Project">
            {projects?.find(({ id }) => id === edit.projectId)?.name ?? edit.projectId}
          </ProposedField>
          <ProposedField label="Priority">{PRIORITY_NAMES[edit.priority]}</ProposedField>
          {edit.description !== "" && (
            <ProposedField label="Description">{edit.description}</ProposedField>
          )}
          {edit.blockedBy.length > 0 && (
            <ProposedField label="Must be Done first">
              {edit.blockedBy.map(taskTitle).join(", ")}
            </ProposedField>
          )}
        </dl>
      );
    case "add-dependency":
    case "remove-dependency":
      return (
        <dl className="proposal-fields">
          <ProposedField label="Task">{taskTitle(edit.taskId)}</ProposedField>
          <ProposedField
            label={edit.kind === "add-dependency" ? "Must be Done first" : "No longer waits for"}
          >
            {taskTitle(edit.blockerId)}
          </ProposedField>
        </dl>
      );
    case "task-title":
      return (
        <dl className="proposal-fields">
          <ProposedField label="Task">{taskTitle(edit.taskId)}</ProposedField>
          <ProposedField label="New title">{edit.title}</ProposedField>
        </dl>
      );
    case "task-description":
      return (
        <dl className="proposal-fields">
          <ProposedField label="Task">{taskTitle(edit.taskId)}</ProposedField>
          <ProposedField label="New Description">
            {edit.description === "" ? "None: the title is all there is." : edit.description}
          </ProposedField>
        </dl>
      );
  }
}

function ProposedLimit({ change }: { readonly change: ProposedLimitChange }): ReactNode {
  const { label, valueText } = OFFICE_LIMITS[change.kind];
  return (
    <ul className="proposal-changes">
      <li>
        <span className="proposal-change-label">{label}</span>
        <span className="proposal-change-from">{valueText(change.from)}</span>
        <Icon name="arrow-right" size={14} aria-label="to" />
        <span className="proposal-change-to">{valueText(change.to)}</span>
      </li>
    </ul>
  );
}

/** The text as the sessions will get it, whole: the user reads all of it before applying it. */
function ProposedOfficeInstructions({ text }: { readonly text: string }): ReactNode {
  return (
    <dl className="proposal-fields">
      <ProposedField label="New Office instructions">
        {text === "" ? (
          "None: the Office instructions would be emptied, so sessions that start after this get none."
        ) : (
          <div className="proposal-text">{text}</div>
        )}
      </ProposedField>
    </dl>
  );
}

function HireFoot({
  proposal,
  change,
}: {
  readonly proposal: Proposal;
  readonly change: ProposedHire;
}): ReactNode {
  const navigate = useNavigate();
  const showToast = useToast();
  const name = change.card.name;
  const answering = useAnswering(proposal, [roleQueries.list().queryKey], () =>
    showToast(`${personName(change)} hired.`),
  );
  const { status } = proposal;
  return (
    <div className="proposal-foot">
      {status.kind === "applied" && (
        <>
          <Badge tone="success">Hired</Badge>
          <span className="proposal-note">by you · {momentWords(status.at)}</span>
          {change.roleKey !== null && (
            <Link
              className="proposal-link"
              to="/people/$roleKey"
              params={{ roleKey: change.roleKey }}
            >
              Open {name}'s page
            </Link>
          )}
        </>
      )}
      {status.kind === "declined" && <Badge tone="neutral">Not hired</Badge>}
      {status.kind === "open" && (
        <>
          <Button
            size="sm"
            loading={answering.applying.isPending}
            disabled={answering.busy}
            onClick={() => answering.applying.mutate({})}
          >
            Hire {name}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={answering.busy}
            onClick={() => void navigate({ to: "/hire", search: { proposal: proposal.id } })}
          >
            Edit before hiring
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={answering.declining.isPending}
            disabled={answering.busy}
            onClick={() => answering.declining.mutate()}
          >
            Not now
          </Button>
          {answering.error && (
            <RefusalAlert title={`${name} can't be hired yet`} error={answering.error} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Hiring into a preset's Role: under the proposed name, or one the user gives first. A preset's Role
 * is hired on its preset's card, so the name is all there is to edit.
 */
function PresetHireFoot({
  proposal,
  change,
  title,
}: {
  readonly proposal: Proposal;
  readonly change: ProposedPresetHire;
  readonly title: string;
}): ReactNode {
  const showToast = useToast();
  const [editedName, setEditedName] = useState<string>();
  const answering = useAnswering(proposal, [roleQueries.list().queryKey], (applied) => {
    if (applied.change.kind === "hire-from-preset") {
      showToast(`${applied.change.name} · ${title} hired.`);
    }
  });
  const { status } = proposal;
  const name = editedName ?? change.name;
  return (
    <div className="proposal-foot">
      {status.kind === "applied" && (
        <>
          <Badge tone="success">Hired</Badge>
          <span className="proposal-note">by you · {momentWords(status.at)}</span>
          <Link
            className="proposal-link"
            to="/people/$roleKey"
            params={{ roleKey: change.roleKey }}
          >
            Open {change.name}'s page
          </Link>
        </>
      )}
      {status.kind === "declined" && <Badge tone="neutral">Not hired</Badge>}
      {status.kind === "open" && (
        <>
          {editedName !== undefined && (
            <div className="proposal-name">
              <Input
                size="sm"
                label="Name"
                hint="Shown with the title, as in Ada · Developer."
                value={editedName}
                onChange={(event) => setEditedName(event.target.value)}
                autoFocus
              />
            </div>
          )}
          <Button
            size="sm"
            loading={answering.applying.isPending}
            disabled={answering.busy}
            onClick={() =>
              answering.applying.mutate(editedName === undefined ? {} : { name: editedName })
            }
          >
            {name.trim() === "" ? "Hire" : `Hire ${name.trim()}`}
          </Button>
          {editedName === undefined ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={answering.busy}
              onClick={() => setEditedName(change.name)}
            >
              Edit before hiring
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={answering.busy}
              onClick={() => setEditedName(undefined)}
            >
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            loading={answering.declining.isPending}
            disabled={answering.busy}
            onClick={() => answering.declining.mutate()}
          >
            Not now
          </Button>
          {answering.error && (
            <RefusalAlert
              title={`${name.trim() || title} can't be hired yet`}
              error={answering.error}
            />
          )}
        </>
      )}
    </div>
  );
}

function ChangeFoot({
  proposal,
  personFirstName,
}: {
  readonly proposal: Proposal;
  readonly personFirstName: string;
}): ReactNode {
  return (
    <AnswerFoot
      proposal={proposal}
      changes={[roleQueries.list().queryKey]}
      appliedToast={`Change applied. ${personFirstName} works with it from the next session.`}
      appliedNote={`${personFirstName} works with it from the next session`}
      openNote={`Applies at ${personFirstName}'s next session start`}
    />
  );
}

function LimitFoot({
  proposal,
  setting,
}: {
  readonly proposal: Proposal;
  readonly setting: OfficeLimit;
}): ReactNode {
  const { appliesWhen, query } = OFFICE_LIMITS[setting];
  return (
    <AnswerFoot
      proposal={proposal}
      changes={[query().queryKey]}
      appliedToast="Change applied."
      openNote={appliesWhen}
    />
  );
}

/** "Apply change" and "Not now" on a change applied as proposed, then what became of it. */
function AnswerFoot({
  proposal,
  changes,
  appliedToast,
  appliedNote,
  openNote,
}: {
  readonly proposal: Proposal;
  /** What applying it changes, refreshed once it is applied. */
  readonly changes: readonly QueryKey[];
  readonly appliedToast: string;
  readonly appliedNote?: string;
  readonly openNote: string;
}): ReactNode {
  const showToast = useToast();
  const answering = useAnswering(proposal, changes, () => showToast(appliedToast));
  const { status } = proposal;
  return (
    <div className="proposal-foot">
      {status.kind === "applied" && (
        <>
          <Badge tone="success">Applied</Badge>
          <span className="proposal-note">
            by you · {momentWords(status.at)}
            {appliedNote && ` · ${appliedNote}`}
          </span>
        </>
      )}
      {status.kind === "declined" && <Badge tone="neutral">Not applied</Badge>}
      {status.kind === "open" && (
        <>
          <Button
            size="sm"
            loading={answering.applying.isPending}
            disabled={answering.busy}
            onClick={() => answering.applying.mutate({})}
          >
            Apply change
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={answering.declining.isPending}
            disabled={answering.busy}
            onClick={() => answering.declining.mutate()}
          >
            Not now
          </Button>
          <span className="proposal-note">{openNote}</span>
          {answering.error && (
            <RefusalAlert title="The change can't be applied yet" error={answering.error} />
          )}
        </>
      )}
    </div>
  );
}

interface ProposalAnswering {
  readonly applying: UseMutationResult<Proposal, Error, ProposalApplication>;
  readonly declining: UseMutationResult<Proposal, Error, void>;
  /** Either is on its way, so neither can be clicked. */
  readonly busy: boolean;
  readonly error: Error | null;
}

/**
 * Applying and declining the Proposal; each refreshes the Thread's log, whose message carries the
 * Proposal as it is now, and applying also what it changed (`changes`). A refusal leaves it open
 * and is shown on the card.
 */
function useAnswering(
  proposal: Proposal,
  changes: readonly QueryKey[],
  onApplied: (applied: Proposal) => void,
): ProposalAnswering {
  const queryClient = useQueryClient();
  const refreshThread = (): Promise<void> =>
    queryClient.invalidateQueries(threadQueries.messages(proposal.threadId));
  const applying = useMutation({
    mutationFn: (application: ProposalApplication) => applyProposal(proposal.id, application),
    onSuccess: async (applied) => {
      onApplied(applied);
      await Promise.all([
        refreshThread(),
        ...changes.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ]);
    },
  });
  const declining = useMutation({
    mutationFn: () => declineProposal(proposal.id),
    onSuccess: refreshThread,
  });
  return {
    applying,
    declining,
    busy: applying.isPending || declining.isPending,
    error: applying.error ?? declining.error,
  };
}

function firstName(roleKey: string, roles: readonly Role[] | undefined): string {
  return roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
}
