import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  actionRunSourceQuerySchema,
  actionRunStartSchema,
  type ActionRun as ActionRunResponse,
  type ActionRunLog,
  type ActionRunSourceQuery,
  type ActionRunSourceTip,
  type ActionRunStart,
  type ProjectActionRuns,
} from "@the-office/contracts";
import { z } from "zod";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { ActionRuns } from "../../application/action-runs.js";
import type { ActionRun } from "../../domain/action-run.js";
import { ActionRunRefusalsFilter } from "./action-run-refusals.filter.js";

const logQuerySchema = z.object({ from: z.coerce.number().int().min(0).default(0) });
type LogQuery = z.infer<typeof logQuerySchema>;

/**
 * The Project page's Actions (spec §2.15): each Action's runs, what a start would run, the start,
 * Stop and each run's log. Any signed-in user starts and stops them.
 */
@Controller()
@UseFilters(ActionRunRefusalsFilter)
export class ActionRunsController {
  constructor(private readonly runs: ActionRuns) {}

  @Get("projects/:id/actions/runs")
  async list(@Param("id") id: string): Promise<ProjectActionRuns> {
    const histories = await this.runs.list(id);
    return {
      actions: histories.map(({ actionKey, runs }) => ({
        actionKey,
        runs: runs.map(actionRunResponse),
      })),
    };
  }

  @Get("projects/:id/actions/source")
  source(
    @Param("id") id: string,
    @Query(new ContractPipe(actionRunSourceQuerySchema)) source: ActionRunSourceQuery,
  ): Promise<ActionRunSourceTip> {
    return this.runs.sourceTip(id, source);
  }

  @Post("projects/:id/actions/:key/runs")
  async start(
    @Param("id") id: string,
    @Param("key") key: string,
    @Body(new ContractPipe(actionRunStartSchema)) start: ActionRunStart,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ActionRunResponse> {
    return actionRunResponse(await this.runs.start(id, key, start, userOf(signedIn)));
  }

  @Post("action-runs/:id/stop")
  @HttpCode(200)
  async stop(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ActionRunResponse> {
    return actionRunResponse(await this.runs.stop(id, { kind: "by-user", user: userOf(signedIn) }));
  }

  @Get("action-runs/:id/log")
  async log(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ContractPipe(logQuerySchema)) { from }: LogQuery,
  ): Promise<ActionRunLog> {
    const { text, nextOffset, run } = await this.runs.readLog(id, from);
    return { text, nextOffset, status: run.status, outcome: run.outcome ?? null };
  }
}

export function actionRunResponse(run: ActionRun): ActionRunResponse {
  return {
    id: run.id,
    projectId: run.projectId,
    actionKey: run.actionKey,
    actionName: run.actionName,
    status: run.status,
    outcome: run.outcome ?? null,
    ranFrom: run.ranFrom,
    branch: run.branch,
    commit: run.commit ?? null,
    note: run.note ?? null,
    startedBy: run.startedBy,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    exitCode: run.exitCode ?? null,
    endedBecause: run.endedBecause ?? null,
    testInstanceId: run.testInstanceId ?? null,
    deviceName: run.deviceName ?? null,
    ciRun: run.ciRun ?? null,
    workflowRunsUrl: run.workflowRunsUrl ?? null,
  };
}
