import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  CHANGE_ROLE_CARD_ACTION,
  HIRE_ROLE_ACTION,
  effortSchema,
  hiredRoleKeyOf,
  runPermissionSchema,
  sessionDefaultSchema,
  type EngineKind,
  type EngineTypeSetting,
  type AuthorityInEffect,
  type McpServer,
  type PermissionProfile,
  type Proposal,
  type Role,
  type RoleCard,
  type RoleCardOptions,
  type SavedRoleCard,
  type Skill,
  type TaskLimit,
} from "@the-office/contracts";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Field,
  Icon,
  Input,
  RadioGroup,
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
import { SkillCommandClash } from "../../shell/commands/command-notes.tsx";
import {
  EFFORT_LABELS,
  ENGINE_KIND_ICONS,
  modelLabel,
  noLongerOfferedModelLabel,
} from "../../shell/engine-words.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { personName } from "../../shell/person-name.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { blankRoleCard } from "./blank-role-card.ts";
import { AuthorityFields } from "./role-card-authority.tsx";
import { engineTypeRows, noEngineListedWords, type EngineTypeRow } from "./engine-type-rows.ts";
import { FixedForTheCaretaker, RoleCardGroup } from "./role-card-layout.tsx";
import { McpServerFields } from "./role-card-mcp-server-fields.tsx";
import {
  assignedMcpServersOf,
  mcpServerAssignments,
  withoutServerToolSettings,
} from "./role-mcp-servers.ts";
import {
  CAPABILITIES,
  ENGINES_DEFAULT,
  RUN_LABELS,
  SESSION_DEFAULTS,
} from "../../shell/role-card-words.ts";

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
  const proposed = proposal.data?.change;
  // A change to a card edits that Role's card, whose preset gives each row's default.
  const changedRoleKey =
    proposed?.kind === "office-action" && proposed.action === CHANGE_ROLE_CARD_ACTION.name
      ? proposed.subject.id
      : undefined;
  const changedRole = useQuery({
    ...roleQueries.one(changedRoleKey ?? ""),
    enabled: changedRoleKey !== undefined,
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
  if (change.kind === "office-action" && change.editableCard && status.kind === "open") {
    if (changedRoleKey === undefined) {
      return (
        <RoleCardForm
          subject={{
            kind: "proposal",
            proposal: proposal.data,
            card: change.editableCard,
            action: HIRE_ROLE_ACTION.name,
          }}
          {...formProps}
        />
      );
    }
    if (changedRole.error) {
      return <RefusalAlert title="The Role can't be read" error={changedRole.error} />;
    }
    if (!changedRole.data) return null;
    return (
      <RoleCardForm
        subject={{
          kind: "proposal",
          proposal: proposal.data,
          card: change.editableCard,
          action: CHANGE_ROLE_CARD_ACTION.name,
          role: changedRole.data,
        }}
        {...formProps}
      />
    );
  }
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
  | {
      readonly kind: "proposal";
      readonly proposal: Proposal;
      readonly card: SavedRoleCard;
      /** The Office action it calls, when it is one; else the hire of a new Role. */
      readonly action?: string;
      /** The Role a `change_role_card` Proposal changes. */
      readonly role?: Role;
    };

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
  const ownRoleKey = subject.kind === "proposal" ? subject.role?.key : roleOf(subject)?.key;
  const saved = startingCard(subject, options);
  // What each Authority row stands at when the card leaves it out: its preset's, or from scratch's.
  const authorityDefaults = defaultAuthorityOf(subject, options);
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
          if (change.kind === "office-action") {
            if (subject.action === CHANGE_ROLE_CARD_ACTION.name && subject.role) {
              await assignServers(subject.role.key);
              showToast(`Role card saved. ${draft.name} works with it from the next session.`);
              await queryClient.invalidateQueries(roleQueries.list());
              await navigate({ to: "/people/$roleKey", params: { roleKey: subject.role.key } });
            } else {
              const hiredKey = hiredRoleKeyOf({ card: draft });
              await assignServers(hiredKey);
              await showHired(hiredKey);
            }
          } else if (change.kind === "hire" && change.roleKey !== null) {
            await assignServers(change.roleKey);
            await showHired(change.roleKey);
          }
          return;
        }
      }
    },
  });
  const change = (fields: Partial<SavedRoleCard>): void => setDraft({ ...draft, ...fields });
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
  const editing = subject.kind === "role" || (subject.kind === "proposal" && !!subject.role);
  // The Caretaker's capabilities, permission profile, Authority and Task limit are fixed.
  const fixed = subject.kind === "role" && subject.role.builtIn;
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
          <WorkFields draft={draft} options={options} fixed={fixed} change={change} />
          <EngineFields draft={draft} options={options} change={change} />
          <CapabilityFields draft={draft} fixed={fixed} change={change} />
          <PermissionFields draft={draft} fixed={fixed} change={change} />
          <AuthorityFields
            draft={draft}
            defaults={authorityDefaults}
            options={options}
            ownRoleKey={ownRoleKey}
            hiredRoles={hiredRoles}
            fixed={fixed}
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

