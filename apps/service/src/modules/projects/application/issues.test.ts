import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { IssueLinkChanged, IssuesImported } from "../domain/issue-link-events.js";
import type { IssueDropReason } from "../domain/issue-link.js";
import { DEFAULT_ISSUE_SETTINGS, type IssueSettings } from "../domain/issue-settings.js";
import type { Project } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import { FeatureSwitchedOff } from "../domain/project-features.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { openedPullRequest } from "../domain/pull-request.js";
import { OwnProjects } from "../pull-request-watch.fixtures.js";
import { IssueHostForTests } from "../ports/code-host.fixtures.js";
import { IssueLinkRepositoryForTests } from "../ports/issue-link-repository.fixtures.js";
import { PullRequestRepositoryForTests } from "../ports/pull-request-repository.fixtures.js";
import { CodeHosts } from "./code-hosts.js";
import { IssueImport, MOST_IMPORTED_AT_ONCE } from "./issue-import.js";
import { IssueTasks, type NewIssueTask } from "./issue-tasks.js";
import { ISSUE_WATCH, ISSUE_WATCH_EVERY, IssueWatch } from "./issue-watch.js";
import { IssueWriteBacks, WRITE_BACK_RETRIED_FOR } from "./issue-write-backs.js";
import { ProjectIssueHosts, type ProjectIssueHost } from "./project-issue-hosts.js";
import type { Worktrees } from "./worktrees.js";

const ANN = { userId: "user-ann", name: "Ann" };
const BOB = { userId: "user-bob", name: "Bob" };

/** The Project's repository is always the fake host's, readable unless it is signed out. */
class FixedIssueHosts extends ProjectIssueHosts {
  constructor(private readonly host: IssueHostForTests) {
    super(undefined as never, undefined as never);
  }

  override async of(): Promise<ProjectIssueHost | undefined> {
    return { remoteUrl: this.host.remoteUrl, host: this.host };
  }

  override async readable(): Promise<ProjectIssueHost> {
    if (this.host.signedOut) {
      throw new ProjectRefused([
        "Sign in with GitHub in Settings › Office identity to import issues.",
      ]);
    }
    return { remoteUrl: this.host.remoteUrl, host: this.host };
  }
}

let host: IssueHostForTests;
let projects: OwnProjects;
let links: IssueLinkRepositoryForTests;
let pullRequests: PullRequestRepositoryForTests;
let schedule: ManualSchedule;
let published: DomainEvent[];
let created: (NewIssueTask & { readonly id: string })[];
let refuseNextTask: boolean;
let landed: Map<string, string>;
let issueImport: IssueImport;
let writeBacks: IssueWriteBacks;
let watch: IssueWatch;

function setUp(settings: Partial<IssueSettings> = {}, fields: Partial<Project> = {}): Project {
  const project = aProject({
    id: "tools",
    name: "Tools",
    issueSettings: { ...DEFAULT_ISSUE_SETTINGS, ...settings },
    ...fields,
  });
  projects = new OwnProjects([project]);
  const events = new EventBus();
  published = [];
  events.subscribeToEveryEvent((event) => void published.push(event));
  const tasks = new IssueTasks();
  tasks.register(async (task) => {
    if (refuseNextTask) {
      refuseNextTask = false;
      throw new Error("Work refused the Task.");
    }
    const id = randomUUID();
    created.push({ ...task, id });
    return id;
  });
  const hosts = new FixedIssueHosts(host);
  issueImport = new IssueImport(projects, hosts, links, tasks, events, schedule);
  const worktrees = {
    landedOf: async (_project: Project, taskId: string) => landed.get(taskId),
  } as unknown as Worktrees;
  writeBacks = new IssueWriteBacks(
    links,
    projects,
    new CodeHosts([host]),
    pullRequests,
    worktrees,
    events,
    schedule,
  );
  watch = new IssueWatch(projects, hosts, links, issueImport, writeBacks, events, schedule);
  watch.onApplicationBootstrap();
  return project;
}

