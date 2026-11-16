import { Injectable } from "@nestjs/common";
import type { Attachment, AttachmentOwner } from "../domain/attachment.js";
import type { Idea } from "../domain/idea.js";
import { initiativeProjectIds, type Initiative } from "../domain/initiative.js";
import { tasksByInitiative } from "../domain/initiative-changes.js";
import { boardOrder } from "../domain/manual-order.js";
import { isInProjectFilter, type ProjectFilter } from "../domain/project-filter.js";
import { idPrefixOf, SEARCH_RESULT_LIMIT, searchWords } from "../domain/search.js";
import type { Task } from "../domain/task.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { TaskRepository } from "../ports/task-repository.js";
import { WorkSearch, type IdMatches } from "../ports/work-search.js";

/** A record a search found, with the Projects it is in: none for one Office-wide. */
export interface Found<Record> {
  readonly record: Record;
  readonly projectIds: readonly string[];
}

/** How many more matches of each kind the Project filter leaves out. */
export interface InOtherProjects {
  readonly tasks: number;
  readonly ideas: number;
  readonly initiatives: number;
  readonly documents: number;
}

/**
 * What a search across The Office found in the Projects the Project filter shows, by kind, the
 * best matches first; and how many more match in other Projects.
 */
export interface SearchResults {
  readonly tasks: readonly Found<Task>[];
  readonly ideas: readonly Found<Idea>[];
  readonly initiatives: readonly Found<Initiative>[];
  /** Document Attachments, in their owner's Projects. */
  readonly documents: readonly Found<Attachment>[];
  readonly inOtherProjects: InOtherProjects;
}

const NOTHING_FOUND: SearchResults = {
  tasks: [],
  ideas: [],
  initiatives: [],
  documents: [],
  inOtherProjects: { tasks: 0, ideas: 0, initiatives: 0, documents: 0 },
};

/** Both searches, the board's and the top bar's, over the one full-text search (spec §2.1). */
@Injectable()
export class SearchService {
  constructor(
    private readonly search: WorkSearch,
    private readonly tasks: TaskRepository,
    private readonly ideas: IdeaRepository,
  ) {}

  /**
   * The board's Tasks matching `query` by its words or as the start of their ID, in the board's
   * order; every Task for no words.
   */
  async tasksMatching(query: string): Promise<readonly Task[]> {
    const board = (await this.tasks.list()).toSorted(boardOrder);
    const words = searchWords(query);
    if (words.length === 0) return board;
    const [matching, byId] = await Promise.all([
      this.search.matchingTaskIds(words),
      this.startingWithId(query),
    ]);
    const byIdIds = new Set(byId.tasks.map(({ id }) => id));
    return board.filter(({ id }) => matching.has(id) || byIdIds.has(id));
  }

  /**
   * The records whose ID starts with `query` first, then those its words match; nothing for no
   * words.
   */
  async everything(query: string, filter: ProjectFilter): Promise<SearchResults> {
    const words = searchWords(query);
    if (words.length === 0) return NOTHING_FOUND;
    const [byId, byWords, board, ideas] = await Promise.all([
      this.startingWithId(query),
      this.search.matches(words),
      this.tasks.list(),
      this.ideas.list(),
    ]);
    const projects = new ProjectsOf(board, ideas);
    const tasks = narrowed(
      firstOfEach(byId.tasks, byWords.tasks).map((task) => ({
        record: task,
        projectIds: [task.projectId],
      })),
      filter,
    );
    const foundIdeas = narrowed(
      firstOfEach(byId.ideas, byWords.ideas).map((idea) => ({
        record: idea,
        projectIds: projects.ofIdea(idea.id),
      })),
      filter,
    );
    const initiatives = narrowed(
      firstOfEach(byId.initiatives, byWords.initiatives).map((initiative) => ({
        record: initiative,
        projectIds: projects.ofInitiative(initiative.id),
      })),
      filter,
    );
    const documents = narrowed(
      byWords.documents.map((document) => ({
        record: document,
        projectIds: projects.ofOwner(document.owner),
      })),
      filter,
    );
    return {
      tasks: tasks.shown,
      ideas: foundIdeas.shown,
      initiatives: initiatives.shown,
      documents: documents.shown,
      inOtherProjects: {
        tasks: tasks.inOtherProjects,
        ideas: foundIdeas.inOtherProjects,
        initiatives: initiatives.inOtherProjects,
        documents: documents.inOtherProjects,
      },
    };
  }

  /** Nothing when `query` isn't the start of an ID. */
  private async startingWithId(query: string): Promise<IdMatches> {
    const idPrefix = idPrefixOf(query);
    return idPrefix === undefined ? NO_ID_MATCHES : this.search.startingWithId(idPrefix);
  }
}

const NO_ID_MATCHES: IdMatches = { tasks: [], ideas: [], initiatives: [] };

/** Each record once, where it first comes: `first`'s records before the rest. */
function firstOfEach<Record extends { readonly id: string }>(
  first: readonly Record[],
  rest: readonly Record[],
): Record[] {
  const seen = new Set(first.map(({ id }) => id));
  return [...first, ...rest.filter(({ id }) => !seen.has(id))];
}

/**
 * The best matches the Project filter shows, at most `SEARCH_RESULT_LIMIT`, and how many it
 * leaves out. The filter narrows before the limit, so a narrow filter still finds its matches.
 */
function narrowed<Record>(
  found: readonly Found<Record>[],
  filter: ProjectFilter,
): { readonly shown: readonly Found<Record>[]; readonly inOtherProjects: number } {
  const shown = found.filter(({ projectIds }) => isInProjectFilter(projectIds, filter));
  return {
    shown: shown.slice(0, SEARCH_RESULT_LIMIT),
    inOtherProjects: found.length - shown.length,
  };
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
      case "thread":
        return [];
    }
  }
}
