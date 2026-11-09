import { useMatches, type RegisteredRouter, type RouteIds } from "@tanstack/react-router";
import type { OpenPage } from "@the-office/contracts";

type RouteId = RouteIds<RegisteredRouter["routeTree"]>;

// The pages that have an Open page, by their routes' ids, checked against the router's.
const TASK_PAGE = "/tasks/$taskId" satisfies RouteId;
const INITIATIVE_PAGE = "/work/initiatives/$initiativeId" satisfies RouteId;
const IDEAS_PAGE = "/work/ideas" satisfies RouteId;
const PERSON_PAGE = "/people/$roleKey" satisfies RouteId;
const PROJECT_PAGE = "/projects/$projectId" satisfies RouteId;

/** What the Open page is read from: a route the router matched, with its params and search. */
export interface MatchedRoute {
  readonly routeId: string;
  readonly params: object;
  readonly search: object;
}

/**
 * The Open page (spec §2.4) of the routes matched now: a Task's page (a Decision window on it
 * still the Task), an Initiative's, an Idea open on Work › Ideas, a person's or a Project's page,
 * any of their tabs or sections. Undefined on any other page.
 */
export function openPageOf(matches: readonly MatchedRoute[]): OpenPage | undefined {
  for (const { routeId, params, search } of matches) {
    const page = pageOf(routeId, params, search);
    if (page) return page;
  }
  return undefined;
}

/** The Open page beside the chat drawer, following navigation as it happens. */
export function useOpenPage(): OpenPage | undefined {
  return useMatches({ select: (matches) => openPageOf(matches) });
}

function pageOf(routeId: string, params: object, search: object): OpenPage | undefined {
  switch (routeId) {
    case TASK_PAGE: {
      const taskId = textIn(params, "taskId");
      return taskId === undefined ? undefined : { kind: "task", taskId };
    }
    case INITIATIVE_PAGE: {
      const initiativeId = textIn(params, "initiativeId");
      return initiativeId === undefined ? undefined : { kind: "initiative", initiativeId };
    }
    case IDEAS_PAGE: {
      const ideaId = textIn(search, "idea");
      return ideaId === undefined ? undefined : { kind: "idea", ideaId };
    }
    case PERSON_PAGE: {
      const roleKey = textIn(params, "roleKey");
      return roleKey === undefined ? undefined : { kind: "person", roleKey };
    }
    case PROJECT_PAGE: {
      const projectId = textIn(params, "projectId");
      return projectId === undefined ? undefined : { kind: "project", projectId };
    }
    default:
      return undefined;
  }
}

function textIn(values: object, key: string): string | undefined {
  const value: unknown = Object.entries(values).find(([name]) => name === key)?.[1];
  return typeof value === "string" && value !== "" ? value : undefined;
}
