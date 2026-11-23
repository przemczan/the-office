import { useQuery, type QueryKey } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  dutyKeySchema,
  type Duty,
  type DutyHolders,
  type Preset,
  type ProjectPipelineBreak,
  type Proposal,
  type ProposalStatus,
  type ProposedChange,
  type ProposedFeatureSwitch,
  type Role,
  type RoleCard,
} from "@the-office/contracts";
import { Alert, Badge, Button, Icon, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { actionQueries } from "../../api/actions.ts";
import { officeInstructionsQuery, sizeThresholdQuery } from "../../api/conversations.ts";
import { dutyQueries, roleCardQueries, roleQueries } from "../../api/people.ts";
import { fallbackWords, holderNameOf } from "../duty-words.ts";
import {
  pipelineQueries,
  projectPipelineQueries,
  stageTemplateQueries,
} from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { whoWorks } from "../pipelines/pipeline-words.ts";
import { skillQueries } from "../../api/skills.ts";
import {
  initiativeQueries,
  officeWideLimitQuery,
  taskQueries,
  useEveryTask,
} from "../../api/work.ts";
import { useChatLandingProposal } from "../chat/use-chat.tsx";
import { useEngineName } from "../use-engine-name.ts";
import { personName, roleName } from "../person-name.ts";
import {
  INSTALL_INPUTS_LABEL,
  INSTALL_LABEL,
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
  worksWithLines,
} from "../role-card-words.ts";
import { SkillChip } from "../skill-chip.tsx";
import { pinnedVersionLabel } from "../skill-words.ts";
import { momentWords } from "../time.ts";
import { PRIORITY_NAMES } from "../work/work-words.ts";
import { useToast } from "../toasts.tsx";
import { useUserName } from "../use-user-name.ts";
import { tokensShort } from "./context-words.ts";
import {
  commandWords,
  ProposedCommandChanges,
  ProposedProjectPipelineFields,
  ProposedSkillInstallFields,
  ProposedSkillUpdateFields,
  ProposedStageChanges,
  ProposedStageFieldChanges,
  ProposedActionChanges,
  ProposedTestTargetChanges,
} from "./devops-proposal-changes.tsx";
import { officeSetupApplyLabel, ProposedOfficeSetup } from "./office-setup-changes.tsx";
import { checkRequest } from "./project-pipeline-check.ts";
import { ShowOnFlowButton, showsOnFlow } from "./proposal-on-flow.tsx";
import { ProposedFlow, ProposedRouteChanges } from "./proposed-route-changes.tsx";
import { useAnswering } from "./use-answering.ts";
import "./conversation.css";

type ProposedHire = Extract<ProposedChange, { kind: "hire" }>;
type ProposedPresetHire = Extract<ProposedChange, { kind: "hire-from-preset" }>;
type ProposedRoleChange = Extract<ProposedChange, { kind: "change" }>;
type ProposedDutiesChange = Extract<ProposedChange, { kind: "duties" }>;
type ProposedLimitChange = Extract<ProposedChange, { kind: OfficeLimit }>;
type ProposedPipelineChange = Extract<ProposedChange, { kind: "pipeline" }>;
type ProposedProjectPipeline = Extract<ProposedChange, { kind: "project-pipeline" }>;
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
 * the user gives), a change to a Role's card, a new value for an Office setting, a change to an
 * Initiative by whoever shapes Initiatives, the Caretaker's set-up of The Office (hires and duties
 * together), or by whoever onboards Projects a change to a Project's commands or test targets, a
 * library Pipeline's Stages, a Project Pipeline (new or changed) or a Stage template's Stage, a
 * Project to onboard, a skill to install from a Source or its update, or a written skill drafted
 * in a chat.
 * Nothing changes until the user applies it; "Not now" declines it.
 */
