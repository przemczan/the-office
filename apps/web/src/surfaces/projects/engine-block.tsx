import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  effortSchema,
  type EngineKind,
  type ModelEffort,
  type Project,
  type ProjectEngineChange,
  type RoleCardOptions,
} from "@the-office/contracts";
import { Button, Dialog, Select, Switch } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { engineSettingsQuery } from "../../api/engine.ts";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { changeProjectEngine, projectQueries } from "../../api/projects.ts";
import {
  EngineTypeAccountFields,
  type EngineTypeAccount,
} from "../../shell/engine-type-account-fields.tsx";
import { EFFORT_LABELS } from "../../shell/engine-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { ENGINES_DEFAULT } from "../../shell/role-card-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useEngineName } from "../../shell/use-engine-name.ts";
import {
  ENGINES_DEFAULT_CHOICE,
  EngineGroup,
  EnginePeople,
  modelChoices,
} from "./engine-people.tsx";
import { ProjectBlock } from "./project-block.tsx";
import {
  FORCE_LABEL,
  FOR_EVERYONE,
  FOR_EVERYONE_NOTE,
  PICK_A_TYPE_FIRST,
  TURN_OFF_THE_FORCE_TOO,
  WHERE_SESSIONS_RUN,
  WHERE_SESSIONS_RUN_NOTE,
  forceNote,
  forceOnType,
  forceToast,
  personTypesOf,
  turnOffTheForceWords,
  typeChoicesOf,
  typeOfferOf,
  typeToast,
} from "./project-engine-words.ts";

/**
 * A Project's Engine card (spec §5.4.5; screens/project-page.md "Engine"): where its sessions run,
 * the model and effort forced for everyone on that engine type, and each person's own here. Each
 * group saves at once, sending only its own level; a person's settings save from their window.
 */
