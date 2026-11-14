import type { DutyKey } from "./duties.js";

/** Keys named by where sessions run: in every Project and outside any, or in one Project alone. */
export interface NamedWhere<Key extends string> {
  readonly everywhere: ReadonlySet<Key>;
  /** By Project id. */
  readonly byProject: ReadonlyMap<string, ReadonlySet<Key>>;
}

/**
 * The Roles Agent Stages name, by where their sessions run (spec §5.4): the library's in every
 * Project and outside any, an open Task's own Stages' only in its Task's Project. The duties they
 * name are kept apart until `withDutiesResolved` puts each holder's Role among the Roles.
 */
export interface PipelineRolesNamed extends NamedWhere<string> {
  readonly duties?: NamedWhere<DutyKey>;
}

export const NO_PIPELINE_ROLES: PipelineRolesNamed = {
  everywhere: new Set(),
  byProject: new Map(),
};

/**
 * The Roles named with each named duty's holder among them, where the duty is named; a duty
 * nobody holds names no Role (spec §2.3).
 */
export function withDutiesResolved(
  named: PipelineRolesNamed,
  holders: ReadonlyMap<DutyKey, string>,
): PipelineRolesNamed {
  const roles = { everywhere: named.everywhere, byProject: named.byProject };
  if (!named.duties) return roles;
  const held = (duties: ReadonlySet<DutyKey>): ReadonlySet<string> =>
    new Set([...duties].flatMap((duty) => holders.get(duty) ?? []));
  return mergedRolesNamed(roles, {
    everywhere: held(named.duties.everywhere),
    byProject: new Map(
      [...named.duties.byProject].map(([projectId, duties]) => [projectId, held(duties)]),
    ),
  });
}

/** Whether Agent Stages name the duty anywhere. */
export function dutyNamedAnywhere(named: PipelineRolesNamed, duty: DutyKey): boolean {
  const duties = named.duties;
  if (!duties) return false;
  return (
    duties.everywhere.has(duty) || [...duties.byProject.values()].some((keys) => keys.has(duty))
  );
}

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

/** Keys named by Stages whose sessions run in the Project, or anywhere (undefined). */
export function namedWhere<Key extends string>(
  keys: Iterable<Key>,
  projectId: string | undefined,
): NamedWhere<Key> {
  const named = new Set(keys);
  return projectId === undefined
    ? { everywhere: named, byProject: new Map() }
    : { everywhere: new Set(), byProject: new Map([[projectId, named]]) };
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
  const roles = mergedNamed(one, other);
  if (!one.duties && !other.duties) return roles;
  const none: NamedWhere<DutyKey> = { everywhere: new Set(), byProject: new Map() };
  return { ...roles, duties: mergedNamed(one.duties ?? none, other.duties ?? none) };
}

function mergedNamed<Key extends string>(
  one: NamedWhere<Key>,
  other: NamedWhere<Key>,
): NamedWhere<Key> {
  const byProject = new Map<string, ReadonlySet<Key>>(one.byProject);
  for (const [projectId, keys] of other.byProject) {
    byProject.set(projectId, new Set([...(byProject.get(projectId) ?? []), ...keys]));
  }
  return { everywhere: new Set([...one.everywhere, ...other.everywhere]), byProject };
}