function startingCard(subject: FormSubject, options: RoleCardOptions): SavedRoleCard {
  switch (subject.kind) {
    case "role":
      return editOf(subject.role.card);
    case "new-role":
      return blankRoleCard(options);
    case "proposal":
      return subject.card;
  }
}

/** Where each Authority row starts: a hired Role's preset defaults, else a Role from scratch's. */
function defaultAuthorityOf(subject: FormSubject, options: RoleCardOptions): AuthorityInEffect {
  const role = roleOf(subject);
  return role ? role.presetAuthority : options.fromScratchAuthority;
}

/** The hired Role whose card the form edits, when it does. */
function roleOf(subject: FormSubject): Role | undefined {
  if (subject.kind === "role") return subject.role;
  return subject.kind === "proposal" ? subject.role : undefined;
}

interface FieldsProps {
  readonly draft: RoleCard;
  change(fields: Partial<RoleCard>): void;
}

/** The built-in Caretaker's card, whose fixed fields show but don't change. */
interface FixedProps {
  readonly fixed: boolean;
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
  fixed,
  change,
}: FieldsProps & FixedProps & { readonly options: RoleCardOptions }): ReactNode {
  return (
    <RoleCardGroup group="work">
      <Textarea
        label="Instructions"
        hint="What the Agent works from: the job's guidance. What it may do is its Authority. Every session carries them, so keep them short."
        rows={10}
        value={draft.instructions}
        onChange={(event) => change({ instructions: event.target.value })}
      />
      <Select
        label="Task limit"
        hint="Agents on Stages at once. None means no Pipeline may name the Role."
        value={String(draft.taskLimit)}
        options={taskLimitOptions(options)}
        disabled={fixed}
        onChange={(value) => change({ taskLimit: taskLimitOf(value) })}
      />
      {fixed && <FixedForTheCaretaker />}
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

/** The Engine choices' "Engine's default": nothing set at the person's level. */
const ENGINES_DEFAULT_CHOICE = "";

export function EngineFields({
  draft,
  options,
  change,
}: FieldsProps & { readonly options: RoleCardOptions }): ReactNode {
  const changeType = (type: EngineKind, setting: EngineTypeSetting | undefined): void => {
    const others = Object.entries(draft.engineSettings).filter(([other]) => other !== type);
    const unset = setting === undefined || (setting.model === null && setting.effort === null);
    change({
      engineSettings: Object.fromEntries(unset ? others : [...others, [type, setting]]),
    });
  };
  const name = draft.name.trim() === "" ? "them" : draft.name;
  return (
    <RoleCardGroup group="engine">
      <Field
        label="Model and effort for each engine type"
        hint={`Used on whichever account of the type a session lands on, and on a Stand-in Engine of that type. A Project can set its own for ${name}.`}
      >
        <div className="role-card-engine-types">
          {engineTypeRows(options, draft.engineSettings).map((row) => (
            <EngineTypeFields
              key={row.type}
              row={row}
              onChange={(setting) => changeType(row.type, setting)}
            />
          ))}
        </div>
      </Field>
    </RoleCardGroup>
  );
}

/** One engine type's Model and Effort; a type with no engine listed can only be cleared. */
function EngineTypeFields({
  row,
  onChange,
}: {
  readonly row: EngineTypeRow;
  readonly onChange: (setting: EngineTypeSetting | undefined) => void;
}): ReactNode {
  const setting = row.setting ?? { model: null, effort: null };
  const offered = row.models.some(({ model }) => model === setting.model);
  const modelChoices = [
    { value: ENGINES_DEFAULT_CHOICE, label: ENGINES_DEFAULT },
    ...row.models.map(({ model, onEveryAccount }) => ({
      value: model,
      label: onEveryAccount ? modelLabel(model) : `${modelLabel(model)} · Not on every account`,
    })),
    // A model the type no longer offers stays as the card names it, marked, until it is changed.
    ...(setting.model !== null && !offered
      ? [{ value: setting.model, label: noLongerOfferedModelLabel(setting.model) }]
      : []),
  ];
  return (
    <div className="role-card-engine-type" role="group" aria-label={row.label}>
      <div className="role-card-engine-type-name">
        <Icon name={ENGINE_KIND_ICONS[row.type]} size={14} />
        <span>{row.label}</span>
        {!row.listed && (
          <>
            <span className="role-card-note">{noEngineListedWords(row.type)}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(undefined)}>
              Clear
            </Button>
          </>
        )}
      </div>
      <div className="role-card-form-pair">
        <Select
          label="Model"
          value={setting.model ?? ENGINES_DEFAULT_CHOICE}
          options={modelChoices}
          onChange={(model) =>
            onChange({ ...setting, model: model === ENGINES_DEFAULT_CHOICE ? null : model })
          }
        />
        {row.efforts.length > 0 && (
          <Select
            label="Effort"
            value={setting.effort ?? ENGINES_DEFAULT_CHOICE}
            options={[
              { value: ENGINES_DEFAULT_CHOICE, label: ENGINES_DEFAULT },
              ...row.efforts.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] })),
            ]}
            onChange={(effort) =>
              onChange({ ...setting, effort: effortSchema.safeParse(effort).data ?? null })
            }
          />
        )}
      </div>
    </div>
  );
}

