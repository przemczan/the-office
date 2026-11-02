/**
 * The Roles Agent Stages name, by where their sessions run (spec §5.4): the library's in every
 * Project and outside any, an open Task's own Stages' only in its Task's Project.
 */
export interface PipelineRolesNamed {
  readonly everywhere: ReadonlySet<string>;
  /** By Project id. */
  readonly byProject: ReadonlyMap<string, ReadonlySet<string>>;
}

export const NO_PIPELINE_ROLES: PipelineRolesNamed = {
  everywhere: new Set(),
  byProject: new Map(),
};

/** The Roles named where sessions run in the Project, or outside any Project (undefined). */
export function rolesNamedIn(
  named: PipelineRolesNamed,
  projectId: string | undefined,
): ReadonlySet<string> {
  const inProject = projectId === undefined ? undefined : named.byProject.get(projectId);
  return inProject ? new Set([...named.everywhere, ...inProject]) : named.everywhere;
}

/** Every Role named, wherever its sessions run. */
export function rolesNamedAnywhere(named: PipelineRolesNamed): ReadonlySet<string> {
  return new Set([
    ...named.everywhere,
    ...[...named.byProject.values()].flatMap((roleKeys) => [...roleKeys]),
  ]);
}

/** Roles named by Stages whose sessions run in the Project, or anywhere (undefined). */
export function rolesNamedWhere(
  roleKeys: Iterable<string>,
  projectId: string | undefined,
): PipelineRolesNamed {
  const roles = new Set(roleKeys);
  return projectId === undefined
    ? { everywhere: roles, byProject: new Map() }
    : { everywhere: new Set(), byProject: new Map([[projectId, roles]]) };
}

/** Only the given Role, wherever it is named. */
export function onlyRole(named: PipelineRolesNamed, roleKey: string): PipelineRolesNamed {
  const only = (roleKeys: ReadonlySet<string>) =>
    new Set([...roleKeys].filter((key) => key === roleKey));
  return {
    everywhere: only(named.everywhere),
    byProject: new Map([...named.byProject].map(([projectId, keys]) => [projectId, only(keys)])),
  };
}

export function mergedRolesNamed(
  one: PipelineRolesNamed,
  other: PipelineRolesNamed,
): PipelineRolesNamed {
  const byProject = new Map<string, ReadonlySet<string>>(one.byProject);
  for (const [projectId, roleKeys] of other.byProject) {
    byProject.set(projectId, new Set([...(byProject.get(projectId) ?? []), ...roleKeys]));
  }
  return { everywhere: new Set([...one.everywhere, ...other.everywhere]), byProject };
}
