import { Injectable } from "@nestjs/common";
import type { Task } from "../domain/task.js";
import { firstAgentStage, type StartConditions } from "../domain/task-start.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { WorkSettings } from "../ports/work-settings.js";

/** Gathers what Start weighs from the other modules: the Task's Pipeline, its person, the limit. */
@Injectable()
export class StartConditionsReader {
  constructor(
    private readonly pipelines: KnownPipelines,
    private readonly people: KnownPeople,
    private readonly settings: WorkSettings,
  ) {}

  async of(task: Task): Promise<StartConditions> {
    const [pipeline, officeWideLimit] = await Promise.all([
      this.pipelines.find(task.pipelineId),
      this.settings.officeWideLimit(),
    ]);
    const stage = pipeline && firstAgentStage(pipeline.stages);
    const person = stage && (await this.people.find(stage.role));
    return { stages: pipeline?.stages, person: person?.card, officeWideLimit };
  }
}
