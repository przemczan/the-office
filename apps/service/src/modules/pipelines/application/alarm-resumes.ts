import { Injectable } from "@nestjs/common";
import { asFlow, pipelineOrder } from "../domain/flow.js";
import { taskResumeOf, walkAhead, type TaskResume } from "../domain/alarm-resume.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskRecords } from "../ports/task-records.js";
import { AgentStageRunner } from "./agent-stage-runner.js";
import { RoleFillings } from "./role-fillings.js";
import { TaskStagesService } from "./task-stages-service.js";
import { runsOfLatestStart } from "../domain/start-over.js";

/**
 * How each Task the fire alarm paused would go on at the all clear, and at what cost (spec §2.8):
 * what Now's plan shows before the user gives it. An Agent Stage's session is decided as the
 * Stage would decide it if it began now, through the Context policy.
 */
@Injectable()
export class AlarmResumes {
  constructor(
    private readonly taskStages: TaskStagesService,
    private readonly runs: StageRunRepository,
    private readonly records: TaskRecords,
    private readonly agents: AgentStageRunner,
    private readonly roleFillings: RoleFillings,
  ) {}

  /**
   * Undefined while the Stage the alarm holds is still stopping. A Task with no Stages of its own
   * yet starts its first Stage as it resumes, which the walk decides then.
   */
  async of(taskId: string): Promise<TaskResume | undefined> {
    const own = await this.taskStages.find(taskId);
    if (!own) return taskResumeOf({ kind: "goes-on", stage: undefined }, undefined);
    const runs = runsOfLatestStart(await this.runs.list(taskId));
    const stages = pipelineOrder(asFlow(await this.roleFillings.staffed(own.stages, runs)));
    const { definitionOfDone } = await this.records.read(taskId);
    const ahead = walkAhead(stages, runs, definitionOfDone);
    const session =
      ahead.kind === "agent"
        ? await this.agents.sessionAhead(taskId, {
            stage: ahead.stage,
            stages,
            earlierRuns: runs,
          })
        : undefined;
    return taskResumeOf(ahead, session);
  }
}
