import { Body, Controller, Get, Param, Put, UseFilters } from "@nestjs/common";
import {
  runEnvironmentChangeSchema,
  type ProjectRunEnvironment as ProjectRunEnvironmentResponse,
  type RunEnvironmentChange,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { ProjectRunEnvironments } from "../../application/project-run-environments.js";
import { toProjectRunEnvironmentResponse } from "./project-run-environment-response.js";
import { RunEnvironmentRefusalsFilter } from "./run-environment-refusals.filter.js";

/**
 * A Project's Run environment setting, for the Project page's Run environment; its set-up is the
 * Office action set_up_run_environment.
 */
@Controller("projects/:id/run-environment")
@UseFilters(RunEnvironmentRefusalsFilter)
export class ProjectRunEnvironmentsController {
  constructor(private readonly runEnvironments: ProjectRunEnvironments) {}

  @Get()
  async read(@Param("id") id: string): Promise<ProjectRunEnvironmentResponse> {
    return toProjectRunEnvironmentResponse(await this.runEnvironments.read(id));
  }

  @Put()
  async change(
    @Param("id") id: string,
    @Body(new ContractPipe(runEnvironmentChangeSchema)) { runEnvironment }: RunEnvironmentChange,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectRunEnvironmentResponse> {
    return toProjectRunEnvironmentResponse(
      await this.runEnvironments.change(id, runEnvironment, {
        kind: "user",
        user: userOf(signedIn),
      }),
    );
  }
}
