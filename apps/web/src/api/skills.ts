import { queryOptions } from "@tanstack/react-query";
import {
  skillListSchema,
  skillReviewSchema,
  skillSchema,
  type Skill,
  type SkillEdit,
  type SkillWebEvent,
  type WrittenSkill,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendFileToApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const SKILLS = ["skills"] as const;

export const skillQueries = {
  list: () =>
    queryOptions({
      queryKey: SKILLS,
      queryFn: ({ signal }) => getFromApi("/skills", skillListSchema, signal),
    }),
  /** What the user reads before turning it on: its files, and what they change in a session. */
  review: (name: string) =>
    queryOptions({
      queryKey: [...SKILLS, name, "review"],
      queryFn: ({ signal }) => getFromApi(`${skillPath(name)}/review`, skillReviewSchema, signal),
    }),
};

export function writeSkill(written: WrittenSkill): Promise<Skill> {
  return sendToApi("POST", "/skills", written, skillSchema);
}

/** A single `.md`, or a zipped folder. */
export function uploadSkill(file: File): Promise<Skill> {
  return sendFileToApi("/skills/uploads", file, skillSchema);
}

/** The next version of a written skill. */
export function editSkill(name: string, edit: SkillEdit): Promise<Skill> {
  return sendToApi("PUT", skillPath(name), edit, skillSchema);
}

/** The next version of an uploaded skill. */
export function uploadSkillVersion(name: string, file: File): Promise<Skill> {
  return sendFileToApi(`${skillPath(name)}/versions`, file, skillSchema);
}

export function changeSkillState(name: string, state: "on" | "off"): Promise<Skill> {
  return sendToApi("PUT", `${skillPath(name)}/state`, { state }, skillSchema);
}

export function changeSkillEveryone(name: string, everyone: boolean): Promise<Skill> {
  return sendToApi("PUT", `${skillPath(name)}/everyone`, { everyone }, skillSchema);
}

/** Gives the skill to exactly these Roles, by key. */
export function assignSkill(name: string, roles: readonly string[]): Promise<Skill> {
  return sendToApi("PUT", `${skillPath(name)}/roles`, { roles: [...roles] }, skillSchema);
}

export function removeSkill(name: string): Promise<void> {
  return deleteFromApi(skillPath(name));
}

/**
 * Every library event makes the library stale; ["skills"] also covers each skill's review. A
 * Project's own skills say whether the library has the same name, so they go stale too, and a
 * Role's skills are on its card.
 */
export const skillEventInvalidations: Readonly<
  Record<SkillWebEvent["type"], EventInvalidations[string]>
> = {
  "skill.added": () => [SKILLS, ["projects"]],
  "skill.version-saved": () => [SKILLS],
  "skill.turned-on": () => [SKILLS],
  "skill.turned-off": () => [SKILLS],
  "skill.everyone-changed": () => [SKILLS],
  "skill.update-found": () => [SKILLS],
  "skill.update-gone": () => [SKILLS],
  "skill.removed": () => [SKILLS, ["projects"], ["roles"]],
  "skill.role-skills-changed": () => [SKILLS, ["roles"]],
};

function skillPath(name: string): `/${string}` {
  return `/skills/${encodeURIComponent(name)}`;
}