function CapabilityFields({ draft, fixed, change }: FieldsProps & FixedProps): ReactNode {
  return (
    <RoleCardGroup group="capabilities">
      {CAPABILITIES.map(({ key, label, hint }) => (
        <Switch
          key={key}
          checked={draft.capabilities[key]}
          disabled={fixed}
          onChange={(on) => change({ capabilities: { ...draft.capabilities, [key]: on } })}
          label={label}
          description={hint}
        />
      ))}
      {fixed && <FixedForTheCaretaker />}
    </RoleCardGroup>
  );
}

function PermissionFields({ draft, fixed, change }: FieldsProps & FixedProps): ReactNode {
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
            disabled={fixed}
            onChange={(edit) => changeProfile({ edit })}
            label="Edits files in its worktree"
          />
          <Select
            label="Runs"
            value={draft.permissionProfile.run}
            disabled={fixed}
            options={runPermissionSchema.options.map((run) => ({
              value: run,
              label: RUN_LABELS[run],
            }))}
            onChange={(run) => changeProfile({ run: runPermissionSchema.parse(run) })}
          />
          <Switch
            checked={draft.permissionProfile.web}
            disabled={fixed}
            onChange={(web) => changeProfile({ web })}
            label="Searches and fetches the web"
          />
        </div>
      </Field>
      {fixed && <FixedForTheCaretaker />}
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
            description={
              <>
                <span className="role-card-skill-note">{skillNote(skill)}</span>
                <SkillCommandClash skillName={skill.name} />
              </>
            }
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
function editOf(card: SavedRoleCard): SavedRoleCard {
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
