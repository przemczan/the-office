import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { moveAttachment } from "../domain/attachment-changes.js";
import type { Author } from "../domain/author.js";
import type { Idea } from "../domain/idea.js";
import { shapeIdeaIntoInitiative } from "../domain/idea-changes.js";
import { initiativeProjectIds, type Initiative } from "../domain/initiative.js";
import {
  archiveInitiative,
  restoreInitiative,
  type ArchivePage,
  type ArchiveSearch,
} from "../domain/initiative-archive.js";
import {
  addCtoTask,
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
  initiativePipelineProblems,
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
import { CTO, SHAPING_THREAD_TITLE, shapingOpeningOf } from "../domain/shaping.js";
import { isPublishingTask, newTaskProblems, type NewTask, type Task } from "../domain/task.js";
import type { TaskChange } from "../domain/task-changes.js";
import { createdWaitingFor } from "../domain/task-dependencies.js";
import { TaskStateChanged } from "../domain/task-events.js";
import { NOT_STARTED_STATES } from "../domain/task-states.js";
import { AttachmentRepository } from "../ports/attachment-repository.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { InitiativeThreads } from "../ports/initiative-threads.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { projectPipelineForInitiativeWords } from "../domain/pipeline-commands.js";
import { KnownProjects, type KnownProject } from "../ports/known-projects.js";
import { ProjectInitiativeBranches } from "../ports/project-initiative-branches.js";
import { ProposalDrafts } from "../ports/proposal-drafts.js";
import { TaskRepository } from "../ports/task-repository.js";
import { WorkSearch } from "../ports/work-search.js";
import { InitiativeBranching } from "./initiative-branching.js";
import { TaskStageEdits } from "./task-stage-edits.js";

function requiredProject(
  projects: ReadonlyMap<string, PublishingProject>,
  projectId: string,
): PublishingProject {
  const project = projects.get(projectId);
  if (!project) throw new Error(`The Project ${projectId} to publish in wasn't read first.`);
  return project;
}

/** The CTO's change as written straight onto the Initiative, or drafted as a Proposal. */
export type CtoChange =
  { readonly kind: "written"; readonly edit: InitiativeEdit } | { readonly kind: "proposed" };

/** An Initiative that names a Pipeline, with the Projects it spans, as the library weighs it. */
export interface InitiativeOnPipeline {
  readonly name: string;
  readonly state: Initiative["state"];
  readonly pipelineId: string;
  readonly projectIds: readonly string[];
  /** Whether its Pipeline has started, in one of its Publishing Tasks. */
  readonly pipelineStarted: boolean;
}

/**
 * The Initiatives use cases: shaped from an Idea or created from none, its outcome, Tasks, their
 * titles, Descriptions and dependencies written while shaping or by the CTO's Proposals once
 * active, confirmed, dropped, and done once their Tasks are. Each change is saved first and its events published after.
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
   * shaping Thread when a CTO is hired. Without one the user writes it by hand, and starts its
   * Thread once a CTO is hired (spec §2.1 Defaults).
   */
  async shape(ideaId: string, shapedBy: Author): Promise<Initiative> {
    const initiative = await this.shapeFromIdea(ideaId, shapedBy);
    await this.openShapingThreadIfCto(initiative);
    return initiative;
  }

  /**
   * Creates an Initiative being shaped from no Idea, named and with its outcome written
   * (create_initiative, spec 2.1), and opens its shaping Thread as `shape` does. Answers whether
   * that Thread opened.
   */
  async create(
    setting: NewInitiative,
    createdBy: Author,
  ): Promise<{ readonly initiative: Initiative; readonly shapingThreadOpened: boolean }> {
    const created = createInitiative(setting, randomUUID(), createdBy, new Date());
    await this.repository.insert(created);
    await this.events.publish(created.event);
    const shapingThreadOpened = await this.openShapingThreadIfCto(created.initiative);
    return { initiative: created.initiative, shapingThreadOpened };
  }

  /** Whether the shaping Thread opened: never without a CTO, who the user hires and then starts it. */
  private async openShapingThreadIfCto(initiative: Initiative): Promise<boolean> {
    if (!(await this.people.find(CTO))) return false;
    // An Initiative stands without its Thread, so one that couldn't open leaves the user to start it.
    try {
      await this.openShapingThread(initiative);
      return true;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`The Initiative ${initiative.id}'s shaping Thread couldn't open: ${reason}`);
      return false;
    }
  }

  /**
   * A new shaping Thread on the Initiative, where the CTO starts at once. Refused for a done or
   * dropped Initiative, and while nobody is the CTO.
   */
  async startShapingThread(id: string): Promise<{ readonly id: string }> {
    const initiative = await this.read(id);
    if (initiative.state === "done" || initiative.state === "dropped") {
      throw new InitiativeRefused([
        `The Initiative is ${initiative.state}: nothing is left to shape.`,
      ]);
    }
    if (!(await this.people.find(CTO))) {
      throw new InitiativeRefused([
        "Hire a CTO on People first: shaping is a conversation with them.",
      ]);
    }
    return this.openShapingThread(initiative);
  }

  private async openShapingThread(initiative: Initiative): Promise<{ readonly id: string }> {
    return this.threads.startOnInitiative({
      initiativeId: initiative.id,
      roleKey: CTO,
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

  /** Every Initiative's Tasks, by the Initiative's id, from one read of the board (tasksByInitiative). */
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
   * What the Initiative's record and a planning Brief's Initiative section are worded from, from one
   * read of the board. Throws InitiativeNotFound when there is no such Initiative.
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
    const pipeline =
      initiative.pipelineId === undefined
        ? undefined
        : await this.pipelines.find(initiative.pipelineId);
    return { initiative, idea, tasks, blockers, attachments, pipelineName: pipeline?.name };
  }

  /** The Idea it was shaped from; undefined for one created from none. */
  private async originIdeaOf({ originIdeaId }: Initiative): Promise<Idea | undefined> {
    if (originIdeaId === undefined) return undefined;
    const idea = await this.ideas.find(originIdeaId);
    if (!idea) throw new IdeaNotFound(originIdeaId);
    return idea;
  }

  /** Every Initiative that names a Pipeline, with the Projects its Tasks span. */
  async withPipelines(): Promise<readonly InitiativeOnPipeline[]> {
    const [every, byInitiative] = await Promise.all([
      this.repository.list(),
      this.tasksByInitiative(),
    ]);
    return every.flatMap(({ id, name, state, pipelineId }) =>
      pipelineId === undefined
        ? []
        : [
            {
              name,
              state,
              pipelineId,
              projectIds: initiativeProjectIds(byInitiative.get(id) ?? []),
              pipelineStarted: startedPublishingTask(byInitiative.get(id) ?? []) !== undefined,
            },
          ],
    );
  }

  /**
   * Makes it active, its Tasks in Shaping moving to Backlog, with its branch made in each Project
   * when it has a Pipeline (InitiativeBranching); done at once when its Tasks already are.
   */
  async confirm(id: string): Promise<Initiative> {
    const confirmed = await this.branching.confirm(id);
    return (await this.finishIfDone(id)) ?? confirmed;
  }

  /**
   * The Initiative's Pipeline, null for None: by the user or the CTO straight onto it while it is
   * being shaped, or by the CTO's Proposal once active. Refused for a Pipeline the library lacks,
   * or one running a command a Project it spans lacks (spec 2.3).
   */
  async choosePipeline(
    id: string,
    pipelineId: string | null,
    route: InitiativeChangeRoute,
  ): Promise<Initiative> {
    const chosen = pipelineId ?? undefined;
    if (chosen !== undefined) {
      const problems = await this.pipelineProblems(await this.read(id), chosen);
      if (problems.length > 0) throw new InitiativeRefused(problems);
    }
    const { initiative, event } = await this.repository.updateNaming(id, (held, taken) =>
      chooseInitiativePipeline(held, chosen, route, taken),
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
   * Why the Initiative can't follow the Pipeline: none in the library by that id, a Project
   * Pipeline, or a command it runs that a Project the Initiative spans lacks.
   */
  private async pipelineProblems(initiative: Initiative, pipelineId: string): Promise<string[]> {
    const pipeline = await this.pipelines.commandsNamedBy(pipelineId);
    if (!pipeline) return [await this.noSuchPipelineWords(pipelineId)];
    if (pipeline.projectId !== undefined) {
      return [await this.projectPipelineWords(pipeline.name, pipeline.projectId)];
    }
    return initiativePipelineProblems(pipeline, await this.projectsOf(initiative.id));
  }

  /** Every reason applying the CTO's Proposal of another Pipeline would be refused now. */
  private async pipelineChangeProblems(
    initiative: Initiative,
    pipelineId: string | null,
  ): Promise<string[]> {
    const pipeline =
      pipelineId === null ? undefined : await this.pipelines.commandsNamedBy(pipelineId);
    if (pipelineId !== null && !pipeline) return [await this.noSuchPipelineWords(pipelineId)];
    if (pipeline?.projectId !== undefined) {
      return [await this.projectPipelineWords(pipeline.name, pipeline.projectId)];
    }
    return initiativePipelineChangeProblems(
      initiative,
      pipelineId,
      pipeline,
      await this.projectsOf(initiative.id),
      (await this.tasksByInitiative()).get(initiative.id) ?? [],
    );
  }

  private async noSuchPipelineWords(pipelineId: string): Promise<string> {
    const known = (await this.pipelines.list()).map(({ id }) => id).join(", ");
    return `There is no Pipeline "${pipelineId}". The library has ${known}.`;
  }

  private async projectPipelineWords(pipelineName: string, projectId: string): Promise<string> {
    const owner = await this.projects.find(projectId);
    return projectPipelineForInitiativeWords(pipelineName, owner?.name ?? projectId);
  }

  /** The Projects the Initiative's Tasks span, those still known. */
  private async projectsOf(id: string): Promise<KnownProject[]> {
    const tasks = (await this.tasksByInitiative()).get(id) ?? [];
    const projects = await Promise.all(
      initiativeProjectIds(tasks).map((projectId) => this.projects.find(projectId)),
    );
    return projects.filter((project) => project !== undefined);
  }

  /**
   * Drops it, and every one of its Tasks not yet Done or Dropped with it. Each Task's
   * TaskStateChanged is published as its own Drop's is, so the queue lets a queued one go and a
   * started one's run stops.
   */
  async drop(id: string): Promise<Initiative> {
    return this.updateWithTasks(id, (initiative, tasks) =>
      dropInitiative(initiative, tasks, new Date()),
    );
  }

  /** Takes a Done or Dropped Initiative off the board into the Archive; its state stays. */
  async archive(id: string): Promise<Initiative> {
    return this.update(id, (initiative) => archiveInitiative(initiative, new Date()));
  }

  /** Puts an archived Initiative back on the board, for a full Archive period from now. */
  async restore(id: string): Promise<Initiative> {
    return this.update(id, (initiative) => restoreInitiative(initiative, new Date()));
  }

  /** A page of the Archive for `query`, filtered and counted as ArchiveSearch says. */
  async archived(query: string, filters: Omit<ArchiveSearch, "words">): Promise<ArchivePage> {
    return this.repository.archived({ ...filters, words: searchWords(query) });
  }

  /**
   * What must be true once it is done: by the user, or by the CTO, straight onto it while it is
   * being shaped, or by Proposal.
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

  /** The CTO's new Task, as `addTask`, by the route the change takes. */
  private async addCtoTask(
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
      (initiative, ...made) => addCtoTask(initiative, route, ...made),
      blockedBy,
    );
  }

  /** The CTO makes one of its Tasks wait for `blockerId`, any Task anywhere. */
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
   * Every reason a Proposal of `edit` would be refused if the user applied it now, in words the CTO
   * acts on: applying it judges again, under the Initiative's hold.
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
    if (edit.kind === "pipeline") return this.pipelineChangeProblems(initiative, edit.pipelineId);
    return initiativeEditProblems(initiative, edit, await this.tasks.list());
  }

  /**
   * The CTO's change (spec §2.1 Defaults): straight onto the Initiative while it is being shaped;
   * once it is active, drafted as a Proposal in the Thread of `sessionId` for the user to apply,
   * refused with every reason applying it would be.
   */
  async changeByCto(
    id: string,
    edit: InitiativeEdit,
    cto: Author,
    sessionId: string,
  ): Promise<CtoChange> {
    try {
      return { kind: "written", edit: await this.applyEdit(id, edit, cto, "straight") };
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
   * Carries out the CTO's Proposal the user applied, as proposed by `proposedBy`, and answers the
   * edit as applied: a new Task with its id. An edit that changes nothing now holds already.
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
    cto: Author,
    route: InitiativeChangeRoute,
  ): Promise<InitiativeEdit> {
    switch (edit.kind) {
      case "outcome":
        await this.writeOutcome(id, edit.outcome, route);
        return edit;
      case "add-task": {
        const task = await this.addCtoTask(id, newTaskOf(edit), edit.blockedBy, cto, route);
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
        if (route === "by-proposal") await this.refuseOncePipelineStarted(id);
        await this.choosePipeline(id, edit.pipelineId, route);
        if (edit.pipelineId !== null) await this.swapPublishingPipelines(id, edit.pipelineId);
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
   * `sameWords`, so the CTO hears it; a Proposal of it simply holds already.
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
    const pipelineName = await this.pipelineNameOf(initiative);
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
            { initiative: held, pipelineName, doneTasks: doneTasksIn(heldTasks, projectId) },
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

  private async pipelineNameOf(initiative: Initiative): Promise<string> {
    if (initiative.pipelineId === undefined) return "";
    return (await this.pipelines.find(initiative.pipelineId))?.name ?? initiative.pipelineId;
  }

  /** Refuses another Pipeline once a Publishing Task has started on the Initiative's. */
  private async refuseOncePipelineStarted(id: string): Promise<void> {
    const started = startedPublishingTask((await this.tasksByInitiative()).get(id) ?? []);
    if (started) {
      throw new InitiativeRefused([
        `The Initiative's Pipeline started in ${started.title}, so it can't change.`,
      ]);
    }
  }

  /**
   * The applied Pipeline on each Publishing Task not yet started whose Stages weren't edited for
   * it (spec 2.1): those the user edited keep theirs, and with it their Stages.
   */
  private async swapPublishingPipelines(id: string, pipelineId: string): Promise<void> {
    const waiting = ((await this.tasksByInitiative()).get(id) ?? []).filter(
      (task) => isPublishingTask(task) && NOT_STARTED_STATES.includes(task.state),
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
