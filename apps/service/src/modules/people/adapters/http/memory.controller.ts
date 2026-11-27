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
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { MemoryService } from "../../application/memory-service.js";
import { MemoryTaskTitles } from "../../application/memory-task-titles.js";
import type { MemoryNote } from "../../domain/memory-note.js";
import { RoleRefusalsFilter } from "./role-refusals.filter.js";

@Controller("roles/:key/memory")
@UseFilters(RoleRefusalsFilter)
export class MemoryController {
  constructor(
    private readonly memory: MemoryService,
    private readonly taskTitles: MemoryTaskTitles,
  ) {}

  /** The notes, each written on a Task named by its title, all the Tasks read at once. */
  @Get()
  async read(@Param("key") key: string): Promise<MemoryResponse> {
    const { inUse, notes } = await this.memory.read(key);
    const titles = await this.taskTitles.titlesOf([...new Set(notes.flatMap(taskIdOf))]);
    return { inUse, notes: notes.map((note) => toNoteResponse(note, titles)) };
  }

  @Post()
  async write(
    @Param("key") key: string,
    @Body(new ContractPipe(memoryNoteDraftSchema)) { text, projectId }: MemoryNoteDraftRequest,
    @SignedIn() signedIn: SignedIn,
  ): Promise<MemoryNoteResponse> {
    const note = await this.memory.write({
      roleKey: key,
      projectId,
      text,
      source: { kind: "user", user: userOf(signedIn) },
    });
    return toNoteResponse(note);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(@Param("key") key: string): Promise<void> {
    await this.memory.clear(key);
  }
}

function toNoteResponse(
  note: MemoryNote,
  taskTitles: ReadonlyMap<string, string> = new Map(),
): MemoryNoteResponse {
  const { source } = note;
  return {
    id: note.id,
    projectId: note.projectId,
    text: note.text,
    source:
      source.kind === "user"
        ? { kind: "user", user: source.user && { ...source.user } }
        : {
            kind: "agent",
            threadId: source.threadId,
            taskId: source.taskId,
            taskTitle: source.taskId === undefined ? undefined : taskTitles.get(source.taskId),
          },
    writtenAt: note.writtenAt.toISOString(),
  };
}

function taskIdOf({ source }: MemoryNote): string[] {
  return source.kind === "agent" && source.taskId !== undefined ? [source.taskId] : [];
}
