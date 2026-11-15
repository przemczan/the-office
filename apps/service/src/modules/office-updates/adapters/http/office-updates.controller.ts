import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseFilters,
} from "@nestjs/common";
import type {
  OfficeCommit as OfficeCommitResponse,
  OfficeUpdate,
  OfficeUpdateResult as OfficeUpdateResultResponse,
} from "@the-office/contracts";
import { OfficeUpdates, type OfficeUpdateView } from "../../application/office-updates.js";
import { shortCommit, type OfficeCommit } from "../../domain/office-commit.js";
import type { OfficeUpdateResult } from "../../domain/office-update-result.js";
import { OfficeUpdateRefusalsFilter } from "./office-update-refusals.filter.js";

/** Settings › Updates. */
@Controller("office-update")
@UseFilters(OfficeUpdateRefusalsFilter)
export class OfficeUpdatesController {
  constructor(private readonly updates: OfficeUpdates) {}

  @Get()
  async read(): Promise<OfficeUpdate> {
    return toOfficeUpdate(await this.updates.view());
  }

  /** Checks the upstream now and answers what it found. */
  @Post("check")
  async check(): Promise<OfficeUpdate> {
    await this.updates.check();
    return toOfficeUpdate(await this.updates.view());
  }

  @Post("schedule")
  @HttpCode(HttpStatus.NO_CONTENT)
  async schedule(): Promise<void> {
    await this.updates.schedule();
  }

  @Delete("schedule")
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(): Promise<void> {
    await this.updates.cancel();
  }

  /** The launcher's log of the last update, as plain text. */
  @Get("log")
  @Header("Content-Type", "text/plain; charset=utf-8")
  async log(): Promise<string> {
    const log = await this.updates.log();
    if (log === undefined) throw new NotFoundException("No Office update has left a log.");
    return log;
  }
}

function toOfficeUpdate({
  version,
  current,
  check,
  refusal,
  checking,
  scheduled,
  lastResult,
}: OfficeUpdateView): OfficeUpdate {
  return {
    ...(version && { version }),
    current: toCommit(current),
    ...(check && {
      check: {
        checkedAt: check.checkedAt.toISOString(),
        ...(check.newest && { newest: toCommit(check.newest) }),
        behind: check.behind.map(toCommit),
        ...(check.problem && { problem: check.problem }),
      },
    }),
    ...(refusal && { refusal }),
    checking,
    ...(scheduled && {
      scheduled: {
        target: toCommit(scheduled.target),
        scheduledAt: scheduled.scheduledAt.toISOString(),
        busy: scheduled.busy.map(({ kind, label }) => ({ kind, label })),
      },
    }),
    ...(lastResult && { lastResult: toResult(lastResult) }),
  };
}

function toCommit({ commit, subject, committedAt }: OfficeCommit): OfficeCommitResponse {
  return {
    commit,
    shortCommit: shortCommit(commit),
    subject,
    committedAt: committedAt.toISOString(),
  };
}

function toResult(result: OfficeUpdateResult): OfficeUpdateResultResponse {
  return { ...result, finishedAt: result.finishedAt.toISOString() };
}
