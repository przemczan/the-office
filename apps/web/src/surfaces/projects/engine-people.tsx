import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  effortSchema,
  type EngineKind,
  type EngineTypeSetting,
  type ModelEffort,
  type Project,
  type ProjectEnginePerson,
  type Role,
  type RoleCardOptions,
} from "@the-office/contracts";
import { Button, DataTable, Dialog, Icon, Select } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { changeProjectEngine, projectQueries } from "../../api/projects.ts";
import {
  EFFORT_LABELS,
  ENGINE_KIND_ICONS,
  ENGINE_KIND_LABELS,
  modelLabel,
  noLongerOfferedModelLabel,
} from "../../shell/engine-words.ts";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { personName } from "../../shell/person-name.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { ENGINES_DEFAULT, takesEffort } from "../../shell/role-card-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import {
  EVERYONE_HAS_A_ROW,
  FORCED_ABOVE,
  NOBODY_HAS_A_SETTING,
  PERSONS_SETTING,
  PER_PERSON,
  PER_PERSON_NOTE,
  REMOVE_WINDOW_TEXT,
  addWindowTitle,
  addedToast,
  editWindowTitle,
  forcedAboveHint,
  mergedSettings,
  nothingIsSetHint,
  peopleWith,
  removeWindowTitle,
  removedToast,
  roleCardHint,
  savedToast,
  setsAnything,
  typeOfferOf,
} from "./project-engine-words.ts";

/** A Model or Effort field's first choice, "Engine's default" or "Person's setting": nothing set. */
export const ENGINES_DEFAULT_CHOICE = "";

/**
 * A Model field's choices: `first` ("Engine's default" or "Person's setting"), then the type's
 * models; one saved that the type no longer offers stays, marked, until it is changed.
 */
export function modelChoices(
  models: readonly string[],
  saved: string | null,
  first: string = ENGINES_DEFAULT,
): { value: string; label: string }[] {
  return [
    { value: ENGINES_DEFAULT_CHOICE, label: first },
    ...models.map((model) => ({ value: model, label: modelLabel(model) })),
    ...(saved !== null && !models.includes(saved)
      ? [{ value: saved, label: noLongerOfferedModelLabel(saved) }]
      : []),
  ];
}

/** One group of the Engine card: its title and one-line description, then its controls. */
export function EngineGroup({
  title,
  note,
  children,
}: {
  readonly title: string;
  readonly note: string;
  readonly children: ReactNode;
}): ReactNode {
  const titleId = useId();
  return (
    <section className="project-engine-group" aria-labelledby={titleId}>
      <div className="project-engine-group-head">
        <h4 id={titleId} className="project-engine-group-title">
          {title}
        </h4>
        <p className="project-engine-hint">{note}</p>
      </div>
      {children}
    </section>
  );
}

/** The Project's force, on its engine type, while it is on. */
export interface Forced {
  readonly type: EngineKind;
  readonly force: ModelEffort;
}

/** Which window is open: Add, or Edit or Remove for one person. */
type Opened =
  { readonly kind: "add" } | { readonly kind: "edit" | "remove"; readonly roleKey: string };

/**
 * The Project's model and effort per person: a row per person with a setting here, a column per
 * engine type with an engine listed, the forced type's dimmed; Add, Edit and Remove in windows.
 */