export function EngineBlock({ project }: { readonly project: Project }): ReactNode {
  const settings = useQuery(engineSettingsQuery());
  const options = useQuery(roleCardQueries.options());
  const roles = useQuery(roleQueries.list()).data;
  const engineName = useEngineName();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [confirming, setConfirming] = useState(false);
  const keep = (saved: Project): void => {
    queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
  };
  const choosingDefault = useMutation({
    mutationFn: (change: ProjectEngineChange) => changeProjectEngine(project.id, change),
    onSuccess: (saved) => {
      keep(saved);
      setConfirming(false);
      const picked = saved.engine.default;
      showToast(typeToast(saved.name, picked && engineName(picked.engineId)));
    },
  });
  const forcing = useMutation({
    mutationFn: (force: ModelEffort | null) => changeProjectEngine(project.id, { force }),
    onSuccess: (saved, force) => {
      keep(saved);
      const type = saved.engine.default?.engineType;
      if (type) showToast(forceToast(saved.name, type, force));
    },
  });
  const choices = typeChoicesOf(settings.data?.engines ?? []);
  const officeDefault = settings.data?.officeDefault ?? null;
  const { default: projectDefault, force } = project.engine;
  const projectType = projectDefault?.engineType ?? null;
  const saving = choosingDefault.isPending || forcing.isPending;
  const disabled = settings.data === undefined || options.data === undefined || saving;
  // A refusal says why the last change wasn't saved, so the next change clears it.
  const clearRefusals = (): void => {
    choosingDefault.reset();
    forcing.reset();
  };
  const pickDefault = (picked: EngineTypeAccount | null): void => {
    clearRefusals();
    if (picked === null) {
      if (projectDefault === null) return;
      if (force !== null) setConfirming(true);
      else choosingDefault.mutate({ default: null });
      return;
    }
    const typeChanged = picked.engineType !== projectType;
    choosingDefault.mutate(
      force !== null && typeChanged
        ? {
            default: picked,
            force: forceOnType(force, typeOfferOf(options.data, picked.engineType)),
          }
        : { default: picked },
    );
  };
  return (
    <ProjectBlock icon="cpu" title="Engine">
      <div className="project-engine">
        <EngineGroup title={WHERE_SESSIONS_RUN} note={WHERE_SESSIONS_RUN_NOTE}>
          <EngineTypeAccountFields
            name="Project default"
            officeDefault={{
              engineType: officeDefault?.engineType ?? null,
              engineName: officeDefault && engineName(officeDefault.engineId),
            }}
            value={projectDefault}
            choices={choices}
            disabled={disabled}
            onChange={pickDefault}
          />
          {choosingDefault.error && !confirming && (
            <RefusalAlert title="The engine wasn't saved" error={choosingDefault.error} />
          )}
        </EngineGroup>
        <EngineGroup title={FOR_EVERYONE} note={FOR_EVERYONE_NOTE}>
          <Switch
            checked={force !== null}
            disabled={projectType === null || disabled}
            onChange={(on) => {
              clearRefusals();
              forcing.mutate(on ? { model: null, effort: null } : null);
            }}
            label={FORCE_LABEL}
            description={projectType === null ? PICK_A_TYPE_FIRST : undefined}
          />
          {force !== null && projectType !== null && (
            <ForceFields
              type={projectType}
              force={force}
              options={options.data}
              disabled={disabled}
              onChange={(changed) => {
                clearRefusals();
                forcing.mutate(changed);
              }}
            />
          )}
          {forcing.error && <RefusalAlert title="The force wasn't saved" error={forcing.error} />}
        </EngineGroup>
        <EnginePeople
          project={project}
          types={personTypesOf(choices, projectType)}
          forced={force !== null && projectType !== null ? { type: projectType, force } : null}
          options={options.data}
          roles={roles}
          disabled={disabled}
        />
      </div>
      {confirming && (
        <Dialog
          size="small"
          title={TURN_OFF_THE_FORCE_TOO}
          onClose={() => {
            choosingDefault.reset();
            setConfirming(false);
          }}
          actions={
            <Button
              variant="primary"
              loading={choosingDefault.isPending}
              onClick={() => choosingDefault.mutate({ default: null, force: null })}
            >
              Turn off the force
            </Button>
          }
        >
          <div className="dialog-stack">
            <p className="dialog-text">{turnOffTheForceWords(project.name)}</p>
            {choosingDefault.error && (
              <RefusalAlert title="The engine wasn't saved" error={choosingDefault.error} />
            )}
          </div>
        </Dialog>
      )}
    </ProjectBlock>
  );
}

/** The forced Model and Effort, for the Project's engine type, each "Engine's default" first. */
function ForceFields({
  type,
  force,
  options,
  disabled,
  onChange,
}: {
  readonly type: EngineKind;
  readonly force: ModelEffort;
  readonly options: RoleCardOptions | undefined;
  readonly disabled: boolean;
  readonly onChange: (force: ModelEffort) => void;
}): ReactNode {
  const offer = typeOfferOf(options, type);
  return (
    <div className="project-engine-force">
      <div className="project-engine-pair">
        <Select
          label="Model"
          value={force.model ?? ENGINES_DEFAULT_CHOICE}
          options={modelChoices(offer.models, force.model)}
          disabled={disabled}
          onChange={(model) =>
            onChange({ ...force, model: model === ENGINES_DEFAULT_CHOICE ? null : model })
          }
        />
        {offer.efforts.length > 0 && (
          <Select
            label="Effort"
            value={force.effort ?? ENGINES_DEFAULT_CHOICE}
            options={[
              { value: ENGINES_DEFAULT_CHOICE, label: ENGINES_DEFAULT },
              ...offer.efforts.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] })),
            ]}
            disabled={disabled}
            onChange={(effort) =>
              onChange({ ...force, effort: effortSchema.safeParse(effort).data ?? null })
            }
          />
        )}
      </div>
      <p className="project-engine-hint">{forceNote(type)}</p>
    </div>
  );
}
