import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  effortSchema,
  runPermissionSchema,
  sessionDefaultSchema,
  type HardSwitchKey,
  type HardSwitchValue,
  type McpServer,
  type PermissionProfile,
  type Proposal,
  type Role,
  type RoleCard,
  type RoleCardOptions,
  type Skill,
  type TaskLimit,
} from "@the-office/contracts";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  RadioGroup,
  SegmentedControl,
  Select,
  Switch,
  Textarea,
} from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { applyProposal, proposalQueries } from "../../api/conversations.ts";
import { assignMcpServer, mcpServerQueries } from "../../api/mcp-servers.ts";
import {
  changeRoleCard,
  filledRoleKeys,
  hire,
  roleCardQueries,
  roleQueries,
} from "../../api/people.ts";
import { skillQueries } from "../../api/skills.ts";
import { EFFORT_LABELS } from "../../shell/engine-words.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { personName } from "../../shell/person-name.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { blankRoleCard } from "./blank-role-card.ts";
import { RoleCardGroup } from "./role-card-layout.tsx";
import { McpServerFields } from "./role-card-mcp-server-fields.tsx";
import {
  assignedMcpServersOf,
  mcpServerAssignments,
  withoutServerToolSettings,
} from "./role-mcp-servers.ts";
import {
  ASKS_YOU_UNTIL_HIRED,
  CAPABILITIES,
  ENFORCEMENT_LABELS,
  ENGINE_LABELS,
  HARD_SWITCH_LABELS,
  hardSwitchChoiceOf,
  hardSwitchChoices,
  hardSwitchValueOf,
  missingCapabilitiesWords,
  RUN_LABELS,
  SESSION_DEFAULTS,
} from "../../shell/role-card-words.ts";
import { useModelLabel } from "../../shell/use-model-label.ts";

/** "Edit Role": the person's whole Role card as a form, saved as its next version. */
export function RoleCardEditPage(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey/role/edit" });
  const role = useQuery(roleQueries.one(roleKey));
  const roles = useQuery(roleQueries.list());
  const options = useQuery(roleCardQueries.options());
  const library = useQuery(skillQueries.list());
  const mcpServers = useQuery(mcpServerQueries.list());
  if (!role.data || !roles.data || !options.data || !library.data || !mcpServers.data) return null;
  return (
    <RoleCardForm
      // A card saved elsewhere meanwhile starts the form again from it.
      key={role.data.cardVersion}
      subject={{ kind: "role", role: role.data }}
      hiredRoles={filledRoleKeys(roles.data)}
      options={options.data}
      library={library.data}
      mcpServerLibrary={mcpServers.data}
    />
  );
}

/**
 * "Hire a Role from scratch": a blank Role card as a form; saving hires the person it names. From a
 * Proposal, "Edit the proposed Role": its card as drafted, and saving applies the Proposal with it.
 */
export function HireFromScratchPage(): ReactNode {
  const { proposal: proposalId } = useSearch({ from: "/hire" });
  usePageHeading({
    title: "People",
    parent: { label: "People", to: "/people" },
    crumb: proposalId === undefined ? "Hire a Role from scratch" : "Edit the proposed Role",
  });
  const roles = useQuery(roleQueries.list());
  const options = useQuery(roleCardQueries.options());
  const library = useQuery(skillQueries.list());
  const mcpServers = useQuery(mcpServerQueries.list());
  const proposal = useQuery({
    ...proposalQueries.one(proposalId ?? ""),
    enabled: proposalId !== undefined,
  });
  if (!roles.data || !options.data || !library.data || !mcpServers.data) return null;
  const formProps = {
    hiredRoles: filledRoleKeys(roles.data),
    options: options.data,
    library: library.data,
    mcpServerLibrary: mcpServers.data,
  };
  if (proposalId === undefined)
    return <RoleCardForm subject={{ kind: "new-role" }} {...formProps} />;
  if (proposal.error) {
    return <RefusalAlert title="The Proposal can't be read" error={proposal.error} />;
  }
  if (!proposal.data) return null;
  const { change, status } = proposal.data;
  if (change.kind !== "hire" || status.kind !== "open") {
    return (
      <Alert tone="info" title="This Proposal is no longer open">
        It was applied or declined already; its card in the chat says which.
      </Alert>
    );
  }
  return (
    <RoleCardForm
      subject={{ kind: "proposal", proposal: proposal.data, card: change.card }}
      {...formProps}
    />
  );
}

