import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { moveAttachment } from "../domain/attachment-changes.js";
import type { Author } from "../domain/author.js";
import type { Idea } from "../domain/idea.js";
import { shapeIdeaIntoInitiative } from "../domain/idea-changes.js";
import { initiativeProjectIds, pipelineIn, type Initiative } from "../domain/initiative.js";
import {
  archiveInitiative,
  restoreInitiative,
  type ArchivePage,
  type ArchiveSearch,
} from "../domain/initiative-archive.js";
import {
  addShaperTask,
  addDependencyOfItsTask,
  addTaskToInitiative,
  blockingItsPublishingTask,
  changeDescriptionOfItsTask,
  changeTitleOfItsTask,
  chooseInitiativePipeline,
  createInitiative,
  dropInitiative,
  finishInitiative,
  removeDependencyOfItsTask,
  settleInitiative,
  tasksByInitiative,
  writeOutcome,
  writeShortName,
  type InitiativeChange,
  type InitiativeChangeRoute,
  type InitiativeTasksChange,
  type NewInitiative,
} from "../domain/initiative-changes.js";
import {
  initiativeEditProblems,
  newTaskOf,
  sameDescriptionWords,
  sameTitleWords,
  type InitiativeEdit,
} from "../domain/initiative-edit.js";
import { IdeaNotFound } from "../domain/idea-not-found.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import { InitiativeNotShaping } from "../domain/initiative-not-shaping.js";
import {
  initiativePipelineChangeProblems,
  startedPublishingTask,
} from "../domain/initiative-pipeline.js";
import {
  createPublishingTask,
  doneTasksIn,
  lastPublishedBy,
  publishingCandidates,
  swapPublishingPipeline,
  type PublishingProject,
} from "../domain/publishing-task.js";
import { initiativeBranchOf } from "../domain/short-name.js";
import { InitiativeRefused } from "../domain/initiative-refused.js";
import { orderAfter } from "../domain/manual-order.js";
import { initiativeRecordText, type InitiativeRecord } from "../domain/record-words.js";
import { searchWords } from "../domain/search.js";
import { NOBODY_SHAPES_INITIATIVES, SHAPES_INITIATIVES } from "../domain/duties.js";
import { SHAPING_THREAD_TITLE, shapingOpeningOf } from "../domain/shaping.js";
import { isPublishingTask, newTaskProblems, type NewTask, type Task } from "../domain/task.js";
import type { TaskChange } from "../domain/task-changes.js";
import { createdWaitingFor } from "../domain/task-dependencies.js";
import { TaskStateChanged } from "../domain/task-events.js";
import { NOT_STARTED_STATES } from "../domain/task-states.js";
import { AttachmentRepository } from "../ports/attachment-repository.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { InitiativeThreads } from "../ports/initiative-threads.js";
import { KnownPeople, type KnownPerson } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { taskPipelineProblems } from "../domain/pipeline-commands.js";
import { KnownProjects, type KnownProject } from "../ports/known-projects.js";
import { ProjectInitiativeBranches } from "../ports/project-initiative-branches.js";
import { ProposalDrafts } from "../ports/proposal-drafts.js";
import { TaskRepository } from "../ports/task-repository.js";
import { WorkSearch } from "../ports/work-search.js";
import { InitiativeBranching } from "./initiative-branching.js";
import { pipelineChoiceIn } from "./pipeline-choice.js";
import { TaskStageEdits } from "./task-stage-edits.js";

function requiredProject(
  projects: ReadonlyMap<string, PublishingProject>,
  projectId: string,
): PublishingProject {
  const project = projects.get(projectId);
  if (!project) throw new Error(`The Project ${projectId} to publish in wasn't read first.`);
  return project;
}

/**
 * A change by whoever shapes Initiatives as written straight onto the Initiative, or drafted as a
 * Proposal.
 */
export type ShaperChange =
  { readonly kind: "written"; readonly edit: InitiativeEdit } | { readonly kind: "proposed" };

