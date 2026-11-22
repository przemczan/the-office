import type { Project } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closePage,
  openPage,
  shownText,
  stubService,
  until,
  type Answers,
} from "../../../shell/page.fixtures.tsx";
import {
  aCiRun,
  anIdea,
  anInitiative,
  anInstance,
  aPullRequest,
  aTask,
  hoursAgo,
  NOW,
  PROJECT,
  uuid,
} from "./overview.fixtures.ts";
import { ProjectOverview } from "./overview-section.tsx";

const LAUNCH = uuid(1);
const PLANNED = uuid(2);
const BUILDING = uuid(3);
const SHIPPED = uuid(4);
const DARK_MODE = uuid(5);
const GIFT_CARDS = uuid(6);
const WEB = uuid(7);

const TILE_TITLES = [
  "Initiatives",
  "Ideas",
  "CI",
  "Pull requests",
  "Test instances",
  "Environment",
  "Remote sign-in",
  "Recent activity",
];

const ok = (body: unknown) => () => ({ status: 200, body });

/** Every read the Overview makes, answered with the Shop Project's records. */
function withData(more: Answers = {}): Answers {
  return {
    "GET /api/projects": ok([PROJECT]),
    "GET /api/onboardings": ok([]),
    "GET /api/tasks": ok([
      aTask(PLANNED, { initiativeId: LAUNCH, state: "done", endedAt: hoursAgo(2) }),
      aTask(BUILDING, { initiativeId: LAUNCH, state: "in-progress" }),
      aTask(SHIPPED, {
        state: "done",
        endedAt: hoursAgo(1),
        commitMessagePublishedAt: hoursAgo(1),
      }),
    ]),
    "GET /api/initiatives": ok([anInitiative(LAUNCH, { name: "Spring launch" })]),
    "GET /api/ideas": ok([
      anIdea(DARK_MODE, { title: "Dark mode", capturedAt: hoursAgo(3) }),
      anIdea(GIFT_CARDS, { title: "Gift cards", capturedAt: hoursAgo(4) }),
    ]),
    "GET /api/ci-runs?projectId=shop": ok({
      runs: [aCiRun(2, { status: "failed" })],
      projects: [{ projectId: PROJECT.id, checkedAt: hoursAgo(1), stale: false, problem: null }],
    }),
    "GET /api/pull-requests?projectId=shop": ok({
      pullRequests: [aPullRequest(7, { title: "Add the basket" })],
      problems: [],
    }),
    "GET /api/projects/shop/test-instances": ok({
      runEnvironmentOn: true,
      targets: [],
      initiatives: [{ id: LAUNCH, name: "Spring launch" }],
      branches: [
        {
          name: "initiative/launch",
          branchCommit: null,
          instances: [anInstance(WEB, { branch: "initiative/launch", initiativeId: LAUNCH })],
        },
      ],
    }),
    "GET /api/projects/shop/environment-check": ok({
      check: {
        projectId: PROJECT.id,
        environment: PROJECT.environment,
        state: "passed",
        checks: [],
        startedAt: hoursAgo(1),
        finishedAt: hoursAgo(1),
      },
    }),
    "GET /api/projects/shop/remote-needs": ok({
      remoteNeeds: { kind: "github-https", missing: [] },
    }),
    ...more,
  };
}

/** Every read answered with nothing in it. */
function withNothing(): Answers {
  return withData({
    "GET /api/tasks": ok([]),
    "GET /api/initiatives": ok([]),
    "GET /api/ideas": ok([]),
    "GET /api/ci-runs?projectId=shop": ok({
      runs: [],
      projects: [{ projectId: PROJECT.id, checkedAt: null, stale: false, problem: null }],
    }),
    "GET /api/pull-requests?projectId=shop": ok({ pullRequests: [], problems: [] }),
    "GET /api/projects/shop/test-instances": ok({
      runEnvironmentOn: true,
      targets: [],
      initiatives: [],
      branches: [],
    }),
    "GET /api/projects/shop/environment-check": ok({ check: null }),
    "GET /api/projects/shop/remote-needs": ok({ remoteNeeds: null }),
  });
}

