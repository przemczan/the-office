import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  memoryNoteDraftSchema,
  type Memory as MemoryResponse,
  type MemoryNote as MemoryNoteResponse,
  type MemoryNoteDraft as MemoryNoteDraftRequest,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { MemoryService } from "../../application/memory-service.js";
import type { MemoryNote } from "../../domain/memory-note.js";
import { RoleRefusalsFilter } from "./role-refusals.filter.js";

@Controller("roles/:key/memory")
@UseFilters(RoleRefusalsFilter)
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Get()
  async read(@Param("key") key: string): Promise<MemoryResponse> {
    const { inUse, notes } = await this.memory.read(key);
    return { inUse, notes: notes.map(toNoteResponse) };
  }

  @Post()
  async write(
    @Param("key") key: string,
    @Body(new ContractPipe(memoryNoteDraftSchema)) { text, projectId }: MemoryNoteDraftRequest,
  ): Promise<MemoryNoteResponse> {
    const note = await this.memory.write({
      roleKey: key,
      projectId,
      text,
      source: { kind: "user" },
    });
    return toNoteResponse(note);
  }

  @Delete(":noteId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("key") key: string, @Param("noteId") noteId: string): Promise<void> {
    await this.memory.remove(key, noteId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(@Param("key") key: string): Promise<void> {
    await this.memory.clear(key);
  }
}

function toNoteResponse(note: MemoryNote): MemoryNoteResponse {
  return {
    id: note.id,
    projectId: note.projectId,
    text: note.text,
    source:
      note.source.kind === "user"
        ? note.source
        : { kind: "agent", threadId: note.source.threadId, taskId: note.source.taskId },
    writtenAt: note.writtenAt.toISOString(),
  };
}