export function EnginePeople({
  project,
  types,
  forced,
  options,
  roles,
  disabled,
}: {
  readonly project: Project;
  /** The engine types with an engine listed, the Project's own first. */
  readonly types: readonly EngineKind[];
  readonly forced: Forced | null;
  readonly options: RoleCardOptions | undefined;
  readonly roles: readonly Role[] | undefined;
  readonly disabled: boolean;
}): ReactNode {
  const [opened, setOpened] = useState<Opened | null>(null);
  const people = project.engine.people;
  const withRow = new Set(people.map(({ roleKey }) => roleKey));
  const addable = (roles ?? []).filter(({ key, letGoAt }) => letGoAt === null && !withRow.has(key));
  const nameOf = (roleKey: string): string => {
    const role = roles?.find(({ key }) => key === roleKey);
    return role ? personName(role) : roleKey;
  };
  const firstNameOf = (roleKey: string): string =>
    roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
  const columns = [
    {
      key: "person",
      header: "Person",
      render: ({ roleKey }: ProjectEnginePerson) => (
        <span className="project-engine-person">
          <PersonAvatar roleKey={roleKey} name={firstNameOf(roleKey)} size="sm" />
          {nameOf(roleKey)}
        </span>
      ),
    },
    ...types.map((type) => {
      const dimmed = forced?.type === type;
      return {
        key: type,
        header: (
          <span className={dimmed ? "project-engine-type forced" : "project-engine-type"}>
            <Icon name={ENGINE_KIND_ICONS[type]} size={14} />
            {ENGINE_KIND_LABELS[type]}
            {dimmed && <span className="project-engine-forced-above">{FORCED_ABOVE}</span>}
          </span>
        ),
        render: ({ engineSettings }: ProjectEnginePerson) => (
          <span className={dimmed ? "project-engine-cell forced" : "project-engine-cell"}>
            <SettingCell type={type} setting={engineSettings[type]} />
          </span>
        ),
      };
    }),
    {
      key: "edit",
      header: <span className="visually-hidden">Edit</span>,
      align: "right" as const,
      render: ({ roleKey }: ProjectEnginePerson) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Edit ${firstNameOf(roleKey)}`}
          disabled={disabled}
          onClick={() => setOpened({ kind: "edit", roleKey })}
        >
          Edit
        </Button>
      ),
    },
    {
      key: "remove",
      header: <span className="visually-hidden">Remove</span>,
      align: "right" as const,
      render: ({ roleKey }: ProjectEnginePerson) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove ${firstNameOf(roleKey)}`}
          disabled={disabled}
          onClick={() => setOpened({ kind: "remove", roleKey })}
        >
          Remove
        </Button>
      ),
    },
  ];
  const everyoneHasARow = roles !== undefined && addable.length === 0;
  return (
    <EngineGroup title={PER_PERSON} note={PER_PERSON_NOTE}>
      {people.length === 0 ? (
        <p className="project-engine-empty">{NOBODY_HAS_A_SETTING}</p>
      ) : (
        <div className="project-engine-people">
          <DataTable columns={columns} rows={[...people]} rowKey="roleKey" density="compact" />
        </div>
      )}
      <div className="project-engine-add">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          iconLeft={<Icon name="plus" size={14} />}
          disabled={disabled || roles === undefined || everyoneHasARow}
          onClick={() => setOpened({ kind: "add" })}
        >
          Add a person
        </Button>
        {everyoneHasARow && <span className="project-engine-hint">{EVERYONE_HAS_A_ROW}</span>}
      </div>
      {opened?.kind === "remove" && (
        <RemovePersonDialog
          project={project}
          roleKey={opened.roleKey}
          person={firstNameOf(opened.roleKey)}
          onClose={() => setOpened(null)}
        />
      )}
      {(opened?.kind === "add" || opened?.kind === "edit") && (
        <PersonSettingsDialog
          project={project}
          types={types}
          forced={forced}
          options={options}
          roles={roles}
          addable={addable}
          editing={opened.kind === "edit" ? opened.roleKey : null}
          onClose={() => setOpened(null)}
        />
      )}
    </EngineGroup>
  );
}

/** "<model> · <effort>", each part left unset reading "Person's setting" in muted text. */
function SettingCell({
  type,
  setting,
}: {
  readonly type: EngineKind;
  readonly setting: EngineTypeSetting | undefined;
}): ReactNode {
  if (!setsAnything(setting))
    return <span className="project-engine-muted">{PERSONS_SETTING}</span>;
  const unset = <span className="project-engine-muted">{PERSONS_SETTING}</span>;
  const model = setting?.model ? modelLabel(setting.model) : unset;
  if (!takesEffort(type)) return model;
  return (
    <>
      {model} · {setting?.effort ? EFFORT_LABELS[setting.effort] : unset}
    </>
  );
}

/** The Project as it is now, so a save sends the people whole with every other change kept. */
function useLatestProject(project: Project): () => Project {
  const queryClient = useQueryClient();
  return () => queryClient.getQueryData(projectQueries.one(project.id).queryKey) ?? project;
}

