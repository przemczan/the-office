import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  effortSchema,
  sessionDefaultSchema,
  type HardSwitchKey,
  type HardSwitchValue,
  type Role,
  type RoleCard,
  type RoleCardEdit,
  type RoleCardOptions,
  type Skill,
  type TaskLimit,
} from "@the-office/contracts";
import {
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
import { changeRoleCard, roleCardQueries, roleQueries } from "../../api/people.ts";
import { skillQueries } from "../../api/skills.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { RoleCardGroup, RoleCardValue } from "./role-card-layout.tsx";
import {
  ASKS_YOU_UNTIL_HIRED,
  CAPABILITIES,
  EFFORT_LABELS,
  ENFORCEMENT_LABELS,
  ENGINE_LABELS,
  HARD_SWITCH_LABELS,
  hardSwitchValueLabel,
  modelLabel,
  permissionProfileLines,
  roleTitlesOf,
  SESSION_DEFAULTS,
  SHARED_MEMORY_OFF,
  type RoleTitles,
} from "./role-card-labels.ts";

/** "Edit Role": the person's whole Role card as a form, saved as its next version. */
export function RoleCardEditPage(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey/role/edit" });
  const role = useQuery(roleQueries.one(roleKey));
  const roles = useQuery(roleQueries.list());
  const options = useQuery(roleCardQueries.options());
  const library = useQuery(skillQueries.list());
  if (!role.data || !roles.data || !options.data || !library.data) return null;
  return (
    <RoleCardForm
      // A card saved elsewhere meanwhile starts the form again from it.
      key={role.data.cardVersion}
      role={role.data}
      hiredRoles={new Set(roles.data.map(({ key }) => key))}
      options={options.data}
      library={library.data}
    />
  );
}

function RoleCardForm({
  role,
  hiredRoles,
  options,
  library,
}: {
  readonly role: Role;
  readonly hiredRoles: ReadonlySet<string>;
  readonly options: RoleCardOptions;
  readonly library: readonly Skill[];
}): ReactNode {
  const formId = useId();
  const saved = editOf(role.card);
  const [draft, setDraft] = useState(saved);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const backToTheCard = (): Promise<void> =>
    navigate({ to: "/people/$roleKey/role", params: { roleKey: role.key } });
  const saving = useMutation({
    mutationFn: () => changeRoleCard(role.key, draft),
    onSuccess: async (changed) => {
      queryClient.setQueryData(roleQueries.one(changed.key).queryKey, changed);
      await queryClient.invalidateQueries(roleQueries.list());
      showToast(`Role card saved. ${changed.card.name} works with it from the next session.`);
      await backToTheCard();
    },
  });
  const change = (fields: Partial<RoleCardEdit>): void => setDraft({ ...draft, ...fields });
  const unsaved = JSON.stringify(draft) !== JSON.stringify(saved);
  const roleTitles = roleTitlesOf(options);
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
        <RefusalAlert title="The Role card can't be saved yet" error={saving.error} />
      )}
      <Card>
        <div className="role-card">
          <IdentityFields draft={draft} change={change} />
          <WorkFields draft={draft} options={options} change={change} />
          <EngineFields draft={draft} options={options} change={change} />
          <CapabilityFields draft={draft} change={change} />
          <PermissionFields
            role={role}
            draft={draft}
            options={options}
            roleTitles={roleTitles}
            hiredRoles={hiredRoles}
            change={change}
          />
          <SkillFields draft={draft} library={library} change={change} />
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
          onClick={() => void backToTheCard()}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="accent" form={formId} loading={saving.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

interface FieldsProps {
  readonly draft: RoleCardEdit;
  change(fields: Partial<RoleCardEdit>): void;
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
  const models = options.engines.find(({ engine }) => engine === draft.engine)?.models ?? [];
  return (
    <RoleCardGroup group="engine">
      <div className="role-card-form-pair">
        <Select
          label="Engine"
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
          options={models.map((model) => ({ value: model, label: modelLabel(model) }))}
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
      {CAPABILITIES.map(({ key, label, hint }) =>
        key === "sharedMemory" ? (
          <RoleCardValue key={key} label={label}>
            {SHARED_MEMORY_OFF}
          </RoleCardValue>
        ) : (
          <Switch
            key={key}
            checked={draft.capabilities[key]}
            onChange={(on) => change({ capabilities: { ...draft.capabilities, [key]: on } })}
            label={label}
            description={hint}
          />
        ),
      )}
    </RoleCardGroup>
  );
}

function PermissionFields({
  role,
  draft,
  options,
  roleTitles,
  hiredRoles,
  change,
}: FieldsProps & {
  readonly role: Role;
  readonly options: RoleCardOptions;
  readonly roleTitles: RoleTitles;
  readonly hiredRoles: ReadonlySet<string>;
}): ReactNode {
  const consultable = options.knownRoles.filter(({ key }) => key !== role.key);
  const changeSwitch = (key: HardSwitchKey, value: HardSwitchValue): void =>
    change({ hardSwitches: { ...draft.hardSwitches, [key]: value } });
  return (
    <RoleCardGroup group="permissions">
      <RoleCardValue label="Permission profile">
        {permissionProfileLines(role.card.permissionProfile).join(" · ")}
        <span className="role-card-note">Set by the preset; read-only for now.</span>
      </RoleCardValue>
      {options.hardSwitches.map(({ key, enforcement }) => {
        const value = draft.hardSwitches[key];
        const asksYou = value.kind === "consult" && !hiredRoles.has(value.role);
        const hint = asksYou
          ? `${ENFORCEMENT_LABELS[enforcement]}. ${ASKS_YOU_UNTIL_HIRED}.`
          : `${ENFORCEMENT_LABELS[enforcement]}.`;
        // An enforced call can't be held for anyone's say yet, so it stays as the preset set it.
        return enforcement === "enforced" ? (
          <RoleCardValue key={key} label={HARD_SWITCH_LABELS[key]}>
            {hardSwitchValueLabel(value, roleTitles)}
            <span className="role-card-note">{hint}</span>
          </RoleCardValue>
        ) : (
          <Select
            key={key}
            label={HARD_SWITCH_LABELS[key]}
            hint={hint}
            value={hardSwitchChoiceOf(value)}
            options={[
              { value: "allowed", label: "Allowed" },
              ...consultable.map(({ key: roleKey, title }) => ({
                value: `${CONSULT_CHOICE}${roleKey}`,
                label: `Consult ${title}`,
              })),
              { value: "ask-me", label: "Ask me" },
              { value: "never", label: "Never" },
            ]}
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
            description={skillNote(skill)}
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

/** The card as the user edits it: all but the permission profile, the skills in name order. */
function editOf({ permissionProfile: _readOnly, ...card }: RoleCard): RoleCardEdit {
  return { ...card, skills: card.skills.toSorted() };
}

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

/** A switch's value as one choice of its select: "consult:devops" for Consult Devops. */
const CONSULT_CHOICE = "consult:";

function hardSwitchChoiceOf(value: HardSwitchValue): string {
  return value.kind === "consult" ? `${CONSULT_CHOICE}${value.role}` : value.kind;
}

function hardSwitchValueOf(choice: string): HardSwitchValue {
  if (choice.startsWith(CONSULT_CHOICE)) {
    return { kind: "consult", role: choice.slice(CONSULT_CHOICE.length) };
  }
  if (choice === "allowed" || choice === "ask-me" || choice === "never") return { kind: choice };
  throw new Error(`No Hard switch value is chosen as ${choice}.`);
}
