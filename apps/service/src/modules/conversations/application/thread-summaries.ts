import { Injectable } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import { mapPage, pageOf, type Page, type PageRequest } from "../../../platform/paging/page.js";
import { Duties, EngineCascade, RoleCards } from "../../people/index.js";
import { summarizeContext, type ContextMoveSummary } from "../domain/context-policy.js";
import { cascadeLocationOf, type Thread } from "../domain/thread.js";
import { ThreadRepository, type PersonsThreads } from "../ports/thread-repository.js";
import { AllowChanges } from "./allow-changes.js";
import { ChatActivity, type ThreadActivity } from "./chat-activity.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { WorkRecords, type TaskSubject } from "./work-records.js";

/** A Thread as a list's row shows it: its context's move, with no Brief built. */
export interface ThreadSummary {
  readonly thread: Thread;
  readonly context: ContextMoveSummary;
  /** Undefined for a Thread outside a chat. */
  readonly activity: ThreadActivity | undefined;
}

/** A person's Thread on a Task, named with its Task. */
export interface TaskThreadSummary extends ThreadSummary {
  readonly taskId: string;
  readonly task: TaskSubject;
}

/**
 * A person's chat and their Threads on Tasks, a page at a time (spec §2.5's label on each row).
 * A row's context needs no Brief, as no move depends on its size: what the decision reads is read
 * once for the page, the person's for every row and the engine once per Project, so the number of
 * reads stays the same however many Threads the person has. `ThreadContexts` reads one Thread in
 * full, Brief included.
 */
@Injectable()
export class ThreadSummaries {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly engineCascade: EngineCascade,
    private readonly duties: Duties,
    private readonly settings: ContextPolicySettingsService,
    private readonly allowChanges: AllowChanges,
    private readonly chatActivity: ChatActivity,
    private readonly workRecords: WorkRecords,
  ) {}

  /** A page of the person's chat, the newest started first. */
  async inChat(roleKey: string, page: PageRequest): Promise<Page<ThreadSummary>> {
    const threads = await this.pageOf(roleKey, "chat", page);
    const [contexts, activity] = await Promise.all([
      this.contextsOf(roleKey, threads.rows, () => undefined),
      this.chatActivity.inThreads(threads.rows),
    ]);
    return mapPage(threads, (rows) =>
      rows.map((thread) => ({
        thread,
        context: contexts.get(thread.id)!,
        activity: activity.get(thread.id),
      })),
    );
  }

  /**
   * A page of the person's Threads on every Task, the newest started first, each with its Task's
   * title and Project; one whose Task is no longer there is left out of the page.
   */
  async onTasksWith(roleKey: string, page: PageRequest): Promise<Page<TaskThreadSummary>> {
    const threads = await this.pageOf(roleKey, "task", page);
    const subjects = await this.workRecords.taskSubjects([...new Set(threads.rows.map(taskIdOf))]);
    const contexts = await this.contextsOf(
      roleKey,
      threads.rows,
      (thread) => subjects.get(taskIdOf(thread))?.projectId,
    );
    return mapPage(threads, (rows) =>
      rows.flatMap((thread) => {
        const taskId = taskIdOf(thread);
        const task = subjects.get(taskId);
        if (!task) return [];
        return [{ thread, taskId, task, context: contexts.get(thread.id)!, activity: undefined }];
      }),
    );
  }

  /** Read one past the page, which tells whether another follows. */
  private async pageOf(
    roleKey: string,
    where: PersonsThreads,
    page: PageRequest,
  ): Promise<Page<Thread>> {
    const read = await this.repository.personsThreads(roleKey, where, page.after, page.size + 1);
    return pageOf(read.threads, page, read.total, ({ startedAt, id }) => ({ at: startedAt, id }));
  }

  /**
   * Each Thread's context by its id: all of them the person's, in the Project `projectOf` names and
   * at their Task or Initiative.
   */
  private async contextsOf(
    roleKey: string,
    threads: readonly Thread[],
    projectOf: (thread: Thread) => string | undefined,
  ): Promise<ReadonlyMap<string, ContextMoveSummary>> {
    const [role, settings, heldDuties, changesAllowed] = await Promise.all([
      this.roleCards.find(roleKey),
      this.settings.current(),
      this.duties.heldBy(roleKey),
      this.allowChanges.inThreads(threads),
    ]);
    // Each Thread's engine is resolved where its session runs: its Task's, its Initiative's or none,
    // in its Project; read once per place.
    const locationKey = (thread: Thread): string =>
      JSON.stringify(cascadeLocationOf(thread.home, projectOf(thread)));
    const places = new Map(threads.map((thread) => [locationKey(thread), thread]));
    // Nobody fills the Role any more, or no engine is listed: its Threads stay readable.
    const engines = new Map(
      await readEach(
        [...places],
        async ([key, thread]) =>
          [
            key,
            role &&
              (await this.engineCascade.applying(
                roleKey,
                cascadeLocationOf(thread.home, projectOf(thread)),
              )),
          ] as const,
      ),
    );
    const now = new Date();
    return new Map(
      threads.map((thread) => [
        thread.id,
        summarizeContext(
          {
            now,
            session: thread.session,
            roleKey: thread.roleKey,
            sessionDefault: role?.card.sessionDefault ?? "context-policy",
            engineId: engines.get(locationKey(thread))?.engineId,
            forced: engines.get(locationKey(thread))?.standIns.from === "none",
            override: thread.override,
            changesAllowed: changesAllowed.get(thread.id),
            heldDuties,
          },
          settings,
        ),
      ]),
    );
  }
}

function taskIdOf({ home }: Thread): string {
  if (home.kind !== "task") throw new Error("A Thread on a Task was asked for its Task.");
  return home.taskId;
}
