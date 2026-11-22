import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  branchDeletionRequestSchema,
  type BranchDeletionPreview as BranchDeletionPreviewResponse,
  type BranchDeletionRefusal,
  type BranchDeletionRequest,
  type InitiativeKnownBranches,
  type TaskBranch,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { BranchCleanup } from "../../application/branch-cleanup.js";
import type {
  BranchDeletion,
  BranchDeletionPreview,
} from "../../ports/project-branch-deletions.js";
import { authorOf } from "./signed-in-author.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/**
 * Delete branch… on the Task and Initiative pages (spec 5.5, "Deleting merged branches"): plain
 * routes for the signed-in user, never Office actions, as deleting work isn't an Agent's call. A
 * refused deletion answers 409 `{ reason }`.
 */
@Controller()
@UseFilters(WorkRefusalsFilter)
export class BranchDeletionsController {
  constructor(private readonly cleanup: BranchCleanup) {}

  @Get("tasks/:id/branch")
  async taskBranch(@Param("id", ParseUUIDPipe) id: string): Promise<TaskBranch> {
    return { branch: await this.cleanup.branchOf(id) };
  }

  @Get("tasks/:id/branch-deletion")
  async taskPreview(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<BranchDeletionPreviewResponse> {
    return toPreviewResponse(await this.cleanup.previewOfTask(id));
  }

  @Post("tasks/:id/branch-deletion")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTaskBranch(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(branchDeletionRequestSchema)) request: BranchDeletionRequest,
    @SignedIn() signedIn: SignedIn,
  ): Promise<void> {
    answer(await this.cleanup.deleteOfTask(id, request, authorOf(signedIn)));
  }

  @Get("initiatives/:id/branches")
  async initiativeBranches(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<InitiativeKnownBranches> {
    return { branches: [...(await this.cleanup.branchesOf(id))] };
  }

  @Get("initiatives/:id/projects/:projectId/branch-deletion")
  async initiativePreview(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("projectId") projectId: string,
  ): Promise<BranchDeletionPreviewResponse> {
    return toPreviewResponse(await this.cleanup.previewOfInitiative(id, projectId));
  }

  @Post("initiatives/:id/projects/:projectId/branch-deletion")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteInitiativeBranch(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("projectId") projectId: string,
    @Body(new ContractPipe(branchDeletionRequestSchema)) request: BranchDeletionRequest,
    @SignedIn() signedIn: SignedIn,
  ): Promise<void> {
    answer(await this.cleanup.deleteOfInitiative(id, projectId, request, authorOf(signedIn)));
  }
}

function answer(deletion: BranchDeletion): void {
  if (deletion.kind === "refused") {
    const refusal: BranchDeletionRefusal = { reason: deletion.reason };
    throw new ConflictException(refusal);
  }
}

function toPreviewResponse(preview: BranchDeletionPreview): BranchDeletionPreviewResponse {
  return {
    ...preview,
    copies: [...preview.copies],
    holdsWork: preview.holdsWork && {
      ...preview.holdsWork,
      subjects: [...preview.holdsWork.subjects],
      unpublishedTaskTitles: [...preview.holdsWork.unpublishedTaskTitles],
    },
  };
}
