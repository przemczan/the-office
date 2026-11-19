import { randomUUID } from "node:crypto";
import type { INestApplication, InjectionToken } from "@nestjs/common";
import { startTestApplication } from "../../../test/test-application.js";
import { EventBus } from "../../platform/events/event-bus.js";
import type { DomainEvent } from "../../platform/events/domain-event.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { officeIdentityForTests } from "../../platform/git-identity/office-identity.fixtures.js";
import { ManualSchedule } from "../../platform/schedule/schedule.fixtures.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import { GitHubModule, type GitHubUrls } from "../github/index.js";
import { CommandLineGit } from "./adapters/git/command-line-git.js";
import { RepositoryLocks } from "./adapters/git/repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "./adapters/git/temporary-repository.fixtures.js";
import { GitHubCodeHost } from "./adapters/github/github-code-host.js";
import { PostgresProjectRepository } from "./adapters/postgres/postgres-project-repository.js";
import { PostgresPullRequestRepository } from "./adapters/postgres/postgres-pull-request-repository.js";
import { CodeHosts } from "./application/code-hosts.js";
import { PULL_REQUEST_WATCH, PullRequestWatch } from "./application/pull-request-watch.js";
import type { Project } from "./domain/project.js";
import { aProject } from "./domain/project.fixtures.js";
import type { ProjectChanges } from "./domain/project-changes.js";
import type { OpenedPullRequest } from "./ports/code-host.js";
import { ProjectRepository } from "./ports/project-repository.js";

/** The repository on the fake GitHub every testbed's Project tracks. */
export const REPOSITORY = "office/tools";

/**
 * The Projects of one test file alone, as the watch lists them: every test file shares the
 * database, and another file's Projects aren't this watch's to read.
 */
class OwnProjects extends ProjectRepository {
  constructor(private own: readonly Project[]) {
    super();
  }

  /** The Project removed, as Remove Project does. */
  remove(id: string): void {
    this.own = this.own.filter((project) => project.id !== id);
  }

  add(): Promise<void> {
    return Promise.reject(new Error("The watch adds no Project."));
  }

  find(id: string): Promise<Project | undefined> {
    return Promise.resolve(this.own.find((project) => project.id === id));
  }

  list(): Promise<readonly Project[]> {
    return Promise.resolve(this.own);
  }

  update(): Promise<ProjectChanges> {
    return Promise.reject(new Error("The watch changes no Project."));
  }
}

/**
 * The fake GitHub a test started, with `REPOSITORY` installed, and the sign-in on it it made with
 * `signedInWithGitHubForTests`: only a test reaches the github module's fixtures.
 */
export interface SignedInGitHub {
  readonly urls: GitHubUrls;
  readonly signIn: {
    readonly provide: InjectionToken;
    readonly useValue: { replace(signIn: undefined): Promise<void> };
  };
}

/**
 * The pull request watch on the test database and a fake GitHub, signed in, over one Project
 * whose base branch tracks `REPOSITORY` there. The watch runs only when a test runs it.
 */
export class PullRequestWatchTestbed {
  private constructor(
    private readonly github: SignedInGitHub,
    readonly app: INestApplication,
    readonly repository: TemporaryRepository,
    readonly project: Project,
    readonly watch: PullRequestWatch,
    readonly schedule: ManualSchedule,
    readonly codeHost: GitHubCodeHost,
    private readonly projects: OwnProjects,
    readonly records: PostgresPullRequestRepository,
    /** Every event the watch published, in order. */
    readonly published: DomainEvent[],
  ) {}

  static async create(github: SignedInGitHub): Promise<PullRequestWatchTestbed> {
    const { app } = await startTestApplication({
      database: true,
      imports: [EventsModule, EventStreamModule, GitHubModule.register(github.urls)],
      providers: [PostgresProjectRepository, PostgresPullRequestRepository, GitHubCodeHost],
      overrides: [github.signIn],
    });
    const repository = await createTemporaryRepository();
    // main tracks the repository on the fake GitHub; nothing is fetched from it.
    gitIn(repository.path, "remote", "set-url", "origin", `${github.urls.web}/${REPOSITORY}.git`);
    gitIn(repository.path, "config", "branch.main.remote", "origin");
    gitIn(repository.path, "config", "branch.main.merge", "refs/heads/main");
    const project = aProject({ id: `project-${randomUUID()}`, path: repository.path });
    await app.get(PostgresProjectRepository).add(project);
    const codeHost = app.get(GitHubCodeHost);
    const records = app.get(PostgresPullRequestRepository);
    const events = new EventBus();
    const published: DomainEvent[] = [];
    events.subscribeToEveryEvent((event) => void published.push(event));
    const schedule = new ManualSchedule();
    const projects = new OwnProjects([project]);
    const watch = new PullRequestWatch(
      projects,
      new CommandLineGit(new RepositoryLocks(), officeIdentityForTests()),
      new CodeHosts([codeHost]),
      records,
      events,
      schedule,
    );
    watch.onApplicationBootstrap();
    return new PullRequestWatchTestbed(
      github,
      app,
      repository,
      project,
      watch,
      schedule,
      codeHost,
      projects,
      records,
      published,
    );
  }

  get remoteUrl(): string {
    return `${this.github.urls.web}/${REPOSITORY}.git`;
  }

  /** Opens a pull request of `branch` into main on the fake GitHub, as Publish does. */
  open(branch: string, title = "Rename a device"): Promise<OpenedPullRequest> {
    return this.codeHost.open({
      remoteUrl: this.remoteUrl,
      baseBranch: "main",
      branch,
      title,
      body: "## Definition of Done",
    });
  }

  /** Runs the watch's round by the clock, as every minute does. */
  runRound(): Promise<void> {
    return this.schedule.runRepeating(PULL_REQUEST_WATCH);
  }

  /** The watch's Project removed from the list it reads; its rows stay. */
  removeProject(): void {
    this.projects.remove(this.project.id);
  }

  signOut(): Promise<void> {
    return this.github.signIn.useValue.replace(undefined);
  }

  /** Closes the app and removes the repository; the test closes its fake GitHub. */
  async close(): Promise<void> {
    await this.app.close();
    await this.repository.remove();
  }
}
