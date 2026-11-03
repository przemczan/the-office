import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EngineModel, Project, ProjectRoleOverride, Role } from "@the-office/contracts";
import { Button, Select, Switch } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import {
  changeProjectDefault,
  changeRoleOverride,
  changeUseForEveryRole,
  projectQueries,
} from "../../api/projects.ts";
import { EngineModelFields, type OfferedEngine } from "../../shell/engine-model-fields.tsx";
import { personName, roleName } from "../../shell/person-name.ts";
import { useToast } from "../../shell/toasts.tsx";
import { ProjectBlock } from "./project-block.tsx";

/**
 * The engine cascade's Project levels (spec §5.4): the Project default, "Use for every Role", and
 * the Project's Role overrides. Each change saves at once.
 */
export function EngineBlock({ project }: { readonly project: Project }): ReactNode {
  const options = useQuery(roleCardQueries.options());
  const roles = useQuery(roleQueries.list());
  const queryClient = useQueryClient();
  const showToast = useToast();
  const keep = (saved: Project): void => {
    queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
  };
  const choosingDefault = useMutation({
    mutationFn: (projectDefault: EngineModel | null) =>
      changeProjectDefault(project.id, projectDefault),
    onSuccess: (saved) => {
      keep(saved);
      showToast(
        saved.projectDefault
          ? `Project default saved for ${saved.name}.`
          : `${saved.name} has no Project default now.`,
      );
    },
  });
  const forcing = useMutation({
    mutationFn: (useForEveryRole: boolean) => changeUseForEveryRole(project.id, useForEveryRole),
    onSuccess: (saved) => {
      keep(saved);
      showToast(
        saved.useForEveryRole
          ? `Every Role in ${saved.name} runs on its Project default, past their Role overrides.`
          : `Role overrides apply in ${saved.name} again.`,
      );
    },
  });
  const overriding = useMutation({
    mutationFn: ({ roleKey, roleOverride }: RoleOverrideChange) =>
      changeRoleOverride(project.id, roleKey, roleOverride),
    onSuccess: (saved, { roleKey, roleOverride }) => {
      keep(saved);
      const name = roleName(roleKey, roles.data);
      showToast(
        roleOverride
          ? `${name} has a Role override in ${saved.name}.`
          : `${name}'s Role override in ${saved.name} is removed.`,
      );
    },
  });
  const engines = options.data?.engines ?? [];
  const saving = choosingDefault.isPending || forcing.isPending || overriding.isPending;
  const failure = choosingDefault.error ?? forcing.error ?? overriding.error ?? options.error;
  // A refusal says why the last change wasn't saved, so the next change clears it.
  const clearRefusals = (): void => {
    choosingDefault.reset();
    forcing.reset();
    overriding.reset();
  };
  return (
    <ProjectBlock
      icon="cpu"
      title="Engine"
      note="The most specific level wins: the Project's Role overrides, then the Role overrides on the Role cards, then the Project default, then the Office default."
    >
      <div className="project-engine-pair" role="group" aria-label="Project default">
        <EngineModelFields
          value={project.projectDefault}
          engines={engines}
          // Cleared only with "Use for every Role" off, which the service enforces as well.
          noneLabel={project.useForEveryRole ? undefined : "Office default"}
          disabled={options.data === undefined || saving}
          onChange={(projectDefault) => {
            clearRefusals();
            choosingDefault.mutate(projectDefault);
          }}
        />
      </div>
      <div className="project-engine-switch">
        <Switch
          checked={project.useForEveryRole}
          disabled={project.projectDefault === null || saving}
          onChange={(use) => {
            clearRefusals();
            forcing.mutate(use);
          }}
          label="Use for every Role"
          description={
            project.projectDefault === null
              ? "Pick a Project default first."
              : "The Project default wins over the Role overrides on the Role cards; the Project's Role overrides still apply."
          }
        />
      </div>
      <RoleOverrides
        overrides={project.roleOverrides}
        roles={roles.data}
        engines={engines}
        disabled={options.data === undefined || saving}
        onChange={(change) => {
          clearRefusals();
          overriding.mutate(change);
        }}
      />
      {failure && (
        <p className="project-block-error" role="alert">
          {failure.message}
        </p>
      )}
    </ProjectBlock>
  );
}

interface RoleOverrideChange {
  readonly roleKey: string;
  readonly roleOverride: EngineModel | null;
}

interface RoleOverridesProps {
  readonly overrides: readonly ProjectRoleOverride[];
  readonly roles: readonly Role[] | undefined;
  readonly engines: readonly OfferedEngine[];
  readonly disabled: boolean;
  readonly onChange: (change: RoleOverrideChange) => void;
}

function RoleOverrides({
  overrides,
  roles,
  engines,
  disabled,
  onChange,
}: RoleOverridesProps): ReactNode {
  const overridden = new Set(overrides.map(({ roleKey }) => roleKey));
  const addable = (roles ?? []).filter(
    ({ key, letGoAt }) => letGoAt === null && !overridden.has(key),
  );
  return (
    <div className="project-role-overrides">
      <h4 className="project-row-label">Role overrides in this Project</h4>
      {overrides.length > 0 && (
        <ul className="project-role-override-list" aria-label="Role overrides in this Project">
          {overrides.map(({ roleKey, engineId, model }) => (
            <li key={roleKey} className="project-role-override">
              <span className="project-role-override-name">{roleName(roleKey, roles)}</span>
              <EngineModelFields
                value={{ engineId, model }}
                engines={engines}
                disabled={disabled}
                onChange={(roleOverride) => onChange({ roleKey, roleOverride })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onChange({ roleKey, roleOverride: null })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {addable.length > 0 && engines.length > 0 && (
        <AddRoleOverride roles={addable} engines={engines} disabled={disabled} onAdd={onChange} />
      )}
    </div>
  );
}

/** A Role nobody has overridden here yet, then its engine and model, added together. */
function AddRoleOverride({
  roles,
  engines,
  disabled,
  onAdd,
}: {
  readonly roles: readonly Role[];
  readonly engines: readonly OfferedEngine[];
  readonly disabled: boolean;
  readonly onAdd: (change: RoleOverrideChange) => void;
}): ReactNode {
  const [roleKey, setRoleKey] = useState("");
  const [engineModel, setEngineModel] = useState<EngineModel | null>(null);
  const firstEngine = engines[0];
  const picked = engineModel ?? (firstEngine && defaultOf(firstEngine));
  const chosenRole = roles.find(({ key }) => key === roleKey);
  return (
    <div className="project-role-override" role="group" aria-label="Add a Role override">
      <Select
        label="Role"
        placeholder="Pick a Role"
        value={chosenRole ? roleKey : ""}
        options={roles.map((role) => ({ value: role.key, label: personName(role) }))}
        disabled={disabled}
        onChange={setRoleKey}
      />
      <EngineModelFields
        value={picked ?? null}
        engines={engines}
        disabled={disabled}
        onChange={setEngineModel}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || !chosenRole || !picked}
        onClick={() => {
          // Once saved, the Role leaves `roles`, which empties the Role field; a refusal keeps it.
          if (chosenRole && picked) onAdd({ roleKey: chosenRole.key, roleOverride: picked });
        }}
      >
        Add
      </Button>
    </div>
  );
}

function defaultOf({ engine, defaultModel }: OfferedEngine): EngineModel {
  return { engineId: engine, model: defaultModel };
}
