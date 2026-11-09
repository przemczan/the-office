import type { ProjectEnvironment } from "../../domain/project-environment.js";

/** A Project's environment as its jsonb holds it: one saved before Secret variables has no flag. */
export interface StoredEnvironment {
  readonly set: readonly {
    readonly name: string;
    readonly value: string;
    readonly secret?: boolean;
  }[];
  readonly unset: readonly string[];
  readonly prependPath: readonly string[];
}

export function environmentOfStored(stored: StoredEnvironment): ProjectEnvironment {
  return {
    set: stored.set.map(({ name, value, secret }) => ({ name, value, secret: secret === true })),
    unset: stored.unset,
    prependPath: stored.prependPath,
  };
}
