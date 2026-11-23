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
  repositoryCloneStartSchema,
  type RepositoryClone as RepositoryCloneResponse,
  type RepositoryCloneStart,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { RepositoryClones } from "../../application/repository-clones.js";
import type { RepositoryClone } from "../../domain/repository-clone.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

@Controller("repositories/clones")
@UseFilters(ProjectRefusalsFilter)
export class RepositoryClonesController {
  constructor(private readonly clones: RepositoryClones) {}

  /** Answers as soon as the clone starts; its progress reaches the web as events. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async start(
    @Body(new ContractPipe(repositoryCloneStartSchema)) { url }: RepositoryCloneStart,
  ): Promise<RepositoryCloneResponse> {
    return toRepositoryCloneResponse(await this.clones.start(url));
  }

  @Get(":id")
  read(@Param("id") id: string): RepositoryCloneResponse {
    return toRepositoryCloneResponse(this.clones.read(id));
  }
}

function toRepositoryCloneResponse(clone: RepositoryClone): RepositoryCloneResponse {
  const fields = {
    id: clone.id,
    url: clone.url,
    path: clone.path,
    startedAt: clone.startedAt.toISOString(),
    ...(clone.finishedAt && { finishedAt: clone.finishedAt.toISOString() }),
  };
  switch (clone.state) {
    case "cloning":
      return {
        ...fields,
        state: clone.state,
        ...(clone.progress && {
          progress: {
            phase: clone.progress.phase,
            ...(clone.progress.percent !== undefined && { percent: clone.progress.percent }),
          },
        }),
      };
    case "cloned":
      return {
        ...fields,
        state: clone.state,
        defaultBranch: clone.defaultBranch ?? null,
        branches: [...clone.branches],
        empty: clone.empty,
      };
    case "failed":
      return { ...fields, state: clone.state, problem: clone.problem };
  }
}