/** Asks before taking a person's settings out of the Project. */
function RemovePersonDialog({
  project,
  roleKey,
  person,
  onClose,
}: {
  readonly project: Project;
  readonly roleKey: string;
  readonly person: string;
  readonly onClose: () => void;
}): ReactNode {
  const showToast = useToast();
  const latest = useLatestProject(project);
  const queryClient = useQueryClient();
  const removing = useMutation({
    mutationFn: () =>
      changeProjectEngine(project.id, { people: peopleWith(latest().engine, roleKey, null) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      showToast(removedToast(person, saved.name));
      onClose();
    },
  });
  return (
    <Dialog
      size="small"
      title={removeWindowTitle(person, project.name)}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={removing.isPending} onClick={() => removing.mutate()}>
          Remove
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">{REMOVE_WINDOW_TEXT}</p>
        {removing.error && <RefusalAlert title="Nothing was removed" error={removing.error} />}
      </div>
    </Dialog>
  );
}

/** What the window shows for each engine type it lists. */
type Draft = Partial<Record<EngineKind, EngineTypeSetting>>;

/**
 * Add a person, or Edit one: a Person picker (Add only), then a Model and an Effort for each engine
 * type with an engine listed, each "Person's setting" first, hinting what the Role card sets.
 */
function PersonSettingsDialog({
  project,
  types,
  forced,
  options,
  roles,
  addable,
  editing,
  onClose,
}: {
  readonly project: Project;
  readonly types: readonly EngineKind[];
  readonly forced: Forced | null;
  readonly options: RoleCardOptions | undefined;
  readonly roles: readonly Role[] | undefined;
  readonly addable: readonly Role[];
  /** The person being edited; null to add one. */
  readonly editing: string | null;
  readonly onClose: () => void;
}): ReactNode {
  const showToast = useToast();
  const stored =
    project.engine.people.find(({ roleKey }) => roleKey === editing)?.engineSettings ?? {};
  const [picked, setPicked] = useState(editing ?? "");
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(types.map((type) => [type, stored[type] ?? { model: null, effort: null }])),
  );
  const role = roles?.find(({ key }) => key === picked);
  const person = role?.card.name ?? picked;
  const latest = useLatestProject(project);
  const queryClient = useQueryClient();
  const saving = useMutation({
    mutationFn: ({ roleKey, engineSettings }: ProjectEnginePerson) =>
      changeProjectEngine(project.id, {
        people: peopleWith(latest().engine, roleKey, engineSettings),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      showToast(editing === null ? addedToast(person, saved.name) : savedToast(person, saved.name));
      onClose();
    },
  });
  const settings = mergedSettings(stored, draft);
  // A setting kept for a type with no engine listed counts: the person still has one, so Save
  // stays on and nothing points at Remove, which would drop it.
  const setsSomething = Object.values(settings).some(setsAnything);
  const change = (type: EngineKind, setting: EngineTypeSetting): void => {
    saving.reset();
    setDraft((before) => ({ ...before, [type]: setting }));
  };
  return (
    <Dialog
      size="medium"
      title={
        editing === null ? addWindowTitle(project.name) : editWindowTitle(person, project.name)
      }
      onClose={onClose}
      actions={
        <Button
          variant="primary"
          loading={saving.isPending}
          disabled={picked === "" || !setsSomething}
          onClick={() => saving.mutate({ roleKey: picked, engineSettings: settings })}
        >
          {editing === null ? "Add" : "Save"}
        </Button>
      }
    >
      <div className="dialog-stack">
        {editing === null && (
          <Select
            label="Person"
            placeholder="Pick a person"
            value={addable.some(({ key }) => key === picked) ? picked : ""}
            options={addable.map((addableRole) => ({
              value: addableRole.key,
              label: personName(addableRole),
            }))}
            disabled={saving.isPending}
            onChange={(key) => {
              saving.reset();
              setPicked(key);
            }}
          />
        )}
        {types.map((type) => (
          <TypeFields
            key={type}
            type={type}
            setting={draft[type] ?? { model: null, effort: null }}
            roleCard={role && (role.card.engineSettings[type] ?? null)}
            forced={forced?.type === type ? forced.force : null}
            options={options}
            disabled={saving.isPending}
            onChange={(setting) => change(type, setting)}
          />
        ))}
        {editing !== null && !setsSomething && (
          <p className="project-engine-hint">{nothingIsSetHint(person)}</p>
        )}
        {saving.error && <RefusalAlert title="The settings weren't saved" error={saving.error} />}
      </div>
    </Dialog>
  );
}

/** One engine type's Model and Effort in the window, dimmed while the force is on its type. */
function TypeFields({
  type,
  setting,
  roleCard,
  forced,
  options,
  disabled,
  onChange,
}: {
  readonly type: EngineKind;
  readonly setting: EngineTypeSetting;
  /** What the person's Role card sets for the type; undefined until a person is picked. */
  readonly roleCard: EngineTypeSetting | null | undefined;
  readonly forced: ModelEffort | null;
  readonly options: RoleCardOptions | undefined;
  readonly disabled: boolean;
  readonly onChange: (setting: EngineTypeSetting) => void;
}): ReactNode {
  const offer = typeOfferOf(options, type);
  return (
    <div
      className={forced ? "project-engine-type-row forced" : "project-engine-type-row"}
      role="group"
      aria-label={ENGINE_KIND_LABELS[type]}
    >
      <div className="project-engine-type-row-head">
        <span className="project-engine-type">
          <Icon name={ENGINE_KIND_ICONS[type]} size={14} />
          {ENGINE_KIND_LABELS[type]}
        </span>
        {roleCard !== undefined && (
          <span className="project-engine-hint">{roleCardHint(type, roleCard ?? undefined)}</span>
        )}
      </div>
      {forced && <p className="project-engine-hint">{forcedAboveHint(type, forced)}</p>}
      <div className="project-engine-pair">
        <Select
          label="Model"
          value={setting.model ?? ENGINES_DEFAULT_CHOICE}
          options={modelChoices(offer.models, setting.model, PERSONS_SETTING)}
          disabled={disabled}
          onChange={(model) =>
            onChange({ ...setting, model: model === ENGINES_DEFAULT_CHOICE ? null : model })
          }
        />
        {offer.efforts.length > 0 && (
          <Select
            label="Effort"
            value={setting.effort ?? ENGINES_DEFAULT_CHOICE}
            options={[
              { value: ENGINES_DEFAULT_CHOICE, label: PERSONS_SETTING },
              ...offer.efforts.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] })),
            ]}
            disabled={disabled}
            onChange={(effort) =>
              onChange({ ...setting, effort: effortSchema.safeParse(effort).data ?? null })
            }
          />
        )}
      </div>
    </div>
  );
}