beforeEach(() => {
  host = new IssueHostForTests();
  links = new IssueLinkRepositoryForTests();
  pullRequests = new PullRequestRepositoryForTests();
  schedule = new ManualSchedule();
  schedule.setTime(new Date("2026-11-19T10:00:00Z"));
  created = [];
  refuseNextTask = false;
  landed = new Map();
});

/** Imports the issue by hand as Ann and gives its Task's id. */
async function imported(number: number): Promise<string> {
  const { imported: made } = await issueImport.importByHand("tools", [number], ANN);
  const taskId = made[0]?.taskId;
  if (taskId === undefined) throw new Error(`#${number} wasn't imported.`);
  return taskId;
}

describe("importing issues by hand", () => {
  it("makes each a Task of its Kind, its body the Description, created by the user", async () => {
    setUp();
    host.addIssue({ number: 1, title: "Live view freezes", body: "After sleep.", labels: ["BUG"] });
    host.addIssue({ number: 2, title: "Dark mode for the board" });
    host.addIssue({ number: 3, state: { state: "closed", closedAt: new Date() } });

    const result = await issueImport.importByHand("tools", [1, 2, 3, 4], ANN);

    expect(result.imported.map(({ number }) => number)).toEqual([1, 2]);
    expect(result.skipped).toEqual([
      { number: 3, why: "#3 is closed." },
      { number: 4, why: "#4 isn't an issue on GitHub." },
    ]);
    expect(created).toEqual([
      expect.objectContaining({
        projectId: "tools",
        title: "Live view freezes",
        description: "After sleep.",
        kind: "bug",
        createdBy: ANN,
        createdByTheOffice: false,
      }),
      expect.objectContaining({
        title: "Dark mode for the board",
        description: "",
        kind: "feature",
      }),
    ]);
    const link = await issueImport.linkOf(result.imported[0]?.taskId ?? "");
    expect(link).toMatchObject({
      link: { number: 1, importedBy: { kind: "user", user: ANN }, closedOnHostAt: null },
      writeBackProblem: null,
    });
    expect(published.filter((event) => event instanceof IssuesImported)).toHaveLength(1);
  });

  it("lists the open issues not yet imported, newest first, with the Kind each would get", async () => {
    setUp();
    host.addIssue({ number: 1, labels: ["bug"] });
    host.addIssue({ number: 2 });
    host.addIssue({ number: 3 });
    await imported(2);

    const open = await issueImport.openIssues("tools");

    expect(open.map(({ number, kind }) => [number, kind])).toEqual([
      [3, "feature"],
      [1, "bug"],
    ]);
  });

  it("imports an issue once, even after its Task is Dropped or archived: the link stays", async () => {
    setUp();
    host.addIssue({ number: 7 });
    const taskId = await imported(7);

    const again = await issueImport.importByHand("tools", [7], BOB);
    // Dropped, then archived: Archive changes nothing of the link.
    await writeBacks.taskDropped(taskId, null);
    const afterDrop = await issueImport.importByHand("tools", [7], BOB);

    for (const { skipped } of [again, afterDrop]) {
      expect(skipped).toEqual([{ number: 7, why: "#7 was already imported." }]);
    }
    expect(created).toHaveLength(1);
    expect([...links.links.values()]).toEqual([
      expect.objectContaining({ number: 7, taskId, taskEndedAt: expect.any(Date) }),
    ]);
  });

  it("gives the claim back when Work refuses the Task, so a later import can try again", async () => {
    setUp();
    host.addIssue({ number: 8 });
    refuseNextTask = true;

    const refused = await issueImport.importByHand("tools", [8], ANN);
    const tried = await issueImport.importByHand("tools", [8], ANN);

    expect(refused.skipped).toEqual([{ number: 8, why: "Work refused the Task." }]);
    expect(tried.imported).toHaveLength(1);
  });

  it("is refused while no one is signed in", async () => {
    setUp();
    host.signedOut = true;

    await expect(issueImport.importByHand("tools", [1], ANN)).rejects.toBeInstanceOf(
      ProjectRefused,
    );
    await expect(issueImport.openIssues("tools")).rejects.toBeInstanceOf(ProjectRefused);
  });
});

