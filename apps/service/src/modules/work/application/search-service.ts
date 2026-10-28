import { Injectable } from "@nestjs/common";
import type { Attachment, AttachmentOwner } from "../domain/attachment.js";
import type { Idea } from "../domain/idea.js";
import type { Initiative } from "../domain/initiative.js";
import { initiativeProjectIds, tasksByInitiative } from "../domain/initiative-changes.js";
import { boardOrder } from "../domain/manual-order.js";
import { SEARCH_RESULT_LIMIT, searchWords } from "../domain/search.js";
import type { Task } from "../domain/task.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { TaskRepository } from "../ports/task-repository.js";
import { WorkSearch } from "../ports/work-search.js";

/** A record a search found, with the Projects it is in: none for one Office-wide. */
export interface Found<Record> {
  readonly record: Record;
  readonly projectIds: readonly string[];
}

/** What a search across The Office found, by kind, the best matches first. */
export interface SearchResults {
  readonly tasks: readonly Found<Task>[];
  readonly ideas: readonly Found<Idea>[];
  readonly initiatives: readonly Found<Initiative>[];
  /** Document Attachments, in their owner's Projects. */
  readonly documents: readonly Found<Attachment>[];
}

const NOTHING_FOUND: SearchResults = { tasks: [], ideas: [], initiatives: [], documents: [] };

/** Both searches, the board's and the top bar's, over the one full-text search (spec §2.1). */
@Injectable()
export class SearchService {
  constructor(
    private readonly search: WorkSearch,
    private readonly tasks: TaskRepository,
    private readonly ideas: IdeaRepository,
  ) {}

  /** The board's Tasks matching `query`, in the board's order; every Task for no words. */
  async tasksMatching(query: string): Promise<readonly Task[]> {
    const board = (await this.tasks.list()).toSorted(boardOrder);
    const words = searchWords(query);
    if (words.length === 0) return board;
    const matching = await this.search.matchingTaskIds(words);
    return board.filter(({ id }) => matching.has(id));
  }

  /** Nothing for no words. */
  async everything(query: string): Promise<SearchResults> {
    const words = searchWords(query);
    if (words.length === 0) return NOTHING_FOUND;
    const [matches, board, ideas] = await Promise.all([
      this.search.matches(words, SEARCH_RESULT_LIMIT),
      this.tasks.list(),
      this.ideas.list(),
    ]);
    const projects = new ProjectsOf(board, ideas);
    return {
      tasks: matches.tasks.map((task) => ({ record: task, projectIds: [task.projectId] })),
      ideas: matches.ideas.map((idea) => ({ record: idea, projectIds: projects.ofIdea(idea.id) })),
      initiatives: matches.initiatives.map((initiative) => ({
        record: initiative,
        projectIds: projects.ofInitiative(initiative.id),
      })),
      documents: matches.documents.map((document) => ({
        record: document,
        projectIds: projects.ofOwner(document.owner),
      })),
    };
  }
}

/** The Projects of each record, from the board and the Ideas as read once for a search. */
class ProjectsOf {
  private readonly tasks: ReadonlyMap<string, Task>;
  private readonly ideas: ReadonlyMap<string, Idea>;
  private readonly initiativeTasks: ReadonlyMap<string, readonly Task[]>;

  constructor(board: readonly Task[], ideas: readonly Idea[]) {
    this.tasks = new Map(board.map((task) => [task.id, task]));
    this.ideas = new Map(ideas.map((idea) => [idea.id, idea]));
    this.initiativeTasks = tasksByInitiative(board);
  }

  ofIdea(ideaId: string): string[] {
    const projectId = this.ideas.get(ideaId)?.projectId;
    return projectId ? [projectId] : [];
  }

  ofInitiative(initiativeId: string): string[] {
    return initiativeProjectIds(this.initiativeTasks.get(initiativeId) ?? []);
  }

  ofOwner(owner: AttachmentOwner): string[] {
    switch (owner.kind) {
      case "idea":
        return this.ofIdea(owner.ideaId);
      case "initiative":
        return this.ofInitiative(owner.initiativeId);
      case "task": {
        const task = this.tasks.get(owner.taskId);
        return task ? [task.projectId] : [];
      }
    }
  }
}
