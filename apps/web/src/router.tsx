import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  redirect,
} from "@tanstack/react-router";
import { Shell } from "./shell/shell.tsx";
import { NowPage } from "./surfaces/now/now-page.tsx";
import { OverviewTab } from "./surfaces/people/overview-tab.tsx";
import { PeoplePage } from "./surfaces/people/people-page.tsx";
import { ConversationsTab } from "./surfaces/people/conversations-tab.tsx";
import { PersonPage } from "./surfaces/people/person-page.tsx";
import { RoleCardEditPage } from "./surfaces/people/role-card-form.tsx";
import { RoleCardTab } from "./surfaces/people/role-card-tab.tsx";
import { WorkTab } from "./surfaces/people/work-tab.tsx";
import { ProjectPage } from "./surfaces/projects/project-page.tsx";
import { ProjectsPage } from "./surfaces/projects/projects-page.tsx";
import { SettingsPage } from "./surfaces/settings/settings-page.tsx";
import { SkillsSection } from "./surfaces/settings/skills/skills-section.tsx";
import { Board } from "./surfaces/work/board.tsx";
import { IdeasPage } from "./surfaces/work/ideas-page.tsx";
import { TaskPage } from "./surfaces/work/task-page.tsx";
import { WorkPage } from "./surfaces/work/work-page.tsx";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /** The page's title, shown in the top bar. */
    readonly title?: string;
  }
}

/**
 * What opens over any page (spec §4): the chat with a person, by their Role's key, and the Thread
 * shown in it; or the Needs you panel.
 */
export interface OverPageSearch {
  readonly chat?: string;
  readonly thread?: string;
  readonly needsYou?: true;
}

const rootRoute = createRootRoute({
  component: Shell,
  validateSearch: (search: Record<string, unknown>): OverPageSearch => ({
    ...(typeof search["chat"] === "string" && { chat: search["chat"] }),
    ...(typeof search["thread"] === "string" && { thread: search["thread"] }),
    ...(search["needsYou"] === true && { needsYou: true as const }),
  }),
  // Like the click-through, an address that names no page opens Now.
  notFoundComponent: () => <Navigate to="/now" replace />,
});

// Now is home (spec §4).
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/now", replace: true });
  },
});

const nowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "now",
  component: NowPage,
  staticData: { title: "Now" },
});

const workRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "work",
  component: WorkPage,
  staticData: { title: "Work" },
});

const boardRoute = createRoute({
  getParentRoute: () => workRoute,
  path: "/",
  component: Board,
  staticData: { title: "Work" },
});

const ideasRoute = createRoute({
  getParentRoute: () => workRoute,
  path: "ideas",
  component: IdeasPage,
  staticData: { title: "Work" },
});

/**
 * A Task's page, showing one of its Threads first, as one opened from a person's page, and its
 * Changes tab instead of the record's overview.
 */
export interface TaskSearch {
  readonly taskThread?: string;
  readonly recordTab?: "changes";
}

// A Task's page, in Work; the rail marks Work while it is open.
const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "tasks/$taskId",
  component: TaskPage,
  validateSearch: (search: Record<string, unknown>): TaskSearch => ({
    ...(typeof search["taskThread"] === "string" && { taskThread: search["taskThread"] }),
    ...(search["recordTab"] === "changes" && { recordTab: "changes" as const }),
  }),
  // Until the Task is read; the page then names it.
  staticData: { title: "Work" },
});

const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "people",
  component: PeoplePage,
  staticData: { title: "People" },
});

// A person's page, keyed by their Role's key: one person fills each Role.
const personRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "people/$roleKey",
  component: PersonPage,
  // Until the person is read; the page then names them.
  staticData: { title: "People" },
});

const personOverviewRoute = createRoute({
  getParentRoute: () => personRoute,
  path: "/",
  component: OverviewTab,
  staticData: { title: "People" },
});

const personWorkRoute = createRoute({
  getParentRoute: () => personRoute,
  path: "work",
  component: WorkTab,
  staticData: { title: "People" },
});

const conversationsRoute = createRoute({
  getParentRoute: () => personRoute,
  path: "conversations",
  component: ConversationsTab,
  staticData: { title: "People" },
});

const roleCardRoute = createRoute({
  getParentRoute: () => personRoute,
  path: "role",
  component: RoleCardTab,
  staticData: { title: "People" },
});

const roleCardEditRoute = createRoute({
  getParentRoute: () => personRoute,
  path: "role/edit",
  component: RoleCardEditPage,
  staticData: { title: "People" },
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects",
  component: ProjectsPage,
  staticData: { title: "Projects" },
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects/$projectId",
  component: ProjectPage,
  // Until the Project is read; the page then names it.
  staticData: { title: "Projects" },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: SettingsPage,
  staticData: { title: "Settings" },
});

// Settings opens at its first section.
const settingsHomeRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/skills", replace: true });
  },
});

const settingsSkillsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "skills",
  component: SkillsSection,
  staticData: { title: "Settings" },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    nowRoute,
    workRoute.addChildren([boardRoute, ideasRoute]),
    taskRoute,
    peopleRoute,
    personRoute.addChildren([
      personOverviewRoute,
      personWorkRoute,
      conversationsRoute,
      roleCardRoute,
      roleCardEditRoute,
    ]),
    projectsRoute,
    projectRoute,
    settingsRoute.addChildren([settingsHomeRoute, settingsSkillsRoute]),
  ]),
});