describe("the issue watch", () => {
  it("imports the open issues with the label every 5 minutes, oldest first, created by The Office", async () => {
    setUp({ autoImportLabel: "Office", autoImportLabelSetBy: BOB });
    host.addIssue({ number: 1, labels: ["office"] });
    host.addIssue({ number: 2 });
    host.addIssue({ number: 3, labels: ["OFFICE", "bug"] });

    await schedule.runRepeating(ISSUE_WATCH);

    expect(schedule.intervalOf(ISSUE_WATCH)).toBe(ISSUE_WATCH_EVERY);
    expect(host.listings[0]).toMatchObject({ label: "Office", order: "oldest-first" });
    expect(
      created.map(({ title, kind, createdBy, createdByTheOffice }) => ({
        title,
        kind,
        createdBy,
        createdByTheOffice,
      })),
    ).toEqual([
      { title: "Issue 1", kind: "feature", createdBy: BOB, createdByTheOffice: true },
      { title: "Issue 3", kind: "bug", createdBy: BOB, createdByTheOffice: true },
    ]);
    expect((await issueImport.linkOf(created[0]?.id ?? ""))?.link.importedBy).toEqual({
      kind: "office",
    });
  });

  it("imports at most 50 at a check, the rest at the next", async () => {
    setUp({ autoImportLabel: "office", autoImportLabelSetBy: BOB });
    for (let number = 1; number <= 60; number += 1) host.addIssue({ number, labels: ["office"] });

    await watch.check();
    expect(created).toHaveLength(MOST_IMPORTED_AT_ONCE);
    expect(created.at(-1)?.title).toBe("Issue 50");

    await watch.check();
    expect(created).toHaveLength(60);
  });

  it("asks nothing while no one is signed in, saying nothing", async () => {
    setUp({ autoImportLabel: "office", autoImportLabelSetBy: BOB });
    host.addIssue({ number: 1, labels: ["office"] });
    host.signedOut = true;

    await watch.check();

    expect(host.listings).toEqual([]);
    expect(created).toEqual([]);
  });

  it("imports nothing without a label, and an issue once when both imports run at once", async () => {
    setUp();
    host.addIssue({ number: 3, labels: ["office"] });
    await watch.check();
    expect(created).toEqual([]);

    setUp({ autoImportLabel: "office", autoImportLabelSetBy: BOB });
    const [byHand] = await Promise.all([
      issueImport.importByHand("tools", [3], ANN),
      watch.check(),
    ]);

    expect(created).toHaveLength(1);
    expect(byHand.imported.length + byHand.skipped.length).toBe(1);
  });

  it("keeps when an issue closed on GitHub, and clears it once open again; the Task doesn't move", async () => {
    setUp();
    host.addIssue({ number: 4 });
    const taskId = await imported(4);

    host.closeOnHost(4, new Date("2026-11-19T11:00:00Z"));
    await watch.check();
    expect((await issueImport.linkOf(taskId))?.link.closedOnHostAt).toEqual(
      new Date("2026-11-19T11:00:00Z"),
    );
    expect(published.filter((event) => event instanceof IssueLinkChanged)).toEqual([
      expect.objectContaining({ projectId: "tools", taskId }),
    ]);

    host.addIssue({ number: 4 });
    await watch.check();
    expect((await issueImport.linkOf(taskId))?.link.closedOnHostAt).toBeNull();
    expect(host.writes).toEqual([]);
  });

  it("stops reading an issue once its Task is Done", async () => {
    setUp();
    host.addIssue({ number: 5 });
    const taskId = await imported(5);
    await writeBacks.taskDone(taskId);
    host.closeOnHost(5);

    await watch.check();

    expect((await issueImport.linkOf(taskId))?.link.closedOnHostAt).toBeNull();
  });
});

