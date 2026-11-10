import { QueryClient, type QueryKey } from "@tanstack/react-query";
import type { SkillWebEvent } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { projectQueries } from "./projects.ts";
import { skillEventCacheUpdates, skillQueries } from "./skills.ts";

const PINNED = { tag: "v1", commit: "a1b2c3" };
const NEWER = { tag: "v2", commit: "d4e5f6" };

/** A cache holding the library, a skill's review and update diff, and two Projects' skills. */
function cachedQueries(): { queryClient: QueryClient; keys: Record<string, QueryKey> } {
  const queryClient = new QueryClient();
  const keys = {
    library: skillQueries.list().queryKey,
    review: skillQueries.review("tdd").queryKey,
    updateDiff: skillQueries.updateDiff("tdd", PINNED, NEWER).queryKey,
    adminPanelSkills: projectQueries.skills("admin-panel").queryKey,
    shopSkills: projectQueries.skills("shop").queryKey,
  };
  for (const key of Object.values(keys)) queryClient.setQueryData(key, []);
  return { queryClient, keys };
}

function staleOnes(queryClient: QueryClient, keys: Record<string, QueryKey>): readonly string[] {
  return Object.entries(keys)
    .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
    .map(([name]) => name);
}

function used(skill: Extract<SkillWebEvent, { type: "skill.used" }>["skill"]): SkillWebEvent {
  return { type: "skill.used", occurredAt: "2026-11-10T10:00:00.000Z", skill };
}

describe("skill.used", () => {
  it("refetches the library list alone for a library skill, not a skill's review or diff", () => {
    const { queryClient, keys } = cachedQueries();

    skillEventCacheUpdates["skill.used"](used({ kind: "library", skillName: "tdd" }), queryClient);

    expect(staleOnes(queryClient, keys)).toEqual(["library"]);
  });

  it("refetches that Project's skills alone for a Project skill", () => {
    const { queryClient, keys } = cachedQueries();

    skillEventCacheUpdates["skill.used"](
      used({ kind: "project", projectId: "admin-panel", key: "deploy" }),
      queryClient,
    );

    expect(staleOnes(queryClient, keys)).toEqual(["adminPanelSkills"]);
  });
});
