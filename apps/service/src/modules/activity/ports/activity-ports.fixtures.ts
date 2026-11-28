import { Injectable, Module } from "@nestjs/common";
import type {
  ActivityActionRun,
  ActivityCiRun,
  ActivityDevice,
  ActivityEnvironmentCheck,
  ActivityOffBoardTask,
  ActivityStage,
  ActivityThreadSession,
  ActivityTask,
  ActivityTestInstance,
} from "../domain/activity.js";
import { ActivityCiRuns } from "./activity-ci-runs.js";
import { ActivityDecisions } from "./activity-decisions.js";
import { ActivityDevices } from "./activity-devices.js";
import { ActivityEnvironmentChecks } from "./activity-environment-checks.js";
import { ActivityOffBoardTasks } from "./activity-off-board-tasks.js";
import { ActivityInitiatives } from "./activity-initiatives.js";
import { ActivitySessions } from "./activity-sessions.js";
import { ActivityStages } from "./activity-stages.js";
import { ActivityTasks } from "./activity-tasks.js";
import { ActivityTestInstances } from "./activity-test-instances.js";
import { ActivityActionRuns } from "./activity-action-runs.js";

/** Work's Tasks as a test sets them: `tasks` holds every Task, open or Done. */
@Injectable()
export class ActivityTasksForTests extends ActivityTasks {
  tasks: ActivityTask[] = [];

  started(): Promise<readonly ActivityTask[]> {
    return Promise.resolve(
      this.tasks.filter(({ state }) => ["in-progress", "waiting-on-you", "paused"].includes(state)),
    );
  }

  findAll(ids: readonly string[]): Promise<readonly ActivityTask[]> {
    return Promise.resolve(this.tasks.filter(({ id }) => ids.includes(id)));
  }
}

/** Work's Initiatives as a test sets them: each Initiative id with its title. */
@Injectable()
export class ActivityInitiativesForTests extends ActivityInitiatives {
  titles = new Map<string, string>();

  titlesOf(
    ids: readonly string[],
  ): Promise<readonly { readonly initiativeId: string; readonly title: string }[]> {
    return Promise.resolve(
      ids.flatMap((initiativeId) => {
        const title = this.titles.get(initiativeId);
        return title === undefined ? [] : [{ initiativeId, title }];
      }),
    );
  }
}

/** Conversations' sessions as a test sets them: a user's own, else `sessions`, for every user. */
@Injectable()
export class ActivitySessionsForTests extends ActivitySessions {
  sessions: ActivityThreadSession[] = [];
  sessionsOfUser = new Map<string, ActivityThreadSession[]>();

  sessionsFor(userId: string): Promise<readonly ActivityThreadSession[]> {
    return Promise.resolve(this.sessionsOfUser.get(userId) ?? this.sessions);
  }
}

@Injectable()
export class ActivityStagesForTests extends ActivityStages {
  stages = new Map<string, ActivityStage[]>();

  progress(taskId: string): Promise<{ readonly stages: readonly ActivityStage[] } | undefined> {
    const stages = this.stages.get(taskId);
    return Promise.resolve(stages ? { stages } : undefined);
  }
}

@Injectable()
export class ActivityDecisionsForTests extends ActivityDecisions {
  openOnTaskIds: string[] = [];

  listOpen(): Promise<readonly { readonly taskId?: string | undefined }[]> {
    return Promise.resolve(this.openOnTaskIds.map((taskId) => ({ taskId })));
  }
}

@Injectable()
export class ActivityOffBoardTasksForTests extends ActivityOffBoardTasks {
  offBoardTasks: ActivityOffBoardTask[] = [];

  listAll(): Promise<readonly ActivityOffBoardTask[]> {
    return Promise.resolve(this.offBoardTasks);
  }
}

@Injectable()
export class ActivityTestInstancesForTests extends ActivityTestInstances {
  instances: ActivityTestInstance[] = [];

  activity(): Promise<readonly ActivityTestInstance[]> {
    return Promise.resolve(this.instances);
  }
}

@Injectable()
export class ActivityActionRunsForTests extends ActivityActionRuns {
  runs: ActivityActionRun[] = [];

  runningCommandRuns(): Promise<readonly ActivityActionRun[]> {
    return Promise.resolve(this.runs);
  }
}

@Injectable()
export class ActivityCiRunsForTests extends ActivityCiRuns {
  runs: ActivityCiRun[] = [];

  list(): { readonly runs: readonly ActivityCiRun[] } {
    return { runs: this.runs };
  }
}

@Injectable()
export class ActivityEnvironmentChecksForTests extends ActivityEnvironmentChecks {
  checks: ActivityEnvironmentCheck[] = [];

  latestOfAll(): Promise<readonly ActivityEnvironmentCheck[]> {
    return Promise.resolve(this.checks);
  }
}

@Injectable()
export class ActivityDevicesForTests extends ActivityDevices {
  devices: ActivityDevice[] = [];

  open(): Promise<readonly ActivityDevice[]> {
    return Promise.resolve(this.devices);
  }
}

const PORTS = [
  ActivityTasksForTests,
  ActivityInitiativesForTests,
  ActivitySessionsForTests,
  ActivityStagesForTests,
  ActivityDecisionsForTests,
  ActivityOffBoardTasksForTests,
  ActivityTestInstancesForTests,
  ActivityActionRunsForTests,
  ActivityCiRunsForTests,
  ActivityEnvironmentChecksForTests,
  ActivityDevicesForTests,
];

/** Every Activity port, in memory, for `ActivityModule.register(ACTIVITY_PORTS_FOR_TESTS)`. */
@Module({ providers: PORTS, exports: PORTS })
export class ActivityPortsForTestsModule {}

export const ACTIVITY_PORTS_FOR_TESTS = {
  imports: [ActivityPortsForTestsModule],
  tasks: ActivityTasksForTests,
  initiatives: ActivityInitiativesForTests,
  sessions: ActivitySessionsForTests,
  stages: ActivityStagesForTests,
  decisions: ActivityDecisionsForTests,
  offBoardTasks: ActivityOffBoardTasksForTests,
  testInstances: ActivityTestInstancesForTests,
  actionRuns: ActivityActionRunsForTests,
  ciRuns: ActivityCiRunsForTests,
  environmentChecks: ActivityEnvironmentChecksForTests,
  devices: ActivityDevicesForTests,
};

/** A Task for a test, In progress since `createdAt` unless a test says otherwise. */
export function activityTask(overrides: Partial<ActivityTask> = {}): ActivityTask {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    title: "Add a filter",
    projectId: "office",
    state: "in-progress",
    initiativeId: undefined,
    ...overrides,
  };
}
