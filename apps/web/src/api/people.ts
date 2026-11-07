import { queryOptions } from "@tanstack/react-query";
import {
  API_PATH,
  memoryNoteSchema,
  memorySchema,
  presetListSchema,
  roleCardOptionsSchema,
  roleChangeListSchema,
  roleEngineCascadeSchema,
  roleListSchema,
  roleSchema,
  type Hire,
  type MemoryNote,
  type MemoryNoteDraft,
  type Role,
  type RoleCard,
  type RoleWebEvent,
} from "@the-office/contracts";
import {
  deleteFromApi,
  deleteFromApiReturning,
  getFromApi,
  sendFileToApi,
  sendToApi,
} from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const ROLES = ["roles"] as const;
/** Apart from ROLES, since Projects and the Office default change it too. */
export const ENGINE_CASCADE = ["engine-cascade"] as const;

export const roleQueries = {
  /** Every Role someone fills, in hiring order. */
  list: () =>
    queryOptions({
      queryKey: ROLES,
      queryFn: ({ signal }) => getFromApi("/roles", roleListSchema, signal),
    }),
  one: (key: string) =>
    queryOptions({
      queryKey: [...ROLES, key],
      queryFn: ({ signal }) => getFromApi(rolePath(key), roleSchema, signal),
    }),
  /** The Role's change history, newest first, ending with the hire. */
  changes: (key: string) =>
    queryOptions({
      queryKey: [...ROLES, key, "changes"],
      queryFn: ({ signal }) => getFromApi(`${rolePath(key)}/changes`, roleChangeListSchema, signal),
    }),
  /** The person's Memory, newest note first. */
  memory: (key: string) =>
    queryOptions({
      queryKey: [...ROLES, key, "memory"],
      queryFn: ({ signal }) => getFromApi(memoryPath(key), memorySchema, signal),
    }),
  /** What the Role runs on outside any Project, and the Projects where something else applies. */
  engineCascade: (key: string) =>
    queryOptions({
      queryKey: [...ENGINE_CASCADE, key],
      queryFn: ({ signal }) =>
        getFromApi(`${rolePath(key)}/engine-cascade`, roleEngineCascadeSchema, signal),
    }),
};

/**
 * What hiring and the Role card form offer. The presets don't change while the service runs; the
 * options change only when Settings › Engines is saved, which refreshes them.
 */
export const roleCardQueries = {
  presets: () =>
    queryOptions({
      queryKey: ["presets"],
      queryFn: ({ signal }) => getFromApi("/presets", presetListSchema, signal),
      staleTime: Infinity,
    }),
  options: () =>
    queryOptions({
      queryKey: ["role-card-options"],
      queryFn: ({ signal }) => getFromApi("/role-card-options", roleCardOptionsSchema, signal),
      staleTime: Infinity,
    }),
};

export function hire(hiring: Hire): Promise<Role> {
  return sendToApi("POST", "/roles", hiring, roleSchema);
}

/** Saves the card's next version; sessions started from now on get it. */
export function changeRoleCard(key: string, card: RoleCard): Promise<Role> {
  return sendToApi("PUT", `${rolePath(key)}/card`, card, roleSchema);
}

/** The keys of the Roles someone fills: a person let go fills none. */
export function filledRoleKeys(roles: readonly Role[]): ReadonlySet<string> {
  return new Set(roles.filter(({ letGoAt }) => letGoAt === null).map(({ key }) => key));
}

/** Nobody fills the Role from now on; the person's card, Memory and chats stay readable. */
export function letGoOfPerson(key: string): Promise<Role> {
  return sendToApi("POST", `${rolePath(key)}/let-go`, {}, roleSchema);
}

/** The person let go fills their Role again, as they were. */
export function hirePersonBack(key: string): Promise<Role> {
  return sendToApi("POST", `${rolePath(key)}/hire-back`, {}, roleSchema);
}

/** The person's Avatar becomes `file`; a refusal leaves the one they had. */
export function uploadAvatar(key: string, file: File): Promise<Role> {
  return sendFileToApi(avatarPath(key), file, roleSchema);
}

export function removeAvatar(key: string): Promise<Role> {
  return deleteFromApiReturning(avatarPath(key), roleSchema);
}

/** Where an Avatar's bytes are; a new image has a new address, so the browser caches each for good. */
export function avatarAddress(key: string, imageId: string): string {
  return `${API_PATH}${avatarPath(key)}/${encodeURIComponent(imageId)}/content`;
}

export function addMemoryNote(key: string, note: MemoryNoteDraft): Promise<MemoryNote> {
  return sendToApi("POST", memoryPath(key), note, memoryNoteSchema);
}

export function deleteMemoryNote(key: string, noteId: string): Promise<void> {
  return deleteFromApi(`${memoryPath(key)}/${encodeURIComponent(noteId)}`);
}

/** Deletes every note: the memory starts over. */
export function clearMemory(key: string): Promise<void> {
  return deleteFromApi(memoryPath(key));
}

/**
 * Every People event makes the Roles stale; ["roles"] also covers each Role's own queries. A hire
 * also changes who the other Roles' Consult values reach.
 */
export const roleEventInvalidations: Readonly<
  Record<RoleWebEvent["type"], EventInvalidations[string]>
> = {
  "role.hired": () => [ROLES],
  "role.let-go": () => [ROLES],
  "role.hired-back": () => [ROLES],
  "role.card-changed": () => [ROLES, ENGINE_CASCADE],
  "role.avatar-changed": () => [ROLES],
  "role.memory-changed": () => [ROLES],
};

function rolePath(key: string): `/${string}` {
  return `/roles/${encodeURIComponent(key)}`;
}

function avatarPath(key: string): `/${string}` {
  return `${rolePath(key)}/avatar`;
}

function memoryPath(key: string): `/${string}` {
  return `${rolePath(key)}/memory`;
}
