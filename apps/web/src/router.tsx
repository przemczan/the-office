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
import { MemoryTab } from "./surfaces/people/memory-tab.tsx";
import { PersonPage } from "./surfaces/people/person-page.tsx";
import { HireFromScratchPage, RoleCardEditPage } from "./surfaces/people/role-card-form.tsx";
import { RoleCardTab } from "./surfaces/people/role-card-tab.tsx";
import { WorkTab } from "./surfaces/people/work-tab.tsx";
import { ProjectPage } from "./surfaces/projects/project-page.tsx";
import { ProjectsPage } from "./surfaces/projects/projects-page.tsx";
import { AppearanceSection } from "./surfaces/settings/appearance/appearance-section.tsx";
import { NotificationsSection } from "./surfaces/settings/notifications/notifications-section.tsx";
import { EnginesSection } from "./surfaces/settings/engines/engines-section.tsx";
import { McpServersSection } from "./surfaces/settings/mcp-servers/mcp-servers-section.tsx";
import { OfficeLimitsSection } from "./surfaces/settings/office-limits/office-limits-section.tsx";
import { SettingsPage } from "./surfaces/settings/settings-page.tsx";
import { PipelinesSection } from "./surfaces/settings/pipelines/pipelines-section.tsx";
import { SkillsSection } from "./surfaces/settings/skills/skills-section.tsx";
import { Board } from "./surfaces/work/board.tsx";
import { boardFiltersOf } from "./surfaces/work/board-filters.ts";
import { IdeasPage } from "./surfaces/work/ideas-page.tsx";
import { InitiativePage } from "./surfaces/work/initiative-page.tsx";
import { InitiativesList } from "./surfaces/work/initiatives-list.tsx";
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
  validateSearch: boardFiltersOf,
  staticData: { title: "Work" },
});

/** Ideas, scrolled to the one a link points to, such as one mentioned in a chat. */
export interface IdeasSearch {
  readonly idea?: string;
}

const ideasRoute = createRoute({
  getParentRoute: () => workRoute,
  path: "ideas",
  component: IdeasPage,
  validateSearch: (search: Record<string, unknown>): IdeasSearch => ({
    ...(typeof search["idea"] === "string" && { idea: search["idea"] }),
  }),
  staticData: { title: "Work" },
});

const initiativesRoute = createRoute({
  getParentRoute: () => workRoute,
  path: "initiatives",
  component: InitiativesList,
  staticData: { title: "Work" },
});

// An Initiative's page, at the path its links name (`recordPath`), outside Work's tabs as a Task's is.
const initiativeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "work/initiatives/$initiativeId",
  component: InitiativePage,
  // Until the Initiative is read; the page then names it.
  staticData: { title: "Work" },
});

/**
 * A Task's page, showing one of its Threads first, as one opened from a person's page, and its
 * Changes tab instead of the record's overview; a Decision's link also scrolls to its card.
 */
export interface TaskSearch {
  readonly taskThread?: string;
  readonly recordTab?: "changes";
  readonly decision?: string;
}

// A Task's page, in Work; the rail marks Work while it is open.
const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "tasks/$taskId",
  component: TaskPage,
  validateSearch: (search: Record<string, unknown>): TaskSearch => ({
    ...(typeof search["taskThread"] === "string" && { taskThread: search["taskThread"] }),
    ...(search["recordTab"] === "changes" && { recordTab: "changes" as const }),
    ...(typeof search["decision"] === "string" && { decision: search["decision"] }),
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

const memoryRoute = createRoute({
  getParentRoute: () => personRoute,
  path: "memory",
  component: MemoryTab,
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

/** Hiring from scratch, or from a Proposal's card the user edits before hiring. */
export interface HireSearch {
  readonly proposal?: string;
}

// Outside "people/", where a Role's key could be any word.
const hireFromScratchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "hire",
  component: HireFromScratchPage,
  validateSearch: (search: Record<string, unknown>): HireSearch => ({
    ...(typeof search["proposal"] === "string" && { proposal: search["proposal"] }),
  }),
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
    throw redirect({ to: "/settings/pipelines", replace: true });
  },
});

// The library opens at its first Pipeline; a Pipeline of its own has its address.
const settingsPipelinesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "pipelines",
  component: PipelinesSection,
  staticData: { title: "Settings" },
});

const settingsPipelineRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "pipelines/$pipelineId",
  component: PipelinesSection,
  staticData: { title: "Settings" },
});

const settingsSkillsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "skills",
  component: SkillsSection,
  staticData: { title: "Settings" },
});

const settingsMcpServersRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "mcp-servers",
  component: McpServersSection,
  staticData: { title: "Settings" },
});

const settingsEnginesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "engines",
  component: EnginesSection,
  staticData: { title: "Settings" },
});

const settingsOfficeLimitsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "office-limits",
  component: OfficeLimitsSection,
  staticData: { title: "Settings" },
});

const settingsNotificationsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "notifications",
  component: NotificationsSection,
  staticData: { title: "Settings" },
});

const settingsAppearanceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "appearance",
  component: AppearanceSection,
  staticData: { title: "Settings" },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    nowRoute,
    workRoute.addChildren([boardRoute, ideasRoute, initiativesRoute]),
    initiativeRoute,
    taskRoute,
    peopleRoute,
    personRoute.addChildren([
      personOverviewRoute,
      personWorkRoute,
      conversationsRoute,
      memoryRoute,
      roleCardRoute,
      roleCardEditRoute,
    ]),
    hireFromScratchRoute,
    projectsRoute,
    projectRoute,
    settingsRoute.addChildren([
      settingsHomeRoute,
      settingsPipelinesRoute,
      settingsPipelineRoute,
      settingsSkillsRoute,
      settingsMcpServersRoute,
      settingsEnginesRoute,
      settingsOfficeLimitsRoute,
      settingsNotificationsRoute,
      settingsAppearanceRoute,
    ]),
  ]),
});
