import { join } from "node:path";
import { Injectable, Module } from "@nestjs/common";
import { TaskThreadSetups } from "../../conversations/index.js";
import type { TaskLimit } from "../domain/task-start.js";
import { KnownPeople, type KnownPerson } from "./known-people.js";
import { KnownProjects, type KnownProject } from "./known-projects.js";
import { ProjectWorktrees, type TaskWorktree } from "./project-worktrees.js";
import { SessionPeople } from "./session-people.js";
import { SessionTasks } from "./session-tasks.js";
import { TaskDecisions } from "./task-decisions.js";
import { TaskThreads, type TaskThreadOpening } from "./task-threads.js";

/** The one Project id KnownProjectsForTests doesn't know. */
export const UNKNOWN_PROJECT = "no-such-project";

/** Knows every Project but UNKNOWN_PROJECT, each with Quick fix as its default Pipeline. */
@Injectable()
export class KnownProjectsForTests extends KnownProjects {
  async find(id: string): Promise<KnownProject | undefined> {
    if (id === UNKNOWN_PROJECT) return undefined;
    return {
      id,
      name: `The ${id}`,
      baseBranch: "main",
      defaultPipeline: "quick-fix",
      commands: { install: "npm install", build: "", lint: "npm run lint", test: "npm test" },
      useProjectSkills: true,
    };
  }
}

/** Each Task's worktree is under `/worktrees`; `opened` lists those made, as `projectId/taskId`. */
@Injectable()
export class ProjectWorktreesForTests extends ProjectWorktrees {
  readonly opened: string[] = [];
  /** Set to make opening a worktree fail with it. */
  failure: Error | undefined;
  /** Where every Project's worktrees are; a test sets a real folder to put files in them. */
  folder = "/worktrees";

  async open(projectId: string, taskId: string): Promise<TaskWorktree> {
    if (this.failure) throw this.failure;
    this.opened.push(`${projectId}/${taskId}`);
    return this.find(projectId, taskId);
  }

  async find(projectId: string, taskId: string): Promise<TaskWorktree> {
    return {
      path: join(this.folder, projectId, taskId),
      branch: `office/${taskId}`,
      environment: { PROJECT: projectId },
    };
  }
}

/**
 * Every Role is filled but those in `vacant`, by a person named after it ("The developer") whose
 * Task limit is in `taskLimits`, else 3.
 */
@Injectable()
export class KnownPeopleForTests extends KnownPeople {
  readonly vacant = new Set<string>();
  readonly taskLimits = new Map<string, TaskLimit>();

  async find(roleKey: string): Promise<KnownPerson | undefined> {
    if (this.vacant.has(roleKey)) return undefined;
    return {
      roleKey,
      card: { name: `The ${roleKey}`, taskLimit: this.taskLimits.get(roleKey) ?? 3 },
    };
  }
}

/** Each session is the Planner's, but UNKNOWN_SESSION. */
@Injectable()
export class SessionPeopleForTests extends SessionPeople {
  async personInSession(sessionId: string): Promise<string | undefined> {
    return sessionId === UNKNOWN_SESSION ? undefined : "planner";
  }
}

export const UNKNOWN_SESSION = "no-such-session";

/** Each session is on the Task a test puts it on, and on none otherwise, as a chat's is. */
@Injectable()
export class SessionTasksForTests extends SessionTasks {
  readonly tasks = new Map<string, string>();

  async taskInSession(sessionId: string): Promise<string | undefined> {
    return this.tasks.get(sessionId);
  }
}

/** Keeps each Thread opened on a Task, without a session; or fails, once `failure` is set. */
@Injectable()
export class TaskThreadsForTests extends TaskThreads {
  readonly opened: TaskThreadOpening[] = [];
  failure: Error | undefined;

  async startOnTask(opening: TaskThreadOpening): Promise<{ readonly id: string }> {
    if (this.failure) throw this.failure;
    this.opened.push(opening);
    return { id: crypto.randomUUID() };
  }
}

/** The Decisions open on each Task: none unless a test opens some. */
@Injectable()
export class TaskDecisionsForTests extends TaskDecisions {
  readonly open = new Map<string, number>();

  async openOn(taskId: string): Promise<number> {
    return this.open.get(taskId) ?? 0;
  }
}

const PORTS = [
  KnownProjectsForTests,
  ProjectWorktreesForTests,
  KnownPeopleForTests,
  SessionPeopleForTests,
  SessionTasksForTests,
  TaskThreadsForTests,
  TaskDecisionsForTests,
  TaskThreadSetups,
];

/** Provides them all, for `WorkModule.register({ imports: [this module] })`. */
@Module({ providers: PORTS, exports: PORTS })
export class WorkPortsForTestsModule {}
