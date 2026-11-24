import { Body, Controller, Get, Param, Post, Put, UseFilters } from "@nestjs/common";
import {
  runEnvironmentChangeSchema,
  taskStateSchema,
  type ProjectRunEnvironment as ProjectRunEnvironmentResponse,
  type RunEnvironmentChange,
  type RunEnvironmentSetUpAnswer,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { toOffBoardTaskStartResponse } from "../../../work/index.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import {
  ProjectRunEnvironments,
  type ProjectRunEnvironment,
} from "../../application/project-run-environments.js";
import { RunEnvironmentRefusalsFilter } from "./run-environment-refusals.filter.js";

/** A Project's Run environment setting and its set-up, for the Project page's Run environment. */
@Controller("projects/:id/run-environment")
@UseFilters(RunEnvironmentRefusalsFilter)
export class ProjectRunEnvironmentsController {
  constructor(private readonly runEnvironments: ProjectRunEnvironments) {}

  @Get()
  async read(@Param("id") id: string): Promise<ProjectRunEnvironmentResponse> {
    return toResponse(await this.runEnvironments.read(id));
  }

  @Put()
  async change(
    @Param("id") id: string,
    @Body(new ContractPipe(runEnvironmentChangeSchema)) { runEnvironment }: RunEnvironmentChange,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectRunEnvironmentResponse> {
    return toResponse(
      await this.runEnvironments.change(id, runEnvironment, {
        kind: "user",
        user: userOf(signedIn),
      }),
    );
  }

  /** On at once with a valid definition, else the start of its set-up Off-board Task. */
  @Post("set-up")
  async setUp(
    @Param("id") id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<RunEnvironmentSetUpAnswer> {
    const { runEnvironment, start } = await this.runEnvironments.setUp(id, userOf(signedIn));
    return {
      runEnvironment: toResponse(runEnvironment),
      start: start ? toOffBoardTaskStartResponse(start) : null,
    };
  }
}

function toResponse(runEnvironment: ProjectRunEnvironment): ProjectRunEnvironmentResponse {
  const { definition, setUpTask } = runEnvironment;
  return {
    runEnvironment: runEnvironment.runEnvironment,
    definition:
      definition.state === "not-valid"
        ? { state: "not-valid", problems: [...definition.problems] }
        : { state: definition.state },
    setUpProblems: [...runEnvironment.setUpProblems],
    setUpTask: setUpTask
      ? { id: setUpTask.id, title: setUpTask.title, state: taskStateSchema.parse(setUpTask.state) }
      : null,
  };
}