describe("writing back on the issue", () => {
  it("comments when the Task starts and when it is Done in a pull request, with the switch on", async () => {
    setUp({ commentOnStartAndDone: true });
    host.addIssue({ number: 1 });
    const taskId = await imported(1);
    await pullRequests.record(
      openedPullRequest({
        id: randomUUID(),
        projectId: "tools",
        taskId,
        remoteUrl: host.remoteUrl,
        number: 12,
        url: "https://github.com/office/tools/pull/12",
        title: "fix: the Live view wakes up",
        branch: `office/${taskId}`,
        baseBranch: "main",
        openedAt: new Date(),
      }),
    );

    await writeBacks.taskStarted(taskId, "Live view freezes");
    await writeBacks.taskDone(taskId);

    expect(host.writes).toEqual([
      {
        action: "comment",
        number: 1,
        body: "Work on this issue started in The Office: Live view freezes.",
      },
      { action: "comment", number: 1, body: "Done in #12." },
    ]);
  });

  it("names the commit a merge landed as, shortened", async () => {
    setUp({ commentOnStartAndDone: true });
    host.addIssue({ number: 1 });
    const taskId = await imported(1);
    landed.set(taskId, "3f2c1ab9d0e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8");

    await writeBacks.taskDone(taskId);

    expect(host.writes).toEqual([{ action: "comment", number: 1, body: "Done in 3f2c1ab." }]);
  });

  it("writes nothing with the switches off, as by default but closing on Done by Fixes #n", async () => {
    setUp();
    host.addIssue({ number: 1 });
    const one = await imported(1);
    host.addIssue({ number: 2 });
    const other = await imported(2);

    await writeBacks.taskStarted(one, "One");
    await writeBacks.taskDone(one);
    await writeBacks.taskDropped(other, { kind: "wont-fix" });

    expect(host.writes).toEqual([]);
  });

  it.each<[IssueDropReason | null, string]>([
    [null, "Closed: the Task was dropped."],
    [{ kind: "wont-fix" }, "Closed: won't fix."],
    [{ kind: "cant-reproduce" }, "Closed: can't be reproduced."],
    [{ kind: "other", text: "Moved to the design system." }, "Closed: Moved to the design system."],
  ])("closes as not planned on Drop with the reason %j", async (reason, comment) => {
    setUp({ closeOnDrop: true });
    host.addIssue({ number: 9 });
    const taskId = await imported(9);

    await writeBacks.taskDropped(taskId, reason);

    expect(host.writes).toEqual([
      { action: "comment", number: 9, body: comment },
      { action: "close", number: 9 },
    ]);
  });

  it("opens an issue its Drop closed again as the Task is reopened, and only that one", async () => {
    setUp({ closeOnDrop: true });
    host.addIssue({ number: 13 });
    host.addIssue({ number: 14 });
    const closed = await imported(13);
    const leftOpen = await imported(14);
    await writeBacks.taskDropped(closed, { kind: "wont-fix" });
    await writeBacks.taskDone(leftOpen);
    host.writes.length = 0;

    await writeBacks.taskReopened(closed);
    await writeBacks.taskReopened(leftOpen);
    await writeBacks.taskReopened(closed);

    expect(host.writes).toEqual([
      { action: "comment", number: 13, body: "Reopened: the Task was reopened." },
      { action: "reopen", number: 13 },
    ]);
    expect(host.issues.get(13)?.state).toEqual({ state: "open" });
    expect([...links.links.values()].filter(({ taskEndedAt }) => taskEndedAt === null)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ number: 13 }),
        expect.objectContaining({ number: 14 }),
      ]),
    );
  });

  it("names a Duplicate's issue, or its title when that Task has none", async () => {
    setUp({ closeOnDrop: true });
    host.addIssue({ number: 10 });
    host.addIssue({ number: 11 });
    host.addIssue({ number: 12 });
    const kept = await imported(10);
    const duplicate = await imported(11);
    const another = await imported(12);

    await writeBacks.taskDropped(duplicate, {
      kind: "duplicate",
      taskId: kept,
      title: "Sign-in loops",
    });
    await writeBacks.taskDropped(another, {
      kind: "duplicate",
      taskId: randomUUID(),
      title: "Passkeys on the sign-in page",
    });

    expect(host.writes.filter(({ action }) => action === "comment")).toEqual([
      { action: "comment", number: 11, body: "Closed as a duplicate of #10." },
      {
        action: "comment",
        number: 12,
        body: "Closed as a duplicate of another Task in The Office: Passkeys on the sign-in page.",
      },
    ]);
  });

  it("keeps what GitHub refused, shows why, and tries it again at each check for 24 hours", async () => {
    setUp({ closeOnDrop: true });
    host.addIssue({ number: 3 });
    host.addIssue({ number: 4 });
    const taskId = await imported(3);
    const later = await imported(4);
    host.refusal = "GitHub refused to comment on #3 of office/tools (HTTP 403).";

    await writeBacks.taskDropped(taskId, { kind: "wont-fix" });

    expect(host.writes).toEqual([]);
    expect((await issueImport.linkOf(taskId))?.writeBackProblem).toBe(host.refusal);
    expect(published.filter((event) => event instanceof IssueLinkChanged)).toHaveLength(1);

    host.refusal = undefined;
    await schedule.advanceBy(ISSUE_WATCH_EVERY);
    await watch.check();
    expect(host.writes).toEqual([
      { action: "comment", number: 3, body: "Closed: won't fix." },
      { action: "close", number: 3 },
    ]);
    expect((await issueImport.linkOf(taskId))?.writeBackProblem).toBeNull();

    // Refused for longer than a day, a write-back is given up.
    host.refusal = "GitHub couldn't be reached.";
    await writeBacks.taskDropped(later, null);
    host.refusal = undefined;
    await schedule.advanceBy(WRITE_BACK_RETRIED_FOR + 60_000);
    await watch.check();
    expect(host.writes.filter(({ number }) => number === 4)).toEqual([]);
  });
});

