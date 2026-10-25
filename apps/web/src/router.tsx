import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  redirect,
} from "@tanstack/react-router";
import { Shell } from "./shell/shell.tsx";
import { NowPage } from "./surfaces/now/now-page.tsx";
import { PeoplePage } from "./surfaces/people/people-page.tsx";
import { ProjectsPage } from "./surfaces/projects/projects-page.tsx";
import { SettingsPage } from "./surfaces/settings/settings-page.tsx";
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

const rootRoute = createRootRoute({
  component: Shell,
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

const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "people",
  component: PeoplePage,
  staticData: { title: "People" },
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects",
  component: ProjectsPage,
  staticData: { title: "Projects" },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: SettingsPage,
  staticData: { title: "Settings" },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    nowRoute,
    workRoute,
    peopleRoute,
    projectsRoute,
    settingsRoute,
  ]),
});
