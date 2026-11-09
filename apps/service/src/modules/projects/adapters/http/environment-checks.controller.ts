import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  environmentCheckStartSchema,
  type CommandRun as CommandRunResponse,
  type EnvironmentCheck as EnvironmentCheckResponse,
  type EnvironmentCheckStart,
  type LatestEnvironmentCheck,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { EnvironmentChecks } from "../../application/environment-checks.js";
import type { Check, CheckedCommandRun, EnvironmentCheck } from "../../domain/environment-check.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";
import { toEnvironmentResponse } from "./project-responses.js";

@Controller("projects/:id/environment-check")
@UseFilters(ProjectRefusalsFilter)
export class EnvironmentChecksController {
  constructor(private readonly environmentChecks: EnvironmentChecks) {}

  @Get()
  async latest(@Param("id") id: string): Promise<LatestEnvironmentCheck> {
    const check = await this.environmentChecks.latest(id);
    return { check: check ? toEnvironmentCheckResponse(check) : null };
  }

  /** Answers as soon as the check starts; its progress reaches the web as events. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async start(
    @Param("id") id: string,
    @Body(new ContractPipe(environmentCheckStartSchema)) { environment }: EnvironmentCheckStart,
  ): Promise<EnvironmentCheckResponse> {
    return toEnvironmentCheckResponse(await this.environmentChecks.start(id, environment));
  }
}

function toEnvironmentCheckResponse(check: EnvironmentCheck): EnvironmentCheckResponse {
  return {
    projectId: check.projectId,
    environment: toEnvironmentResponse(check.environment),
    state: check.state,
    checks: check.checks.map(toCheckResponse),
    startedAt: check.startedAt.toISOString(),
    ...(check.finishedAt && { finishedAt: check.finishedAt.toISOString() }),
  };
}

function toCheckResponse(check: Check): EnvironmentCheckResponse["checks"][number] {
  if (check.step === "worktree") {
    return {
      step: check.step,
      state: check.state,
      ...(check.base && {
        base: {
          commit: check.base.commit,
          ...(check.base.fetchedFrom !== undefined && { fetchedFrom: check.base.fetchedFrom }),
        },
      }),
      ...(check.problem !== undefined && { problem: check.problem }),
    };
  }
  return {
    step: check.step,
    state: check.state,
    commandLine: check.commandLine,
    ...(check.run && { run: toCommandRunResponse(check.run) }),
  };
}

function toCommandRunResponse(run: CheckedCommandRun): CommandRunResponse {
  return {
    commandLine: run.commandLine,
    outcome: run.outcome,
    ...(run.exitCode !== undefined && { exitCode: run.exitCode }),
    durationMs: run.durationMs,
    output: run.output,
  };
}
