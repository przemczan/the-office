import { Controller, Get, Param, Query, UseFilters } from "@nestjs/common";
import {
  personTasksQuerySchema,
  type PersonTaskPage as PersonTaskPageResponse,
  type PersonTasksQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { pageRequested, toPageResponse } from "../../../../platform/http/page-cursors.js";
import { PersonTasks } from "../../application/person-tasks.js";
import { TaskResponses } from "./task-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/** A person's Work tab: the Tasks they have a part in, a page at a time. */
@Controller("roles")
@UseFilters(WorkRefusalsFilter)
export class PersonTasksController {
  constructor(
    private readonly personTasks: PersonTasks,
    private readonly responses: TaskResponses,
  ) {}

  /** A page of the person's Tasks in the Work filter, the newest created first, with the counts. */
  @Get(":roleKey/tasks")
  async list(
    @Param("roleKey") roleKey: string,
    @Query(new ContractPipe(personTasksQuerySchema)) { filter, project, after }: PersonTasksQuery,
  ): Promise<PersonTaskPageResponse> {
    const page = await this.personTasks.page({
      roleKey,
      filter,
      projects: project,
      page: pageRequested(after),
    });
    const respond = await this.responses.responder(page.rows.map(({ task }) => task));
    return {
      ...toPageResponse(page, ({ task, part }) => ({ task: respond(task), part })),
      counts: { ...page.counts },
      elsewhere: page.elsewhere,
    };
  }
}
