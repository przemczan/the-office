import { Injectable } from "@nestjs/common";
import type { Attachment, AttachmentOwner } from "../domain/attachment.js";
import type { Idea } from "../domain/idea.js";
import { initiativeProjectIds, type Initiative } from "../domain/initiative.js";
import { tasksByInitiative } from "../domain/initiative-changes.js";
import { isInProjectFilter, type ProjectFilter } from "../domain/project-filter.js";
import { idPrefixOf, SEARCH_RESULT_LIMIT, searchWords, taskMatchOf } from "../domain/search.js";
import type { Task, TaskSummary } from "../domain/task.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { TaskRepository } from "../ports/task-repository.js";
import { WorkSearch, type IdMatches, type SearchMatches } from "../ports/work-search.js";

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
   * order; every Task on the board for no words.
   */
  tasksMatching(query: string): Promise<readonly TaskSummary[]> {
    return this.tasks.onTheBoard(taskMatchOf(query));
  }

  /**
   * The records whose ID starts with `query` first, then those its words match; nothing for no
   * words.
   */
  async everything(query: string, filter: ProjectFilter): Promise<SearchResults> {
    const words = searchWords(query);
    if (words.length === 0) return NOTHING_FOUND;
    const [byId, byWords, ideas] = await Promise.all([
      this.startingWithId(query),
      this.search.matches(words),
      this.ideas.list(),
    ]);
    const projects = new ProjectsOf(await this.tasksNamedBy(byId, byWords), ideas);
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

  /**
   * The Tasks the found Initiatives and documents are placed in Projects by: the found
   * Initiatives' Tasks, and the Tasks the found documents are attached to.
   */
  private async tasksNamedBy(
    byId: IdMatches,
    byWords: SearchMatches,
  ): Promise<readonly TaskSummary[]> {
    const initiativeIds = [...byId.initiatives, ...byWords.initiatives].map(({ id }) => id);
    const taskIds = byWords.documents.flatMap(({ owner }) =>
      owner.kind === "task" ? [owner.taskId] : [],
    );
    const [ofInitiatives, ownersOfDocuments] = await Promise.all([
      this.tasks.inInitiatives(initiativeIds),
      taskIds.length === 0 ? [] : this.tasks.findAll(taskIds),
    ]);
    return [
      ...new Map([...ofInitiatives, ...ownersOfDocuments].map((task) => [task.id, task])).values(),
    ];
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

/** The Projects of each record, from the Tasks and the Ideas as read once for a search. */
class ProjectsOf {
  private readonly tasks: ReadonlyMap<string, TaskSummary>;
  private readonly ideas: ReadonlyMap<string, Idea>;
  private readonly initiativeTasks: ReadonlyMap<string, readonly TaskSummary[]>;

  constructor(tasks: readonly TaskSummary[], ideas: readonly Idea[]) {
    this.tasks = new Map(tasks.map((task) => [task.id, task]));
    this.ideas = new Map(ideas.map((idea) => [idea.id, idea]));
    this.initiativeTasks = tasksByInitiative(tasks);
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