async function shown(answers: Answers, project: Project = PROJECT): Promise<HTMLElement> {
  stubService(answers);
  const { page } = await openPage("/", { "/": () => <ProjectOverview project={project} /> });
  await until(() => expect(page.querySelector('[aria-busy="true"]')).toBeNull());
  return page;
}

function tilesOf(page: HTMLElement): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>(".project-overview-tile")];
}

function tileNamed(page: HTMLElement, title: string): HTMLElement {
  const tile = tilesOf(page).find(
    (candidate) =>
      shownText(candidate.querySelector(".project-block-title") ?? candidate) === title,
  );
  if (!tile) throw new Error(`There is no ${title} tile.`);
  return tile;
}

function titlesOf(page: HTMLElement): string[] {
  return tilesOf(page).map((tile) => shownText(tile.querySelector(".project-block-title") ?? tile));
}

function hrefOf(scope: HTMLElement, text: string): string | null {
  const link = [...scope.querySelectorAll("a")].find((anchor) => shownText(anchor) === text);
  if (!link) throw new Error(`There is no link ${text}.`);
  return link.getAttribute("href");
}

describe("a Project's Overview", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    closePage();
    vi.useRealTimers();
  });

  it("shows Onboarding and Work, then every tile with what it reads", async () => {
    const page = await shown(withData());

    const blocks = shownText(page);
    expect(blocks.indexOf("Onboarding")).toBeLessThan(blocks.indexOf("Running Tasks at once"));
    expect(titlesOf(page)).toEqual(TILE_TITLES);
    expect(shownText(tileNamed(page, "Initiatives"))).toContain("Spring launch");
    expect(shownText(tileNamed(page, "Initiatives"))).toContain("1 of 2 Tasks done");
    expect(shownText(tileNamed(page, "Ideas"))).toContain("2 New Ideas");
    expect(shownText(tileNamed(page, "Ideas"))).toContain("Dark mode");
    expect(shownText(tileNamed(page, "CI"))).toContain("Failed");
    expect(shownText(tileNamed(page, "CI"))).toContain("CI #2 · Run 2");
    expect(shownText(tileNamed(page, "CI"))).toContain("0123456");
    expect(shownText(tileNamed(page, "Pull requests"))).toContain("1 open");
    expect(shownText(tileNamed(page, "Pull requests"))).toContain("#7 Add the basket");
    expect(shownText(tileNamed(page, "Pull requests"))).toContain("Passing");
    expect(shownText(tileNamed(page, "Pull requests"))).toContain("Can merge");
    expect(shownText(tileNamed(page, "Test instances"))).toContain("Web app");
    expect(shownText(tileNamed(page, "Test instances"))).toContain("Open");
    expect(shownText(tileNamed(page, "Environment"))).toContain("Ready");
    expect(shownText(tileNamed(page, "Remote sign-in"))).toContain("Signed in");
    const activity = shownText(tileNamed(page, "Recent activity"));
    expect(activity).toContain(`Done: Task ${SHIPPED} · published`);
    expect(activity).toContain("Idea captured: Dark mode");
    expect(activity.indexOf(`Task ${SHIPPED}`)).toBeLessThan(activity.indexOf(`Task ${PLANNED}`));
  });

  it("gives every tile its empty state", async () => {
    const page = await shown(withNothing());

    expect(shownText(tileNamed(page, "Initiatives"))).toContain(
      "No Initiative spans Shop right now.",
    );
    expect(shownText(tileNamed(page, "Ideas"))).toContain("No new Ideas for Shop.");
    expect(shownText(tileNamed(page, "CI"))).toContain("No CI runs on GitHub yet.");
    expect(shownText(tileNamed(page, "Pull requests"))).toContain("No open pull requests.");
    expect(shownText(tileNamed(page, "Test instances"))).toContain("None running.");
    expect(shownText(tileNamed(page, "Environment"))).toContain("Not checked yet.");
    expect(shownText(tileNamed(page, "Remote sign-in"))).toContain(
      "Its base branch tracks no remote branch",
    );
    expect(shownText(tileNamed(page, "Recent activity"))).toContain("Nothing in the last 7 days.");
  });

  it("says CI runs need a code host when the Project's runs aren't listed", async () => {
    const page = await shown(
      withData({ "GET /api/ci-runs?projectId=shop": ok({ runs: [], projects: [] }) }),
    );

    expect(shownText(tileNamed(page, "CI"))).toContain(
      "CI runs need a code host The Office reads.",
    );
  });

  it("shows the listings' problems in the CI and Pull requests tiles, and in Remote sign-in", async () => {
    const refused = { kind: "cannot-read", text: "GitHub refused to be read." };
    const page = await shown(
      withData({
        "GET /api/ci-runs?projectId=shop": ok({
          runs: [],
          projects: [{ projectId: PROJECT.id, checkedAt: null, stale: true, problem: refused }],
        }),
        "GET /api/pull-requests?projectId=shop": ok({
          pullRequests: [],
          problems: [{ ...refused, projectId: PROJECT.id }],
        }),
      }),
    );

    expect(shownText(tileNamed(page, "CI"))).toContain("GitHub refused to be read.");
    expect(shownText(tileNamed(page, "CI"))).toContain("Out of date");
    expect(shownText(tileNamed(page, "Pull requests"))).toContain("GitHub refused to be read.");
    expect(shownText(tileNamed(page, "Remote sign-in"))).toContain("Needs attention");
    expect(shownText(tileNamed(page, "Remote sign-in"))).toContain("GitHub refused to be read.");
  });

  it("shows a failed read in its own tile only", async () => {
    const page = await shown(
      withData({
        "GET /api/projects/shop/environment-check": () => ({
          status: 500,
          body: { message: "The check can't be read." },
        }),
      }),
    );

    const failed = tilesOf(page).filter((tile) => tile.querySelector('[role="alert"]') !== null);
    expect(failed).toEqual([tileNamed(page, "Environment")]);
    expect(shownText(tileNamed(page, "Ideas"))).toContain("Dark mode");
  });

  it("leaves out Test instances while Test targets is switched off", async () => {
    const page = await shown(withData(), {
      ...PROJECT,
      features: { ...PROJECT.features, "test-targets": false },
    });

    expect(titlesOf(page)).toEqual(TILE_TITLES.filter((title) => title !== "Test instances"));
  });

  it("links each tile to where its details live", async () => {
    const page = await shown(withData());

    expect(hrefOf(tileNamed(page, "Initiatives"), "All Initiatives")).toBe("/work/initiatives");
    expect(hrefOf(tileNamed(page, "Initiatives"), "Spring launch")).toBe(
      `/work/initiatives/${LAUNCH}`,
    );
    expect(hrefOf(tileNamed(page, "Ideas"), "Open Ideas")).toBe("/work/ideas");
    expect(hrefOf(tileNamed(page, "Ideas"), "Dark mode")).toBe(`/work/ideas?idea=${DARK_MODE}`);
    expect(hrefOf(tileNamed(page, "CI"), "CI runs")).toBe("/work/ci");
    expect(hrefOf(tileNamed(page, "CI"), "CI #2 · Run 2")).toBe(
      "https://github.com/acme/shop/actions/runs/2",
    );
    expect(hrefOf(tileNamed(page, "Pull requests"), "Pull requests")).toBe("/work/pull-requests");
    expect(hrefOf(tileNamed(page, "Test instances"), "Test targets")).toBe(
      "/projects/shop/test-targets",
    );
    expect(hrefOf(tileNamed(page, "Environment"), "Environment")).toBe(
      "/projects/shop/environment",
    );
    expect(hrefOf(tileNamed(page, "Remote sign-in"), "Settings › Office identity")).toBe(
      "/settings/office-identity",
    );
    expect(hrefOf(tileNamed(page, "Recent activity"), `Task ${SHIPPED}`)).toBe(`/tasks/${SHIPPED}`);
  });
});