/** An Initiative that names a Pipeline in one Project it spans, as the library weighs it. */
export interface InitiativeOnPipeline {
  readonly name: string;
  readonly state: Initiative["state"];
  readonly projectId: string;
  readonly pipelineId: string;
  /** Whether its Pipeline has started there, in that Project's Publishing Task. */
  readonly pipelineStarted: boolean;
}

/**
 * Who holds Shapes Initiatives as an Initiative is made, undefined while nobody does, and whether
 * its shaping Thread opened with them.
 */
export interface ShapingThreadOpening {
  readonly shaper: KnownPerson | undefined;
  readonly opened: boolean;
}

/**
 * The Initiatives use cases: shaped from an Idea or created from none, its outcome, Tasks, their
 * titles, Descriptions and dependencies written while shaping or by Proposals of whoever shapes
 * Initiatives once active, confirmed, dropped, and done once their Tasks are. Each change is saved
 * first and its events published after.
 */
@Injectable()
export class InitiativeService implements OnModuleInit {
  private readonly logger = new Logger(InitiativeService.name);

  constructor(
    private readonly repository: InitiativeRepository,
    private readonly ideas: IdeaRepository,
    private readonly tasks: TaskRepository,
    private readonly attachments: AttachmentRepository,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly branching: InitiativeBranching,
    private readonly branches: ProjectInitiativeBranches,
    private readonly stageEdits: TaskStageEdits,
    private readonly people: KnownPeople,
    private readonly threads: InitiativeThreads,
    private readonly proposals: ProposalDrafts,
    private readonly search: WorkSearch,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    // A Task ending can leave every other one Done; a Dropped one no longer counts.
    this.events.subscribe(TaskStateChanged, async ({ taskId, to }) => {
      if (to === "done" || to === "dropped") await this.settleAfter(taskId);
    });
  }

  /**
   * Makes the Idea an Initiative being shaped, the Idea's Attachments moving to it, and opens its
   * shaping Thread with whoever holds Shapes Initiatives. While nobody does, the user writes it by
   * hand, and starts its Thread once someone holds it (spec §2.1 Defaults, §2.2 "Duties").
   */
  async shape(ideaId: string, shapedBy: Author): Promise<Initiative> {
    const initiative = await this.shapeFromIdea(ideaId, shapedBy);
    await this.openShapingThreadIfHeld(initiative);
    return initiative;
  }

  /**
   * Creates an Initiative being shaped from no Idea, named and with its outcome written
   * (create_initiative, spec 2.1), and opens its shaping Thread as `shape` does. Answers who
   * shapes it and whether that Thread opened.
   */
  async create(
    setting: NewInitiative,
    createdBy: Author,
  ): Promise<{ readonly initiative: Initiative; readonly shaping: ShapingThreadOpening }> {
    const created = createInitiative(setting, randomUUID(), createdBy, new Date());
    await this.repository.insert(created);
    await this.events.publish(created.event);
    const shaping = await this.openShapingThreadIfHeld(created.initiative);
    return { initiative: created.initiative, shaping };
  }