export function ProposalCard({ proposal }: { readonly proposal: Proposal }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const duties = useQuery(dutyQueries.list()).data;
  const options = useQuery(roleCardQueries.options()).data;
  const presets = useQuery(roleCardQueries.presets()).data;
  const projects = useQuery(projectQueries.list()).data;
  const pipelines = useQuery(pipelineQueries.list()).data;
  const stageTemplates = useQuery(stageTemplateQueries.list()).data;
  const roleTitles: RoleTitles = new Map(options?.knownRoles.map(({ key, title }) => [key, title]));
  const { change } = proposal;
  switch (change.kind) {
    case "hire":
      return (
        <ProposalFrame
          proposalId={proposal.id}
          title={`New Role · ${change.card.name} · ${change.card.title}`}
        >
          <ProposedCard card={change.card} roleTitles={roleTitles} />
          <HireFoot proposal={proposal} change={change} />
        </ProposalFrame>
      );
    case "hire-from-preset": {
      const preset = presets?.find(({ roleKey }) => roleKey === change.roleKey);
      const title = preset?.card.title ?? change.roleKey;
      return (
        <ProposalFrame proposalId={proposal.id} title={`New Role · ${change.name} · ${title}`}>
          {preset && (
            <ProposedCard card={presetCard(preset, change.name)} roleTitles={roleTitles} />
          )}
          <PresetHireFoot proposal={proposal} change={change} title={title} />
        </ProposalFrame>
      );
    }
    case "change":
      return (
        <ProposalFrame proposalId={proposal.id} title={`Change ${roleName(change.roleKey, roles)}`}>
          <ProposedChanges change={change} roleTitles={roleTitles} />
          <ChangeFoot proposal={proposal} personFirstName={firstName(change.roleKey, roles)} />
        </ProposalFrame>
      );
    case "office-wide-limit":
    case "size-threshold":
      return (
        <ProposalFrame proposalId={proposal.id} title={OFFICE_LIMITS[change.kind].title}>
          <ProposedLimit change={change} />
          <LimitFoot proposal={proposal} setting={change.kind} />
        </ProposalFrame>
      );
    case "office-instructions":
      return (
        <ProposalFrame proposalId={proposal.id} title="Change the Office instructions">
          <ProposedOfficeInstructions text={change.to} />
          <AnswerFoot
            proposal={proposal}
            changes={[officeInstructionsQuery().queryKey]}
            appliedToast="Change applied. Sessions that start from now on get them."
            openNote={`Applies to sessions that start after it. ${STALE_NOTE}`}
          />
        </ProposalFrame>
      );
    case "prompt-template":
      return (
        <ProposalFrame
          proposalId={proposal.id}
          title={
            change.to === null
              ? `Reset ${change.name} to its default`
              : `Change the prompt template · ${change.name}`
          }
        >
          <ProposedPromptTemplate text={change.to} />
          <AnswerFoot
            proposal={proposal}
            changes={[["settings", "prompt-templates"]]}
            appliedToast={
              change.to === null
                ? "Prompt template reset to its default."
                : "Prompt template changed."
            }
            openNote={`Applies to prompts rendered after it. ${STALE_NOTE}`}
          />
        </ProposalFrame>
      );
    case "duties":
      return (
        <ProposalFrame proposalId={proposal.id} title="Change duties">
          <ProposedDuties change={change} roles={roles} />
          <AnswerFoot
            proposal={proposal}
            changes={[dutyQueries.list().queryKey]}
            appliedToast="Duties changed."
            openNote={`Applies to what starts after it. ${STALE_NOTE}`}
          />
        </ProposalFrame>
      );
    case "office-setup":
      return (
        <ProposalFrame proposalId={proposal.id} title="Set up The Office">
          <ProposedOfficeSetup change={change} presets={presets} roles={roles} />
          <AnswerFoot
            proposal={proposal}
            changes={[roleQueries.list().queryKey, dutyQueries.list().queryKey]}
            appliedToast="The Office is set up."
            openNote="Hires everyone and assigns the duties together, or nothing"
            applyLabel={officeSetupApplyLabel(change)}
          />
        </ProposalFrame>
      );
    case "initiative":
      return (
        <ProposalFrame proposalId={proposal.id} title={INITIATIVE_EDIT_TITLES[change.edit.kind]}>
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
        <ProposalFrame proposalId={proposal.id} title={`Change ${name}'s commands`}>
          <ProposedCommandChanges changes={change.changes} />
          <AnswerFoot
            proposal={proposal}
            changes={[projectQueries.list().queryKey]}
            appliedToast={`${name}'s commands changed.`}
            openNote={STALE_NOTE}
          />
        </ProposalFrame>
      );
    }
    case "test-targets": {
      const name = projects?.find(({ id }) => id === change.projectId)?.name ?? change.projectId;
      return (
        <ProposalFrame proposalId={proposal.id} title={`Change ${name}'s test targets`}>
          <ProposedTestTargetChanges changes={change.changes} />
          <AnswerFoot
            proposal={proposal}
            changes={[projectQueries.testTargets(change.projectId).queryKey]}
            appliedToast={`${name}'s test targets changed.`}
            openNote={`All or nothing. ${STALE_NOTE}`}
            applyLabel="Apply"
            declineLabel="Dismiss"
          />
        </ProposalFrame>
      );
    }
    case "actions": {
      const name = projects?.find(({ id }) => id === change.projectId)?.name ?? change.projectId;
      return (
        <ProposalFrame proposalId={proposal.id} title={`Change ${name}'s Actions`}>
          <ProposedActionChanges changes={change.changes} />
          <AnswerFoot
            proposal={proposal}
            changes={[actionQueries.list(change.projectId).queryKey]}
            appliedToast={`${name}'s Actions changed.`}
            openNote={`All or nothing. ${STALE_NOTE}`}
            applyLabel="Apply"
            declineLabel="Dismiss"
          />
        </ProposalFrame>
      );
    }
    case "pipeline":
      return (
        <PipelineProposal proposal={proposal} change={change} roles={roles ?? []} duties={duties} />
      );
    case "project-pipeline":
      return (
        <ProjectPipelineProposal
          proposal={proposal}
          change={change}
          roles={roles ?? []}
          duties={duties}
        />
      );
    case "stage-template": {
      const name =
        stageTemplates?.find(({ id }) => id === change.templateId)?.stage.name ?? change.from.name;
      return (
        <ProposalFrame proposalId={proposal.id} title={`Change the ${name} Stage template`}>
          <ProposedStageFieldChanges
            from={change.from}
            to={change.to}
            roles={roles ?? []}
            duties={duties}
          />
          <AnswerFoot
            proposal={proposal}
            changes={[stageTemplateQueries.list().queryKey]}
            appliedToast={`${name} changed. Pipelines and Tasks it was added to keep their copy.`}
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
        <ProposalFrame proposalId={proposal.id} title={`Onboard ${project.name}`}>
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
            <ProposedField label={INSTALL_LABEL}>{project.installCommand || "None"}</ProposedField>
            {project.commands.map((command) => (
              <ProposedField key={command.key} label={`${command.name} (${command.key})`}>
                {commandWords(command)}
              </ProposedField>
            ))}
            <ProposedField label={INSTALL_INPUTS_LABEL}>
              {installInputsLine(project.installInputs)}
            </ProposedField>
            <ProposedField label="Publishing">
              {publishingLabel(project.publishingMode, project.baseBranch)}
            </ProposedField>
            <ProposedField label="Default Pipeline">{pipelineName}</ProposedField>
            {change.features.map(({ feature, on, reason }) => (
              <ProposedField key={feature} label={PROPOSED_FEATURE_NAMES[feature]}>
                <span className="proposal-feature">
                  <Badge tone={on ? "success" : "neutral"}>{on ? "On" : "Off"}</Badge>
                  <span>{reason}</span>
                </span>
              </ProposedField>
            ))}
          </dl>
          <AnswerFoot
            proposal={proposal}
            changes={[projectQueries.list().queryKey, taskQueries.list().queryKey]}
            appliedToast={`${project.name} added. Its Onboard Task started at once.`}
            openNote="Adds the Project and starts its Onboard Task at once."
          />
          {change.projectId !== null && (
            <div className="proposal-foot">
              <span>
                Added {project.name}. Its Onboard Task started at once:{" "}
                <Link
                  className="proposal-link"
                  to="/projects/$projectId"
                  params={{ projectId: change.projectId }}
                >
                  follow it on the Project page
                </Link>
                .
              </span>
            </div>
          )}
        </ProposalFrame>
      );
    }
    case "skill-install":
      return (
        <ProposalFrame proposalId={proposal.id} title={`Install ${change.name}`}>
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
        <ProposalFrame proposalId={proposal.id} title={`Update ${change.name}`}>
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
        <ProposalFrame proposalId={proposal.id} title={`New skill · ${change.name}`}>
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

/**
 * New Stages for a library Pipeline, and while it is open the Project Pipelines built from it that
 * they would leave Broken, each with its Project and why: applying still applies.
 */
function PipelineProposal({
  proposal,
  change,
  roles,
  duties,
}: {
  readonly proposal: Proposal;
  readonly change: ProposedPipelineChange;
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[] | undefined;
}): ReactNode {
  const pipeline = useQuery(pipelineQueries.list()).data?.find(
    ({ id }) => id === change.pipelineId,
  );
  const open = proposal.status.kind === "open";
  const check = useQuery({
    ...pipelineQueries.libraryCheck({
      name: pipeline?.name ?? "",
      description: pipeline?.description ?? "",
      stages: change.to,
      pipelineId: change.pipelineId,
    }),
    enabled: open && pipeline !== undefined,
  }).data;
  const breaks = open ? (check?.breaks ?? []) : [];
  const name = pipeline?.name ?? change.pipelineId;
  return (
    <ProposalFrame proposalId={proposal.id} title={`Change the ${name} Pipeline`}>
      <ProposedStageChanges from={change.from} to={change.to} />
      {change.routes && (
        <>
          <ProposedRouteChanges routes={change.routes} was={change.from} proposed={change.to} />
          <ProposedFlow
            title={`${name}, as proposed`}
            stages={change.to}
            routes={change.routes}
            whoWorks={(stage) => whoWorks(stage, roles, undefined, duties)}
            action={showsOnFlow(proposal) && <ShowOnFlowButton proposal={proposal} />}
          />
        </>
      )}
      {breaks.length > 0 && <ProjectPipelineBreaks breaks={breaks} />}
      <AnswerFoot
        proposal={proposal}
        changes={[pipelineQueries.list().queryKey]}
        appliedToast={`${name} changed. Tasks that haven't started follow it.`}
        openNote={STALE_NOTE}
        applyLabel={breaks.length > 0 ? "Apply anyway" : undefined}
      />
    </ProposalFrame>
  );
}

/** The Project Pipelines a Proposal of their base Pipeline's Stages would leave Broken, and why. */
function ProjectPipelineBreaks({
  breaks,
}: {
  readonly breaks: readonly ProjectPipelineBreak[];
}): ReactNode {
  const count = breaks.length === 1 ? "1 Project Pipeline" : `${breaks.length} Project Pipelines`;
  return (
    <div className="proposal-section">
      <Alert tone="warning" title={`Applying this breaks ${count}`}>
        <div className="proposal-breaks">
          {breaks.map(({ projectPipelineId, projectName, name, reasons }) => (
            <p key={projectPipelineId}>
              <b>
                {projectName} › {name}
              </b>
              : {reasons.map(({ text }) => text).join(" ")}
            </p>
          ))}
          <p>Each is Broken until its Stage changes are fixed.</p>
        </div>
      </Alert>
    </div>
  );
}

/**
 * A new Project Pipeline of a Project, or a change to one, as the adopted design words it, with the
 * Stages the Project gets built by the service's check. It never sets the Project's default.
 */
function ProjectPipelineProposal({
  proposal,
  change,
  roles,
  duties,
}: {
  readonly proposal: Proposal;
  readonly change: ProposedProjectPipeline;
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[] | undefined;
}): ReactNode {
  const projectName =
    useQuery(projectQueries.list()).data?.find(({ id }) => id === change.projectId)?.name ??
    change.projectId;
  const pipelines = useQuery(pipelineQueries.list()).data;
  const pipelineName = (pipelineId: string): string =>
    pipelines?.find(({ id }) => id === pipelineId)?.name ?? pipelineId;
  const proposed = useQuery(projectPipelineQueries.check(checkRequest(change, change.to))).data;
  const was = useQuery({
    ...projectPipelineQueries.check(checkRequest(change, change.from ?? change.to)),
    enabled: change.from !== null,
  }).data;
  const { from, to } = change;
  return (
    <ProposalFrame
      proposalId={proposal.id}
      title={
        from === null
          ? `Add ${to.name} to ${projectName}'s Pipelines`
          : `Change ${projectName}'s ${from.name}`
      }
    >
      <ProposedProjectPipelineFields
        change={change}
        projectName={projectName}
        pipelineName={pipelineName}
        was={was}
        proposed={proposed}
        roles={roles}
        duties={duties}
      />
      {change.routes && proposed && change.routes.stages.length > 0 && (
        <ProposedFlow
          title={`${to.name}, as proposed`}
          stages={proposed.stages}
          routes={change.routes}
          whoWorks={(stage) => whoWorks(stage, roles, undefined, duties)}
          action={showsOnFlow(proposal) && <ShowOnFlowButton proposal={proposal} />}
        />
      )}
      <AnswerFoot
        proposal={proposal}
        changes={[pipelineQueries.list().queryKey]}
        appliedToast={
          from === null
            ? `${to.name} added to ${projectName}'s Pipelines.`
            : `${to.name} saved. Tasks that haven't started follow it.`
        }
        openNote={STALE_NOTE}
      />
    </ProposalFrame>
  );
}

/** These Proposals change what the user may edit by hand meanwhile, which refuses them. */
const STALE_NOTE = "Refused if it changes before you apply this";

/**
 * The card a Proposal's link opened its Thread at, from Needs you's Waiting for you, is marked: a
 * Task's or an Initiative's page names it in the address, the chat drawer in its place.
 */
function ProposalFrame({
  proposalId,
  title,
  children,
}: {
  readonly proposalId: string;
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  const inAddress = useSearch({ strict: false }).proposal;
  const inChat = useChatLandingProposal();
  const linkedTo = inAddress === proposalId || inChat === proposalId;
  return (
    <section
      className={`message proposal-card${linkedTo ? " linked-to" : ""}`}
      aria-label={`Proposal: ${title}`}
      aria-current={linkedTo || undefined}
    >
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
        {worksWithLines(card).join("; ")}
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

/** The feature switches a Project to onboard is proposed with, by their names in the UI. */
const PROPOSED_FEATURE_NAMES: Readonly<Record<ProposedFeatureSwitch["feature"], string>> = {
  "connected-devices": "Connected devices",
  "test-targets": "Test targets",
  "github-issues": "GitHub issues",
};

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
  pipeline: "Another Pipeline for the Initiative",
};

/**
 * The change to the Initiative proposed by whoever shapes Initiatives, its Tasks and Projects by
 * name.
 */
function ProposedInitiativeEdit({ edit }: { readonly edit: InitiativeEdit }): ReactNode {
  const tasks = useEveryTask().data;
  const projects = useQuery(projectQueries.list()).data;
  const pipelines = useQuery(pipelineQueries.list()).data;
  // An Initiative's Pipeline in a Project may be that Project's own Project Pipeline.
  const projectPipelines = useQuery({
    ...projectPipelineQueries.list(edit.kind === "pipeline" ? edit.projectId : ""),
    enabled: edit.kind === "pipeline",
  }).data;
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
    case "pipeline":
      return (
        <dl className="proposal-fields">
          <ProposedField label="Project">
            {projects?.find(({ id }) => id === edit.projectId)?.name ?? edit.projectId}
          </ProposedField>
          <ProposedField label="Initiative's Pipeline">
            {edit.pipelineId === null
              ? "None"
              : ([...(pipelines ?? []), ...(projectPipelines ?? [])].find(
                  ({ id }) => id === edit.pipelineId,
                )?.name ?? edit.pipelineId)}
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

/** Each duty's holder as it was when drafted and as proposed, in the duties' order. */
function ProposedDuties({
  change,
  roles,
}: {
  readonly change: ProposedDutiesChange;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const duties = useQuery(dutyQueries.list()).data;
  return (
    <ul className="proposal-changes">
      {dutyKeySchema.options
        .filter((key) => key in change.to)
        .map((key) => {
          const to = holderOf(change.to, key);
          return (
            <li key={key}>
              <span className="proposal-change-label">{dutyLabel(key, duties)}</span>
              <span className="proposal-change-from">
                {holderNameOf(holderOf(change.from, key), roles)}
              </span>
              <Icon name="arrow-right" size={14} aria-label="to" />
              <span className="proposal-change-to">{holderNameOf(to, roles)}</span>
              {to === null && <span className="proposal-note">{fallbackWords(key)}</span>}
            </li>
          );
        })}
    </ul>
  );
}

function holderOf(holders: DutyHolders, key: Duty["key"]): string | null {
  return holders[key] ?? null;
}

function dutyLabel(key: Duty["key"], duties: readonly Duty[] | undefined): string {
  return duties?.find((duty) => duty.key === key)?.label ?? key;
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

/** The new text whole, as the prompts will be rendered from it; `null` is back to the default. */
function ProposedPromptTemplate({ text }: { readonly text: string | null }): ReactNode {
  return (
    <dl className="proposal-fields">
      <ProposedField label="New text">
        {text === null ? (
          "Back to the default that ships with The Office"
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
          <AnsweredNote status={status} />
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
      {status.kind === "declined" && (
        <>
          <Badge tone="neutral">Not hired</Badge>
          <AnsweredNote status={status} />
        </>
      )}
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
 * Hiring into a preset's Role: under the proposed name, or one the user gives first. A preset's
 * Role is hired on its preset's card, so the name is all there is to edit.
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
          <AnsweredNote status={status} />
          <Link
            className="proposal-link"
            to="/people/$roleKey"
            params={{ roleKey: change.roleKey }}
          >
            Open {change.name}'s page
          </Link>
        </>
      )}
      {status.kind === "declined" && (
        <>
          <Badge tone="neutral">Not hired</Badge>
          <AnsweredNote status={status} />
        </>
      )}
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
  applyLabel = "Apply change",
  declineLabel = "Not now",
}: {
  readonly proposal: Proposal;
  /** What applying it changes, refreshed once it is applied. */
  readonly changes: readonly QueryKey[];
  readonly appliedToast: string;
  readonly appliedNote?: string;
  readonly openNote: string;
  readonly applyLabel?: string | undefined;
  readonly declineLabel?: string;
}): ReactNode {
  const showToast = useToast();
  const answering = useAnswering(proposal, changes, () => showToast(appliedToast));
  const { status } = proposal;
  return (
    <div className="proposal-foot">
      {status.kind === "applied" && (
        <>
          <Badge tone="success">Applied</Badge>
          <AnsweredNote status={status} more={appliedNote} />
        </>
      )}
      {status.kind === "declined" && (
        <>
          <Badge tone="neutral">Not applied</Badge>
          <AnsweredNote status={status} />
        </>
      )}
      {status.kind === "open" && (
        <>
          <Button
            size="sm"
            loading={answering.applying.isPending}
            disabled={answering.busy}
            onClick={() => answering.applying.mutate({})}
          >
            {applyLabel}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={answering.declining.isPending}
            disabled={answering.busy}
            onClick={() => answering.declining.mutate()}
          >
            {declineLabel}
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

/** Who applied or declined it, "by you" or "by Ann Lee", and when; then `more`, if any. */
function AnsweredNote({
  status,
  more,
}: {
  readonly status: Extract<ProposalStatus, { kind: "applied" | "declined" }>;
  readonly more?: string | undefined;
}): ReactNode {
  const nameOfUser = useUserName();
  return (
    <span className="proposal-note">
      by {nameOfUser(status.by, "you")} · {momentWords(status.at)}
      {more && ` · ${more}`}
    </span>
  );
}

function firstName(roleKey: string, roles: readonly Role[] | undefined): string {
  return roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
}