/** What the form saves: a hired Role's card, a new Role, or the new Role a Proposal drafted. */
type FormSubject =
  | { readonly kind: "role"; readonly role: Role }
  | { readonly kind: "new-role" }
  | { readonly kind: "proposal"; readonly proposal: Proposal; readonly card: RoleCard };

/** Editing the card of a hired Role, or filling one to hire a person: blank, or as proposed. */
function RoleCardForm({
  subject,
  hiredRoles,
  options,
  library,
  mcpServerLibrary,
}: {
  readonly subject: FormSubject;
  readonly hiredRoles: ReadonlySet<string>;
  readonly options: RoleCardOptions;
  readonly library: readonly Skill[];
  readonly mcpServerLibrary: readonly McpServer[];
}): ReactNode {
  const formId = useId();
  const ownRoleKey = subject.kind === "role" ? subject.role.key : undefined;
  const saved = startingCard(subject, options);
  const [draft, setDraft] = useState(saved);
  // The MCP servers module keeps them, so they are saved beside the card, not in it.
  const [assigned, setAssigned] = useState(() =>
    assignedMcpServersOf(mcpServerLibrary, ownRoleKey),
  );
  const assignmentsFor = (roleKey: string) =>
    mcpServerAssignments(mcpServerLibrary, roleKey, assigned);
  const assignServers = async (roleKey: string): Promise<void> => {
    await Promise.all(
      assignmentsFor(roleKey).map(({ name, roles }) => assignMcpServer(name, roles)),
    );
  };
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const cancel = (): Promise<void> => {
    switch (subject.kind) {
      case "role":
        return navigate({ to: "/people/$roleKey/role", params: { roleKey: subject.role.key } });
      case "new-role":
        return navigate({ to: "/people" });
      case "proposal":
        // Back to the chat the Proposal was drafted in.
        return navigate({
          to: "/people",
          search: { chat: subject.proposal.draftedBy, thread: subject.proposal.threadId },
        });
    }
  };
  const showHired = async (roleKey: string): Promise<void> => {
    showToast(`${personName({ card: draft })} hired.`);
    await Promise.all([
      navigate({ to: "/people/$roleKey", params: { roleKey } }),
      queryClient.invalidateQueries(roleQueries.list()),
    ]);
  };
  const saving = useMutation({
    mutationFn: async (): Promise<void> => {
      switch (subject.kind) {
        case "role": {
          // A card saved unchanged would add an empty version to its history.
          const changed = cardUnsaved
            ? await changeRoleCard(subject.role.key, draft)
            : subject.role;
          await assignServers(subject.role.key);
          showToast(`Role card saved. ${changed.card.name} works with it from the next session.`);
          // The Role's own query too, which carries its MCP servers.
          await queryClient.invalidateQueries(roleQueries.list());
          await cancel();
          return;
        }
        case "new-role": {
          const hired = await hire({ card: draft });
          await assignServers(hired.key);
          await showHired(hired.key);
          return;
        }
        case "proposal": {
          const { change } = await applyProposal(subject.proposal.id, { card: draft });
          if (change.kind === "hire" && change.roleKey !== null) {
            await assignServers(change.roleKey);
            await showHired(change.roleKey);
          }
          return;
        }
      }
    },
  });
  const change = (fields: Partial<RoleCard>): void => setDraft({ ...draft, ...fields });
  const assign = (serverName: string, on: boolean): void => {
    const next = new Set(assigned);
    if (on) {
      next.add(serverName);
    } else {
      next.delete(serverName);
      // The card keeps settings only for the tools of its servers.
      change({
        permissionProfile: {
          ...draft.permissionProfile,
          mcpTools: withoutServerToolSettings(draft.permissionProfile.mcpTools, serverName),
        },
      });
    }
    setAssigned(next);
  };
  const cardUnsaved = JSON.stringify(draft) !== JSON.stringify(saved);
  const unsaved =
    cardUnsaved || (ownRoleKey !== undefined && assignmentsFor(ownRoleKey).length > 0);
  const editing = subject.kind === "role";
  return (
    <form
      id={formId}
      className="role-card-form"
      onSubmit={(event) => {
        event.preventDefault();
        saving.mutate();
      }}
    >
      {saving.error && (
        <RefusalAlert
          title={editing ? "The Role card can't be saved yet" : "The person can't be hired yet"}
          error={saving.error}
        />
      )}
      <Card>
        <div className="role-card">
          <IdentityFields draft={draft} change={change} />
          <WorkFields draft={draft} options={options} change={change} />
          <EngineFields draft={draft} options={options} change={change} />
          <CapabilityFields draft={draft} change={change} />
          <PermissionFields
            ownRoleKey={ownRoleKey}
            draft={draft}
            options={options}
            hiredRoles={hiredRoles}
            change={change}
          />
          <SkillFields draft={draft} library={library} change={change} />
          <McpServerFields
            library={mcpServerLibrary}
            assigned={assigned}
            assign={assign}
            settings={draft.permissionProfile.mcpTools}
            changeSettings={(mcpTools) =>
              change({ permissionProfile: { ...draft.permissionProfile, mcpTools } })
            }
            consultable={mcpToolConsultable(options, ownRoleKey)}
            defaultSetting={options.mcpToolDefault}
          />
        </div>
      </Card>
      <div className="role-card-save-bar">
        <span className="role-card-save-bar-text">
          {unsaved
            ? "You have unsaved changes."
            : "Changes apply at the next session start: a new Thread or the next Stage."}
        </span>
        {/* The bar is inverse, as the design system's unsaved-changes bar. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          style={{ color: "var(--fg-inverse)" }}
          onClick={() => void cancel()}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="accent" form={formId} loading={saving.isPending}>
          {editing ? "Save changes" : hireLabel(draft.name)}
        </Button>
      </div>
    </form>
  );
}

function startingCard(subject: FormSubject, options: RoleCardOptions): RoleCard {
  switch (subject.kind) {
    case "role":
      return editOf(subject.role.card);
    case "new-role":
      return blankRoleCard(options);
    case "proposal":
      return subject.card;
  }
}

interface FieldsProps {
  readonly draft: RoleCard;
  change(fields: Partial<RoleCard>): void;
}

function IdentityFields({ draft, change }: FieldsProps): ReactNode {
  return (
    <RoleCardGroup group="identity">
      <div className="role-card-form-pair">
        <Input
          label="Name"
          value={draft.name}
          onChange={(event) => change({ name: event.target.value })}
        />
        <Input
          label="Title"
          value={draft.title}
          onChange={(event) => change({ title: event.target.value })}
        />
      </div>
      <Textarea
        label="Responsibilities"
        hint="One paragraph, shown on People."
        rows={3}
        value={draft.responsibilities}
        onChange={(event) => change({ responsibilities: event.target.value })}
      />
    </RoleCardGroup>
  );
}

function WorkFields({
  draft,
  options,
  change,
}: FieldsProps & { readonly options: RoleCardOptions }): ReactNode {
  return (
    <RoleCardGroup group="work">
      <Textarea
        label="Instructions"
        hint="What the Agent works from, with its authority as plain rules. Every session carries them, so keep them short."
        rows={10}
        value={draft.instructions}
        onChange={(event) => change({ instructions: event.target.value })}
      />
      <Select
        label="Task limit"
        hint="Agents on Stages at once. None means no Pipeline may name the Role."
        value={String(draft.taskLimit)}
        options={taskLimitOptions(options)}
        onChange={(value) => change({ taskLimit: taskLimitOf(value) })}
      />
      <Field
        label="Session default"
        hint="What a Thread does once its cache has cooled, an hour after the last call. A Stage's own choice still wins at a Stage boundary."
      >
        <RadioGroup
          value={draft.sessionDefault}
          options={sessionDefaultSchema.options.map((choice) => ({
            value: choice,
            ...SESSION_DEFAULTS[choice],
          }))}
          onChange={(choice) => change({ sessionDefault: sessionDefaultSchema.parse(choice) })}
        />
      </Field>
    </RoleCardGroup>
  );
}

function EngineFields({
  draft,
  options,
  change,
}: FieldsProps & { readonly options: RoleCardOptions }): ReactNode {
  const modelLabel = useModelLabel();
  const picked = options.engines.find(({ engine }) => engine === draft.engine);
  return (
    <RoleCardGroup group="engine">
      <div className="role-card-form-pair">
        <Select
          label="Engine"
          hint={picked && missingCapabilitiesWords(picked.missingCapabilities)}
          value={draft.engine}
          options={options.engines.map(({ engine }) => ({
            value: engine,
            label: ENGINE_LABELS[engine],
          }))}
          onChange={(value) => {
            const engine = options.engines.find((offered) => offered.engine === value);
            if (!engine) return;
            change({
              engine: engine.engine,
              // Another engine offers other models.
              model: engine.models.includes(draft.model) ? draft.model : (engine.models[0] ?? ""),
            });
          }}
        />
        <Select
          label="Model"
          value={draft.model}
          options={(picked?.models ?? []).map((model) => ({
            value: model,
            label: modelLabel(model),
          }))}
          onChange={(model) => change({ model })}
        />
      </div>
      <Field label="Effort" hint="How hard the model thinks.">
        <SegmentedControl
          value={draft.effort}
          options={effortSchema.options.map((effort) => ({
            value: effort,
            label: EFFORT_LABELS[effort],
          }))}
          onChange={(effort) => change({ effort: effortSchema.parse(effort) })}
        />
      </Field>
    </RoleCardGroup>
  );
}

function CapabilityFields({ draft, change }: FieldsProps): ReactNode {
  return (
    <RoleCardGroup group="capabilities">
      {CAPABILITIES.map(({ key, label, hint }) => (
        <Switch
          key={key}
          checked={draft.capabilities[key]}
          onChange={(on) => change({ capabilities: { ...draft.capabilities, [key]: on } })}
          label={label}
          description={hint}
        />
      ))}
    </RoleCardGroup>
  );
}

function PermissionFields({
  ownRoleKey,
  draft,
  options,
  hiredRoles,
  change,
}: FieldsProps & {
  /** Undefined while the Role is yet to be hired. */
  readonly ownRoleKey: string | undefined;
  readonly options: RoleCardOptions;
  readonly hiredRoles: ReadonlySet<string>;
}): ReactNode {
  const consultable = options.knownRoles.filter(({ key }) => key !== ownRoleKey);
  const changeSwitch = (key: HardSwitchKey, value: HardSwitchValue): void =>
    change({ hardSwitches: { ...draft.hardSwitches, [key]: value } });
  const changeProfile = (fields: Partial<PermissionProfile>): void =>
    change({ permissionProfile: { ...draft.permissionProfile, ...fields } });
  return (
    <RoleCardGroup group="permissions">
      <Field
        label="Permission profile"
        hint="What the Agent may do in a Stage. A Stage may narrow it, never widen it. Read-only git is always allowed."
      >
        <div className="role-card-profile">
          <Switch
            checked={draft.permissionProfile.edit}
            onChange={(edit) => changeProfile({ edit })}
            label="Edits files in its worktree"
          />
          <Select
            label="Runs"
            value={draft.permissionProfile.run}
            options={runPermissionSchema.options.map((run) => ({
              value: run,
              label: RUN_LABELS[run],
            }))}
            onChange={(run) => changeProfile({ run: runPermissionSchema.parse(run) })}
          />
          <Switch
            checked={draft.permissionProfile.web}
            onChange={(web) => changeProfile({ web })}
            label="Searches and fetches the web"
          />
        </div>
      </Field>
      {options.hardSwitches.map(({ key, enforcement }) => {
        const value = draft.hardSwitches[key];
        const asksYou = value.kind === "consult" && !hiredRoles.has(value.role);
        const hint = asksYou
          ? `${ENFORCEMENT_LABELS[enforcement]}. ${ASKS_YOU_UNTIL_HIRED}.`
          : `${ENFORCEMENT_LABELS[enforcement]}.`;
        return (
          <Select
            key={key}
            label={HARD_SWITCH_LABELS[key]}
            hint={hint}
            value={hardSwitchChoiceOf(value)}
            options={hardSwitchChoices(consultable)}
            onChange={(choice) => changeSwitch(key, hardSwitchValueOf(choice))}
          />
        );
      })}
    </RoleCardGroup>
  );
}

function SkillFields({
  draft,
  library,
  change,
}: FieldsProps & { readonly library: readonly Skill[] }): ReactNode {
  const toggle = (name: string, on: boolean): void => {
    const skills = new Set(draft.skills);
    if (on) skills.add(name);
    else skills.delete(name);
    change({ skills: [...skills].toSorted() });
  };
  if (library.length === 0) {
    return (
      <RoleCardGroup group="skills">
        <p className="role-card-empty">The library has no skills yet. Add one in Settings.</p>
      </RoleCardGroup>
    );
  }
  return (
    <RoleCardGroup group="skills">
      <div className="role-card-skill-picker">
        {library.map((skill) => (
          <Checkbox
            key={skill.name}
            checked={skill.everyone || draft.skills.includes(skill.name)}
            disabled={skill.everyone}
            onChange={(on) => toggle(skill.name, on)}
            label={skill.name}
            description={<span className="role-card-skill-note">{skillNote(skill)}</span>}
          />
        ))}
      </div>
    </RoleCardGroup>
  );
}

/** Why a skill shows as it does, and whether a session gets it. */
function skillNote(skill: Skill): string {
  if (skill.everyone) return "For everyone";
  if (skill.state === "waiting-for-review") return "Off until you review it";
  if (skill.state === "off") return "Off: no session gets it until it is on";
  return skill.description;
}

/**
 * The Roles an MCP tool may consult: any but the card's own, which only the default may name (what
 * Devops' own person would consult goes to the user).
 */
function mcpToolConsultable(
  { knownRoles, mcpToolDefault }: RoleCardOptions,
  ownRoleKey: string | undefined,
): RoleCardOptions["knownRoles"] {
  const defaultRole = mcpToolDefault.kind === "consult" ? mcpToolDefault.role : undefined;
  return knownRoles.filter(({ key }) => key !== ownRoleKey || key === defaultRole);
}

/** The card as the user edits it, with the skills in name order. */
function editOf(card: RoleCard): RoleCard {
  return { ...card, skills: card.skills.toSorted() };
}

const hireLabel = (name: string): string =>
  name.trim() === "" ? "Hire the Role" : `Hire ${name.trim()}`;

function taskLimitOptions({ taskLimits }: RoleCardOptions): { value: string; label: string }[] {
  const numbers = Array.from(
    { length: taskLimits.highest - taskLimits.lowest + 1 },
    (_, index) => taskLimits.lowest + index,
  );
  return [
    { value: "none", label: "None: talks only" },
    ...numbers.map((limit) => ({ value: String(limit), label: `${limit} at once` })),
  ];
}

function taskLimitOf(value: string): TaskLimit {
  return value === "none" ? "none" : Number(value);
}
