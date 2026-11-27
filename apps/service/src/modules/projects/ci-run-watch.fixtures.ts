import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { startTestApplication } from "../../../test/test-application.js";
import type { DomainEvent } from "../../platform/events/domain-event.js";
import { EventBus } from "../../platform/events/event-bus.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { officeIdentityForTests } from "../../platform/git-identity/office-identity.fixtures.js";
import { Schedule } from "../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../platform/schedule/schedule.fixtures.js";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import { OfficeToolRegistry } from "../engine/index.js";
import { GitHubModule } from "../github/index.js";
import { ProjectServerValues } from "../mcp-servers/index.js";
import { CommandLineGit } from "./adapters/git/command-line-git.js";
import { RepositoryLocks } from "./adapters/git/repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "./adapters/git/temporary-repository.fixtures.js";
import { GitHubCodeHost } from "./adapters/github/github-code-host.js";
import { CiRunsController } from "./adapters/http/ci-runs.controller.js";
import { ProjectOfficeActionsController } from "./adapters/http/project-office-actions.controller.js";
import { ProjectOfficeActions } from "./adapters/office-actions/project-office-actions.js";
import { CI_RUN_WATCH, CiRunWatch } from "./application/ci-run-watch.js";
import { CodeHosts } from "./application/code-hosts.js";
import { ActionWorkflows } from "./application/action-workflows.js";
import { WorkflowStarts } from "./application/workflow-starts.js";
import { ManualWorkflows } from "./application/manual-workflows.js";
import { IssueImport } from "./application/issue-import.js";
import { ProjectFeatures } from "./application/project-features.js";
import { ProjectImages } from "./application/project-images.js";
import { ProjectIssueHosts } from "./application/project-issue-hosts.js";
import { ProjectService } from "./application/project-service.js";
import { PullRequestActions } from "./application/pull-request-actions.js";
import { RepositoryFiles } from "./application/repository-files.js";
import { RunEnvironmentSetUpRegistry } from "./application/run-environment-set-up-registry.js";
import { SessionPeople } from "./application/session-people.js";
import { PullRequestRepository } from "./ports/pull-request-repository.js";
import { aProject } from "./domain/project.fixtures.js";
import type { Project } from "./domain/project.js";
import { ActionRepository } from "./ports/action-repository.js";
import { InMemoryActionRepository } from "./ports/action-repository.fixtures.js";
import { Git } from "./ports/git.js";
import { ProjectRepository } from "./ports/project-repository.js";
import { OwnProjects, REPOSITORY, type SignedInGitHub } from "./pull-request-watch.fixtures.js";
import { RUN_EVERY_CALL } from "../engine/index.fixtures.js";

export { REPOSITORY } from "./pull-request-watch.fixtures.js";

/**
 * The CI run watch, its routes, the Workflows started by hand and Projects' Office actions on a
 * fake GitHub, signed in, over the test's own Projects, each with a base branch tracking
 * `REPOSITORY` there. The watch runs only when a test runs it.
 */
export class CiRunTestbed {
  private constructor(
    private readonly github: SignedInGitHub,
    readonly app: INestApplication,
    /** Where the app serves, such as `http://127.0.0.1:53124`. */
    readonly url: string,
    private readonly repositories: TemporaryRepository[],
    private readonly projects: OwnProjects,
    readonly watch: CiRunWatch,
    readonly schedule: ManualSchedule,
    /** Every event the watch published, in order. */
    readonly published: DomainEvent[],
    /** The test's Projects' Actions. */
    readonly actions: InMemoryActionRepository,
  ) {}

  static async create(github: SignedInGitHub): Promise<CiRunTestbed> {
    const projects = new OwnProjects([]);
    const actions = new InMemoryActionRepository();
    const { app, url } = await startTestApplication({
      database: true,
      imports: [
        EventsModule,
        EventStreamModule,
        ScheduleModule,
        GitHubModule.register(github.urls),
      ],
      controllers: [CiRunsController, ProjectOfficeActionsController],
      providers: [
        { provide: ProjectRepository, useValue: projects },
        { provide: ActionRepository, useValue: actions },
        {
          provide: Git,
          useValue: new CommandLineGit(new RepositoryLocks(), officeIdentityForTests()),
        },
        GitHubCodeHost,
        {
          provide: CodeHosts,
          inject: [GitHubCodeHost],
          useFactory: (gitHub: GitHubCodeHost) => new CodeHosts([gitHub]),
        },
        CiRunWatch,
        ManualWorkflows,
        WorkflowStarts,
        ActionWorkflows,
        OfficeToolRegistry,
        // What the other Office actions of Projects carry out with isn't used by these tests.
        ...[
          ProjectService,
          ProjectFeatures,
          ProjectImages,
          ProjectIssueHosts,
          IssueImport,
          RepositoryFiles,
          PullRequestActions,
          PullRequestRepository,
          ProjectServerValues,
        ].map((provide) => ({ provide, useValue: {} })),
        RunEnvironmentSetUpRegistry,
        SessionPeople,
        ProjectOfficeActions,
      ],
      overrides: [github.signIn],
    });
    const published: DomainEvent[] = [];
    app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
    return new CiRunTestbed(
      github,
      app,
      url,
      [],
      projects,
      app.get(CiRunWatch),
      app.get(Schedule) as ManualSchedule,
      published,
      actions,
    );
  }

  /** A Project of the test whose base branch tracks `repository` on the fake GitHub. */
  async aProject(repository = REPOSITORY): Promise<Project> {
    const folder = await createTemporaryRepository();
    this.repositories.push(folder);
    // main tracks the repository on the fake GitHub; nothing is fetched from it.
    gitIn(folder.path, "remote", "set-url", "origin", `${this.github.urls.web}/${repository}.git`);
    gitIn(folder.path, "config", "branch.main.remote", "origin");
    gitIn(folder.path, "config", "branch.main.merge", "refs/heads/main");
    const project = aProject({ id: `project-${randomUUID()}`, path: folder.path });
    this.projects.include(project);
    return project;
  }

  /** Puts `project` in place of the test's Project of its id, as a change of its settings does. */
  replace(project: Project): void {
    this.projects.remove(project.id);
    this.projects.include(project);
  }

  /** Runs the watch's round by the clock, as every `CI_RUN_WATCH_EVERY` does. */
  runRound(): Promise<void> {
    return this.schedule.runRepeating(CI_RUN_WATCH);
  }

  /** The Office tool of `name`, as a session would call it. */
  tool(name: string) {
    const [tool] = this.app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
    if (!tool) throw new Error(`No Office tool ${name}.`);
    return tool;
  }

  signOut(): Promise<void> {
    return this.github.signIn.useValue.replace(undefined);
  }

  /** Closes the app and removes the repositories; the test closes its fake GitHub. */
  async close(): Promise<void> {
    await this.app.close();
    for (const folder of this.repositories) await folder.remove();
  }
}