  /**
   * Who holds Shapes Initiatives, and whether the shaping Thread opened with them: never while
   * nobody does, which the user sets in Settings › Duties and then starts it.
   */
  private async openShapingThreadIfHeld(initiative: Initiative): Promise<ShapingThreadOpening> {
    const shaperKey = await this.people.holderOf(SHAPES_INITIATIVES);
    const shaper = shaperKey === undefined ? undefined : await this.people.find(shaperKey);
    if (!shaper) return { shaper: undefined, opened: false };
    // An Initiative stands without its Thread, so one that couldn't open leaves the user to start
    // it.
    try {
      await this.openShapingThread(initiative, shaper.roleKey);
      return { shaper, opened: true };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`The Initiative ${initiative.id}'s shaping Thread couldn't open: ${reason}`);
      return { shaper, opened: false };
    }
  }

  /**
   * A new shaping Thread on the Initiative, where whoever holds Shapes Initiatives starts at once.
   * Refused for a done or dropped Initiative, and while nobody holds it.
   */
  async startShapingThread(id: string): Promise<{ readonly id: string }> {
    const initiative = await this.read(id);
    if (initiative.state === "done" || initiative.state === "dropped") {
      throw new InitiativeRefused([
        `The Initiative is ${initiative.state}: nothing is left to shape.`,
      ]);
    }
    const shaper = await this.people.holderOf(SHAPES_INITIATIVES);
    if (shaper === undefined) throw new InitiativeRefused([NOBODY_SHAPES_INITIATIVES]);
    return this.openShapingThread(initiative, shaper);
  }

  private async openShapingThread(
    initiative: Initiative,
    shaper: string,
  ): Promise<{ readonly id: string }> {
    return this.threads.startOnInitiative({
      initiativeId: initiative.id,
      roleKey: shaper,
      title: SHAPING_THREAD_TITLE,
      opening: shapingOpeningOf(initiative),
    });
  }

  private async shapeFromIdea(ideaId: string, shapedBy: Author): Promise<Initiative> {
    const initiativeId = randomUUID();
    const shaped = await this.ideas.shapeIntoInitiative(ideaId, (idea, attachments) => ({
      ...shapeIdeaIntoInitiative(idea, initiativeId, shapedBy, new Date()),
      moves: attachments.map((attachment) =>
        moveAttachment(attachment, { kind: "initiative", initiativeId }),
      ),
    }));
    const events: DomainEvent[] = [
      shaped.initiativeCreated.event,
      shaped.ideaShaped.event,
      ...shaped.moves.map((move) => move.event),
    ];
    for (const event of events) await this.events.publish(event);
    return shaped.initiativeCreated.initiative;
  }

  /**
   * Every Initiative matching `query` by its name and outcome, archived ones too, the newest first;
   * every Initiative for no words.
   */
  async list(query = ""): Promise<readonly Initiative[]> {
    const every = await this.repository.list();
    const words = searchWords(query);
    if (words.length === 0) return every;
    const matching = await this.search.matchingInitiativeIds(words);
    return every.filter(({ id }) => matching.has(id));
  }

  async read(id: string): Promise<Initiative> {
    const initiative = await this.repository.find(id);
    if (!initiative) throw new InitiativeNotFound(id);
    return initiative;
  }

  /**
   * Every Initiative's Tasks, by the Initiative's id, from one read of the board
   * (tasksByInitiative).
   */
  async tasksByInitiative(): Promise<ReadonlyMap<string, readonly Task[]>> {
    return tasksByInitiative(await this.tasks.list());
  }

  /**
   * The Initiative's record as an Agent reads it, in its Thread or mentioned in a chat. Throws
   * InitiativeNotFound when there is no such Initiative.
   */
  async recordText(id: string): Promise<string> {
    return initiativeRecordText(await this.record(id));
  }

  /**
   * What the Initiative's record and a planning Brief's Initiative section are worded from, from
   * one read of the board. Throws InitiativeNotFound when there is no such Initiative.
   */
  async record(id: string): Promise<InitiativeRecord> {
    const initiative = await this.read(id);
    const [idea, board, attachments] = await Promise.all([
      this.originIdeaOf(initiative),
      this.tasks.list(),
      this.attachments.listOf({ kind: "initiative", initiativeId: id }),
    ]);
    const tasks = tasksByInitiative(board).get(id) ?? [];
    const blockers = new Map(board.map((task) => [task.id, task]));
    const pipelineNames = await this.pipelineNamesOf(initiative);
    return { initiative, idea, tasks, blockers, attachments, pipelineNames };
  }

  /** The names of the Pipelines the Initiative has in its Projects, by id, those still known. */
  private async pipelineNamesOf(initiative: Initiative): Promise<ReadonlyMap<string, string>> {
    const ids = [...new Set(initiative.pipelines.flatMap(({ pipelineId }) => pipelineId ?? []))];
    const pipelines = await Promise.all(ids.map((pipelineId) => this.pipelines.read(pipelineId)));
    return new Map(
      pipelines.flatMap((pipeline) => (pipeline ? [[pipeline.id, pipeline.name]] : [])),
    );
  }

  /** The Idea it was shaped from; undefined for one created from none. */
  private async originIdeaOf({ originIdeaId }: Initiative): Promise<Idea | undefined> {
    if (originIdeaId === undefined) return undefined;
    const idea = await this.ideas.find(originIdeaId);
    if (!idea) throw new IdeaNotFound(originIdeaId);
    return idea;
  }

  /** Every Initiative's Pipeline in each Project it spans that has one. */
  async withPipelines(): Promise<readonly InitiativeOnPipeline[]> {
    const [every, byInitiative] = await Promise.all([
      this.repository.list(),
      this.tasksByInitiative(),
    ]);
    return every.flatMap((initiative) => {
      const tasks = byInitiative.get(initiative.id) ?? [];
      return initiativeProjectIds(tasks).flatMap((projectId) => {
        const pipelineId = pipelineIn(initiative, projectId);
        if (pipelineId === undefined) return [];
        const { name, state } = initiative;
        const pipelineStarted = startedPublishingTask(tasks, projectId) !== undefined;
        return [{ name, state, projectId, pipelineId, pipelineStarted }];
      });
    });
  }

  /**
   * Makes it active, its Tasks in Shaping moving to Backlog, with its branch made in each Project
   * when it has a Pipeline (InitiativeBranching); done at once when its Tasks already are.
   */
  async confirm(id: string, by: Author): Promise<Initiative> {
    const confirmed = await this.branching.confirm(id, by);
    return (await this.finishIfDone(id)) ?? confirmed;
  }

  /**
   * The Initiative's Pipeline in one Project it spans, null for None: by the user or whoever shapes
   * Initiatives straight onto it while it is being shaped, or by a Proposal of whoever shapes
   * Initiatives once active. Refused for a Project it doesn't span, and for a Pipeline that
   * Project's Tasks couldn't follow (spec 2.3): unknown, another Project's Project Pipeline,
   * Broken, or running a command the Project lacks.
   */
  async choosePipeline(
    id: string,
    projectId: string,
    pipelineId: string | null,
    route: InitiativeChangeRoute,
  ): Promise<Initiative> {
    const project = await this.spannedProject(id, projectId);
    const chosen = pipelineId ?? undefined;
    if (chosen !== undefined) {
      const choice = await pipelineChoiceIn(projectId, chosen, this.pipelines, this.projects);
      const problems = taskPipelineProblems(choice, project);
      if (problems.length > 0) throw new InitiativeRefused(problems);
    }
    const { initiative, event } = await this.repository.updateNaming(id, (held, taken) =>
      chooseInitiativePipeline(held, project, chosen, route, taken),
    );
    if (event) await this.events.publish(event);
    return initiative;
  }

  /** The user's own Short name, while it is being shaped with a Pipeline chosen. */
  async writeShortName(id: string, shortName: string): Promise<Initiative> {
    const { initiative, event } = await this.repository.updateNaming(id, (held, taken) =>
      writeShortName(held, shortName, taken),
    );
    if (event) await this.events.publish(event);
    return initiative;
  }

  /**
   * Every reason applying the shaper's Proposal of another Pipeline in one Project would be
   * refused now.
   */
  private async pipelineChangeProblems(
    initiative: Initiative,
    projectId: string,
    pipelineId: string | null,
  ): Promise<string[]> {
    const tasks = (await this.tasksByInitiative()).get(initiative.id) ?? [];
    const project = await this.spannedProjectIn(tasks, projectId);
    if (!project) return [notSpannedWords(projectId)];
    const choice =
      pipelineId === null
        ? undefined
        : await pipelineChoiceIn(projectId, pipelineId, this.pipelines, this.projects);
    return initiativePipelineChangeProblems(initiative, project, choice, tasks);
  }

  /** A Project the Initiative's Tasks span, still known; refused otherwise. */
  private async spannedProject(id: string, projectId: string): Promise<KnownProject> {
    const tasks = (await this.tasksByInitiative()).get(id) ?? [];
    const project = await this.spannedProjectIn(tasks, projectId);
    if (!project) throw new InitiativeRefused([notSpannedWords(projectId)]);
    return project;
  }

  /** The Project when one of the Initiative's `tasks` is in it and it is still known. */
  private async spannedProjectIn(
    tasks: readonly Task[],
    projectId: string,
  ): Promise<KnownProject | undefined> {
    if (!tasks.some((task) => task.projectId === projectId)) return undefined;
    return this.projects.find(projectId);
  }

  /**
   * Drops it, and every one of its Tasks not yet Done or Dropped with it. Each Task's
   * TaskStateChanged is published as its own Drop's is, so the queue lets a queued one go and a
   * started one's run stops.
   */
  async drop(id: string, by: Author): Promise<Initiative> {
    return this.updateWithTasks(id, (initiative, tasks) =>
      dropInitiative(initiative, tasks, new Date(), by),
    );
  }

  /** Takes a Done or Dropped Initiative off the board into the Archive; its state stays. */
  async archive(id: string, by: Author): Promise<Initiative> {
    return this.update(id, (initiative) => archiveInitiative(initiative, new Date(), by));
  }

  /** Puts an archived Initiative back on the board, for a full Archive period from now. */
  async restore(id: string, by: Author): Promise<Initiative> {
    return this.update(id, (initiative) => restoreInitiative(initiative, new Date(), by));
  }

  /** A page of the Archive for `query`, filtered and counted as ArchiveSearch says. */
  async archived(query: string, filters: Omit<ArchiveSearch, "words">): Promise<ArchivePage> {
    return this.repository.archived({ ...filters, words: searchWords(query) });
  }

  /**
   * What must be true once it is done: by the user, or by whoever shapes Initiatives, straight onto
   * it while it is being shaped, or by Proposal.
   */
  async writeOutcome(
    id: string,
    outcome: string,
    route: InitiativeChangeRoute,
  ): Promise<Initiative> {
    return this.update(id, (initiative) => writeOutcome(initiative, outcome, route));
  }

  /**
   * The user's new Task in the Initiative and the Project, following the Project's default
   * Pipeline, while the Initiative is shaping or active: in Shaping or Backlog, as the Initiative
   * stands. It waits for `blockedBy` from the start.
   */
  async addTask(
    id: string,
    given: NewTask,
    blockedBy: readonly string[],
    createdBy: Author,
  ): Promise<Task> {
    return this.createTask(id, given, createdBy, addTaskToInitiative, blockedBy);
  }

  /** A new Task by whoever shapes Initiatives, as `addTask`, by the route the change takes. */
  private async addShaperTask(
    id: string,
    given: NewTask,
    blockedBy: readonly string[],
    createdBy: Author,
    route: InitiativeChangeRoute,
  ): Promise<Task> {
    return this.createTask(
      id,
      given,
      createdBy,
      (initiative, ...made) => addShaperTask(initiative, route, ...made),
      blockedBy,
    );
  }

  /** Whoever shapes Initiatives makes one of its Tasks wait for `blockerId`, any Task anywhere. */
  private async addDependencyOfItsTask(
    id: string,
    taskId: string,
    blockerId: string,
    route: InitiativeChangeRoute,
  ): Promise<Task> {
    return this.changeDependencies(id, taskId, (initiative, task, tasks) =>
      addDependencyOfItsTask(initiative, route, task, blockerId, tasks),
    );
  }

  private async removeDependencyOfItsTask(
    id: string,
    taskId: string,
    blockerId: string,
    route: InitiativeChangeRoute,
  ): Promise<Task> {
    return this.changeDependencies(id, taskId, (initiative, task) =>
      removeDependencyOfItsTask(initiative, route, task, blockerId),
    );
  }

  /**
   * Every reason a Proposal of `edit` would be refused if the user applied it now, in words whoever
   * shapes Initiatives acts on: applying it judges again, under the Initiative's hold.
   */
  async problemsWithProposal(id: string, edit: InitiativeEdit): Promise<readonly string[]> {
    const initiative = await this.repository.find(id);
    if (!initiative) return [new InitiativeNotFound(id).message];
    if (edit.kind === "add-task" && !(await this.projects.find(edit.projectId))) {
      return [`There is no Project "${edit.projectId}".`];
    }
    if (edit.kind === "add-task") {
      const problems = await this.branching.newProjectProblems(id, edit.projectId);
      if (problems.length > 0) return problems;
    }
    if (edit.kind === "pipeline") {
      return this.pipelineChangeProblems(initiative, edit.projectId, edit.pipelineId);
    }
    return initiativeEditProblems(initiative, edit, await this.tasks.list());
  }

  /**
   * A change by whoever shapes Initiatives (spec §2.1 Defaults): straight onto the Initiative while
   * it is being shaped; once it is active, drafted as a Proposal in the Thread of `sessionId` for
   * the user to apply, refused with every reason applying it would be.
   */
  async changeByShaper(
    id: string,
    edit: InitiativeEdit,
    shaper: Author,
    sessionId: string,
  ): Promise<ShaperChange> {
    try {
      return { kind: "written", edit: await this.applyEdit(id, edit, shaper, "straight") };
    } catch (error) {
      if (!(error instanceof InitiativeNotShaping && error.state === "active")) throw error;
    }
    // Judged again here, outside the hold, as the Proposal's applier judges it while it is drafted.
    const problems = await this.problemsWithProposal(id, edit);
    if (problems.length > 0) throw new InitiativeRefused(problems);
    await this.proposals.draft(sessionId, { kind: "initiative", initiativeId: id, edit });
    return { kind: "proposed" };
  }

  /**
   * Carries out a Proposal of whoever shapes Initiatives the user applied, as proposed by
   * `proposedBy`, and answers the edit as applied: a new Task with its id. An edit that changes
   * nothing now holds already.
   */
  async applyProposal(
    id: string,
    edit: InitiativeEdit,
    proposedBy: Author,
  ): Promise<InitiativeEdit> {
    return this.applyEdit(id, edit, proposedBy, "by-proposal");
  }

  private async applyEdit(
    id: string,
    edit: InitiativeEdit,
    shaper: Author,
    route: InitiativeChangeRoute,
  ): Promise<InitiativeEdit> {
    switch (edit.kind) {
      case "outcome":
        await this.writeOutcome(id, edit.outcome, route);
        return edit;
      case "add-task": {
        const task = await this.addShaperTask(id, newTaskOf(edit), edit.blockedBy, shaper, route);
        return { ...edit, taskId: task.id };
      }
      case "add-dependency":
        await this.addDependencyOfItsTask(id, edit.taskId, edit.blockerId, route);
        return edit;
      case "remove-dependency":
        await this.removeDependencyOfItsTask(id, edit.taskId, edit.blockerId, route);
        return edit;
      case "task-title":
        await this.changeItsTask(
          id,
          edit.taskId,
          route,
          (initiative, task) => changeTitleOfItsTask(initiative, route, task, edit.title),
          sameTitleWords,
        );
        return edit;
      case "task-description":
        await this.changeItsTask(
          id,
          edit.taskId,
          route,
          (initiative, task) =>
            changeDescriptionOfItsTask(initiative, route, task, edit.description),
          sameDescriptionWords,
        );
        return edit;
      case "pipeline":
        await this.changePipeline(id, edit.projectId, edit.pipelineId, route);
        return edit;
    }
  }

  private async createTask(
    id: string,
    given: NewTask,
    createdBy: Author,
    create: typeof addTaskToInitiative,
    blockedBy: readonly string[],
  ): Promise<Task> {
    if (!(await this.projects.find(given.projectId))) {
      throw new InitiativeRefused([
        ...newTaskProblems(given),
        `There is no Project "${given.projectId}".`,
      ]);
    }
    await this.branching.forNewProject(id, given.projectId);
    const { created, blocking } = await this.repository.addTask(
      id,
      (initiative, takenOrders, tasks) =>
        blockingItsPublishingTask(
          createdWaitingFor(
            create(
              initiative,
              randomUUID(),
              given,
              { order: orderAfter(takenOrders), createdBy },
              new Date(),
            ),
            blockedBy,
            tasks,
          ),
          tasks,
        ),
    );
    await this.events.publish(created.event);
    if (blocking) await this.events.publish(blocking.event);
    return created.task;
  }

  private async changeDependencies<Event extends DomainEvent>(
    id: string,
    taskId: string,
    change: (
      initiative: Initiative,
      task: Task,
      tasks: readonly Task[],
    ) => TaskChange<Event> | undefined,
  ): Promise<Task> {
    const { task, event } = await this.repository.changeDependencies(id, taskId, change);
    if (event) await this.events.publish(event);
    return task;
  }

  /**
   * Changes one of its Tasks. Asked straight, a change that alters nothing is refused in
   * `sameWords`, so whoever shapes Initiatives hears it; a Proposal of it simply holds already.
   */
  private async changeItsTask<Event extends DomainEvent>(
    id: string,
    taskId: string,
    route: InitiativeChangeRoute,
    change: (initiative: Initiative, task: Task) => TaskChange<Event> | undefined,
    sameWords: (task: Task) => string,
  ): Promise<void> {
    const { task, event } = await this.repository.changeTask(id, taskId, change);
    if (event) await this.events.publish(event);
    else if (route === "straight") throw new InitiativeRefused([sameWords(task)]);
  }

  /**
   * The Initiative's done check after its Task `taskId` ended (spec 2.1, "Publishing Tasks"): when
   * an ordinary Task's end leaves every other one ended, git is asked first, outside any hold,
   * which Projects' branch holds unpublished work; `settle` then judges it all again as held,
   * adding their Publishing Tasks, or marks the Initiative done. A Publishing Task's own end adds
   * none, so a dropped one isn't added again until another Task ends.
   */
  private async settleAfter(taskId: string): Promise<void> {
    const ended = await this.tasks.find(taskId);
    if (!ended?.initiativeId) return;
    const id = ended.initiativeId;
    const [initiative, tasks] = await Promise.all([
      this.read(id),
      this.tasksByInitiative().then((byInitiative) => byInitiative.get(id) ?? []),
    ]);
    const candidates = isPublishingTask(ended) ? [] : publishingCandidates(initiative, tasks);
    const projects = await this.publishingProjects(candidates);
    const unpublished = await this.unpublishedIn(initiative, tasks, [...projects.keys()]);
    const pipelineNames = await this.pipelineNamesOf(initiative);
    const at = new Date();
    const settled = await this.repository.settle(id, (held, heldTasks, takenOrders) => {
      const orders = [...takenOrders];
      return settleInitiative(
        held,
        heldTasks,
        unpublished,
        (projectId) => {
          const order = orderAfter(orders);
          orders.push(order);
          return createPublishingTask(
            randomUUID(),
            requiredProject(projects, projectId),
            {
              initiative: held,
              pipelineName: pipelineNameIn(held, projectId, pipelineNames),
              doneTasks: doneTasksIn(heldTasks, projectId),
            },
            order,
            at,
          );
        },
        at,
      );
    });
    for (const created of settled.created) await this.events.publish(created.event);
    if (settled.event) await this.events.publish(settled.event);
  }

  /** The candidates still known, by id, as a Publishing Task's Plan names them. */
  private async publishingProjects(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, PublishingProject>> {
    const projects = await Promise.all(
      projectIds.map((projectId) => this.projects.find(projectId)),
    );
    return new Map(projects.flatMap((project) => (project ? [[project.id, project]] : [])));
  }

  /**
   * Of `projectIds`, those whose Initiative's branch holds work its last Done Publishing Task
   * didn't publish, or, with none yet, work the base branch doesn't have.
   */
  private async unpublishedIn(
    initiative: Initiative,
    tasks: readonly Task[],
    projectIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (projectIds.length === 0 || initiative.shortName === undefined) return new Set();
    const branch = initiativeBranchOf(initiative.shortName);
    const holding = await Promise.all(
      projectIds.map((projectId) =>
        this.branches.holdsUnpublished(projectId, branch, lastPublishedBy(tasks, projectId)?.id),
      ),
    );
    return new Set(projectIds.filter((_, index) => holding[index]));
  }

  /**
   * The Initiative's Pipeline in one Project, as whoever shapes Initiatives writes it while shaping
   * or the user applies their Proposal: refused once that Project's Publishing Task has started;
   * the Initiative's branch made there when a Project it came to span once active gets its first
   * Pipeline; and the Pipeline swapped on that Project's Publishing Task not yet started.
   */
  private async changePipeline(
    id: string,
    projectId: string,
    pipelineId: string | null,
    route: InitiativeChangeRoute,
  ): Promise<void> {
    if (route === "by-proposal") await this.refuseOncePipelineStarted(id, projectId);
    await this.branching.givingPipeline(id, projectId, () =>
      this.choosePipeline(id, projectId, pipelineId, route),
    );
    if (pipelineId !== null) await this.swapPublishingPipelines(id, projectId, pipelineId);
  }

  /** Refuses another Pipeline in the Project once its Publishing Task has started. */
  private async refuseOncePipelineStarted(id: string, projectId: string): Promise<void> {
    const tasks = (await this.tasksByInitiative()).get(id) ?? [];
    const started = startedPublishingTask(tasks, projectId);
    if (started) {
      const projectName = (await this.projects.find(projectId))?.name ?? projectId;
      throw new InitiativeRefused([
        `The Initiative's Pipeline in ${projectName} started in ${started.title}, so it can't change.`,
      ]);
    }
  }

  /**
   * The applied Pipeline on the Project's Publishing Task not yet started, unless its Stages were
   * edited for it (spec 2.1): one the user edited keeps its own, and with it its Stages.
   */
  private async swapPublishingPipelines(
    id: string,
    projectId: string,
    pipelineId: string,
  ): Promise<void> {
    const waiting = ((await this.tasksByInitiative()).get(id) ?? []).filter(
      (task) =>
        isPublishingTask(task) &&
        task.projectId === projectId &&
        NOT_STARTED_STATES.includes(task.state),
    );
    for (const publishing of waiting) {
      if (await this.stageEdits.editedForTask(publishing.id)) continue;
      const { event } = await this.repository.changeTask(id, publishing.id, (_, held) =>
        isPublishingTask(held) && NOT_STARTED_STATES.includes(held.state)
          ? swapPublishingPipeline(held, pipelineId)
          : undefined,
      );
      if (event) await this.events.publish(event);
    }
  }

  /** The Initiative once done, or undefined while it isn't. */
  private async finishIfDone(id: string): Promise<Initiative | undefined> {
    const { initiative, event } = await this.repository.update(id, (held, tasks) =>
      finishInitiative(held, tasks, new Date()),
    );
    if (!event) return undefined;
    await this.events.publish(event);
    return initiative;
  }

  private async update<Event extends DomainEvent>(
    id: string,
    change: (initiative: Initiative) => InitiativeChange<Event> | undefined,
  ): Promise<Initiative> {
    const { initiative, event } = await this.repository.update(id, change);
    if (event) await this.events.publish(event);
    return initiative;
  }

  private async updateWithTasks<Event extends DomainEvent>(
    id: string,
    change: (
      initiative: Initiative,
      tasks: readonly Task[],
    ) => InitiativeTasksChange<Event> | undefined,
  ): Promise<Initiative> {
    const { initiative, event, taskChanges } = await this.repository.updateWithTasks(id, change);
    if (event) await this.events.publish(event);
    for (const taskChange of taskChanges) await this.events.publish(taskChange.event);
    return initiative;
  }
}

function notSpannedWords(projectId: string): string {
  return `The Initiative has no Task in the Project "${projectId}", so it has no Pipeline there.`;
}

/** The name of the Initiative's Pipeline in the Project, or its id when the library lost it. */
function pipelineNameIn(
  initiative: Initiative,
  projectId: string,
  names: ReadonlyMap<string, string>,
): string {
  const pipelineId = pipelineIn(initiative, projectId) ?? "";
  return names.get(pipelineId) ?? pipelineId;
}