/** The Project as it reads once GitHub issues are switched off; its links stay. */
function switchOff(project: Project): void {
  projects.remove(project.id);
  projects.include({ ...project, features: { "github-issues": false } });
}

describe("with the Project's GitHub issues switched off", () => {
  /** Every issue switch on, so whatever stays quiet does so for the feature alone. */
  const ALL_ON = {
    autoImportLabel: "office",
    autoImportLabelSetBy: BOB,
    commentOnStartAndDone: true,
    closeOnDrop: true,
  };

  it("refuses listing and importing issues, naming the feature", async () => {
    setUp(ALL_ON, { features: { "github-issues": false } });
    host.addIssue({ number: 1 });

    await expect(issueImport.openIssues("tools")).rejects.toEqual(
      new FeatureSwitchedOff("github-issues", "Tools"),
    );
    await expect(issueImport.importByHand("tools", [1], ANN)).rejects.toBeInstanceOf(
      FeatureSwitchedOff,
    );
    expect(host.listings).toEqual([]);
    expect(created).toEqual([]);
  });

  it("the watch imports, reads and retries nothing, and the links stay", async () => {
    const project = setUp(ALL_ON);
    host.addIssue({ number: 1 });
    const taskId = await imported(1);
    host.refusal = "GitHub couldn't be reached.";
    await writeBacks.taskStarted(taskId, "Live view freezes");
    host.refusal = undefined;
    switchOff(project);
    host.addIssue({ number: 2, labels: ["office"] });
    host.closeOnHost(1);

    await watch.check();

    expect(host.listings).toEqual([]);
    expect(created).toHaveLength(1);
    expect(host.writes).toEqual([]);
    expect((await issueImport.linkOf(taskId))?.link).toMatchObject({
      number: 1,
      taskId,
      closedOnHostAt: null,
    });
  });

  it("writes nothing back on start, Done or Drop, and keeps none for later", async () => {
    const project = setUp(ALL_ON);
    host.addIssue({ number: 1 });
    host.addIssue({ number: 2 });
    const done = await imported(1);
    const dropped = await imported(2);
    switchOff(project);

    await writeBacks.taskStarted(done, "One");
    await writeBacks.taskDone(done);
    await writeBacks.taskDropped(dropped, { kind: "wont-fix" });

    expect(host.writes).toEqual([]);
    expect(links.writeBacks.size).toBe(0);
    // Their ends are still kept, so the watch reads neither issue once the feature is on again.
    expect([...links.links.values()].map(({ taskEndedAt }) => taskEndedAt)).toEqual([
      expect.any(Date),
      expect.any(Date),
    ]);
  });
});
