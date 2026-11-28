import { queryOptions } from "@tanstack/react-query";
import {
  skillListSchema,
  skillReviewSchema,
  skillSchema,
  skillUpdateDiffSchema,
  skillWebEventSchema,
  type PinnedVersion,
  type Skill,
  type SkillEdit,
  type SkillWebEvent,
  type WrittenSkill,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendFileToApi, sendToApi } from "./api-client.ts";
import {
  readEvent,
  type EventCacheUpdates,
  type EventInvalidations,
} from "./event-stream-provider.tsx";
import { projectQueries } from "./projects.ts";

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
  /** What an update of the skill from `from` to `to` changes in its files; it reads the Source. */
  updateDiff: (name: string, from: PinnedVersion, to: PinnedVersion) =>
    queryOptions({
      queryKey: [...SKILLS, name, "update-diff", from.commit, to.commit],
      queryFn: ({ signal }) =>
        getFromApi(
          `${skillPath(name)}/update-diff?${updateDiffQuery(from, to)}`,
          skillUpdateDiffSchema,
          signal,
        ),
      // Two pinned versions' files never change, so neither does their diff.
      staleTime: Infinity,
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

/** The library's events that change one query exactly, which `skillEventCacheUpdates` applies. */
type ExactEventType = "skill.used";

/**
 * Every library event makes the library stale; ["skills"] also covers each skill's review. A
 * Project's own skills say whether the library has the same name, so they go stale too, and a
 * Role's skills are on its card.
 */
export const skillEventInvalidations: Readonly<
  Record<Exclude<SkillWebEvent["type"], ExactEventType>, EventInvalidations[string]>
> = {
  "skill.added": () => [SKILLS, ["projects"]],
  "skill.version-saved": () => [SKILLS],
  "skill.turned-on": () => [SKILLS],
  "skill.turned-off": () => [SKILLS],
  "skill.everyone-changed": () => [SKILLS],
  "skill.update-found": () => [SKILLS],
  "skill.update-gone": () => [SKILLS],
  "skill.updated": () => [SKILLS],
  "skill.removed": () => [SKILLS, ["projects"], ["roles"]],
  "skill.role-skills-changed": () => [SKILLS, ["roles"]],
};

/**
 * A use changes only its skill's count: the library list, or its Project's own skills. Exactly
 * those, as a session may use skills often and ["skills"] as a prefix would read each open review
 * and update diff again.
 */
export const skillEventCacheUpdates: Readonly<Record<ExactEventType, EventCacheUpdates[string]>> = {
  "skill.used": (event, queryClient) => {
    // An event this page can't read, as after an Office update, has every skill read again.
    const used = readEvent(skillWebEventSchema, event, queryClient, [SKILLS]);
    if (used?.type !== "skill.used") return;
    const queryKey =
      used.skill.kind === "library"
        ? skillQueries.list().queryKey
        : projectQueries.skills(used.skill.projectId).queryKey;
    void queryClient.invalidateQueries({ queryKey, exact: true });
  },
};

function updateDiffQuery(from: PinnedVersion, to: PinnedVersion): URLSearchParams {
  return new URLSearchParams({
    ...(from.tag !== undefined && { fromTag: from.tag }),
    fromCommit: from.commit,
    ...(to.tag !== undefined && { toTag: to.tag }),
    toCommit: to.commit,
  });
}

function skillPath(name: string): `/${string}` {
  return `/skills/${encodeURIComponent(name)}`;
}
