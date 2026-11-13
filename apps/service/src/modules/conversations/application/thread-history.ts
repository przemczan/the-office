import { Injectable } from "@nestjs/common";
import { RoleCards } from "../../people/index.js";
import type { Decision } from "../domain/decision.js";
import type { Message } from "../domain/message.js";
import type { Proposal } from "../domain/proposal.js";
import type { Home, Thread } from "../domain/thread.js";
import {
  messageInHistory,
  threadHistoryWords,
  type HistoryRecords,
} from "../domain/thread-history-words.js";
import { ProjectRecordSource } from "../ports/project-record-source.js";
import { ThreadRepository, type LoggedMessage } from "../ports/thread-repository.js";
import { WorkRecords } from "./work-records.js";

/** What `read_threads` is asked: a range of dates or times, and the filters, each optional. */
export interface ThreadHistoryQuery {
  readonly from: string;
  readonly to: string;
  /** Only Threads with this person, by their Role's key. */
  readonly personRole?: string | undefined;
  readonly taskId?: string | undefined;
  readonly projectId?: string | undefined;
  /** Only messages holding this text, in any case. */
  readonly search?: string | undefined;
  /** The message read up to, by its id, to read on after it. */
  readonly after?: string | undefined;
}

/** An Agent Stage's run in its Stage Thread: the messages logged from its start to its end. */
export interface StageRunWindow {
  readonly taskId: string;
  readonly threadId: string;
  readonly from: Date;
  readonly to: Date;
}

/** A date alone, which reads as that whole day in UTC. */
const DATE_ALONE = /^\d{4}-\d{2}-\d{2}$/;

/** A date and time with no offset, which reads in UTC as a date alone does, not the server's zone. */
const TIME_WITHOUT_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

const LAST_MILLISECOND_OF_DAY = 24 * 60 * 60 * 1000 - 1;

/** Which Threads a query reads, or the plain sentence answering a filter that names nothing. */
type ThreadsAsked =
  | {
      readonly roleKey: string | undefined;
      readonly homes: readonly Home[] | undefined;
      readonly filters: readonly string[];
    }
  | string;

/**
 * Reads Thread messages for `read_threads` (spec 2.4): The Office's log alone, through the
 * ThreadRepository, never a file or an engine's transcript. Filters that name nothing, and a range
 * that ends before it starts, get a plain sentence rather than an error.
 */
@Injectable()
export class ThreadHistory {
  constructor(
    private readonly threads: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly work: WorkRecords,
    private readonly projects: ProjectRecordSource,
  ) {}

  async read(query: ThreadHistoryQuery): Promise<string> {
    const from = timeOf(query.from, "start");
    const to = timeOf(query.to, "end");
    if (from === undefined) return notATime("from", query.from);
    if (to === undefined) return notATime("to", query.to);
    if (from > to) return "The range ends before it starts: give a from that comes before the to.";
    const asked = await this.threadsAsked(query);
    if (typeof asked === "string") return asked;
    const logged = await this.threads.loggedIn({
      from,
      to,
      roleKey: asked.roleKey,
      homes: asked.homes,
    });
    const records = await this.recordsOf(logged);
    const search = given(query.search)?.toLowerCase();
    const messages = logged
      .map(({ message }) => messageInHistory(message, records))
      .filter(
        ({ text, speaker }) =>
          search === undefined || `${speaker}: ${text}`.toLowerCase().includes(search),
      );
    return threadHistoryWords({
      from,
      to,
      filters: [
        ...asked.filters,
        ...(search === undefined ? [] : [`holding "${given(query.search)}"`]),
      ],
      messages,
      subjects: await this.subjectsOf(logged, records),
      after: given(query.after),
    });
  }

  /**
   * The messages an Agent Stage's run logged in its Stage Thread, for `read_stage_history`: worded
   * as `read` words them, within `limit`, a cut answer reading on through `read_threads`.
   */
  async ofStageRun(window: StageRunWindow, limit: number): Promise<string> {
    const { taskId, threadId, from, to } = window;
    const logged = await this.threads.loggedIn({ from, to, threadId });
    const records = await this.recordsOf(logged);
    return threadHistoryWords(
      {
        from,
        to,
        filters: [],
        messages: logged.map(({ message }) => messageInHistory(message, records)),
        subjects: await this.subjectsOf(logged, records),
        after: undefined,
      },
      {
        limit,
        readOn: (lastShownId) =>
          `read_threads with taskId "${taskId}", from "${from.toISOString()}", to "${to.toISOString()}" and after "${lastShownId}" reads on, where your session has it.`,
      },
    );
  }

  private async threadsAsked(query: ThreadHistoryQuery): Promise<ThreadsAsked> {
    const roleKey = given(query.personRole);
    const taskId = given(query.taskId);
    const projectId = given(query.projectId);
    const filters: string[] = [];
    if (roleKey !== undefined) {
      const person = await this.personOf(roleKey);
      if (person === undefined) {
        return `Nobody fills or filled the Role ${roleKey}: list_people gives the Roles by their keys.`;
      }
      filters.push(`with ${person}`);
    }
    let homes: Home[] | undefined;
    if (taskId !== undefined) {
      const title = await this.work.taskTitle(taskId);
      if (title === undefined)
        return `The Office has no Task ${taskId}: list_tasks gives the Tasks.`;
      filters.push(`on the Task "${title}"`);
      homes = [{ kind: "task", taskId }];
    }
    if (projectId !== undefined) {
      if ((await this.projects.of(projectId)) === undefined) {
        return `The Office has no Project ${projectId}: list_projects gives the Projects.`;
      }
      filters.push(`in the Project ${projectId}`);
      const { taskIds, initiativeIds } = await this.work.projectWork(projectId);
      homes =
        taskId === undefined
          ? [
              ...taskIds.map((id): Home => ({ kind: "task", taskId: id })),
              ...initiativeIds.map((id): Home => ({ kind: "initiative", initiativeId: id })),
            ]
          : taskIds.includes(taskId)
            ? homes
            : [];
    }
    return { roleKey, homes, filters };
  }

  /** What the messages' words name: each person, Decision and Proposal, read once. */
  private async recordsOf(logged: readonly LoggedMessage[]): Promise<HistoryRecords> {
    const messages = logged.map(({ message }) => message);
    const decisions = await readEach(idsOf(messages, "decision"), (id) =>
      this.threads.decision(id),
    );
    const proposals = await readEach(idsOf(messages, "proposal"), (id) =>
      this.threads.proposal(id),
    );
    const roleKeys = new Set([
      ...logged.map(({ thread }) => thread.roleKey),
      ...messages.flatMap(roleKeysNamedBy),
      ...[...decisions.values()].flatMap(({ answer }) =>
        answer?.answeredBy === undefined ? [] : [answer.answeredBy],
      ),
    ]);
    const people = await readEach([...roleKeys], (roleKey) => this.personOf(roleKey));
    return {
      person: (roleKey) => people.get(roleKey) ?? roleKey,
      decision: (id): Decision | undefined => decisions.get(id),
      proposal: (id): Proposal | undefined => proposals.get(id),
    };
  }

  /** Each Thread's subject, by its id: whose Thread it is and on what. */
  private async subjectsOf(
    logged: readonly LoggedMessage[],
    records: HistoryRecords,
  ): Promise<ReadonlyMap<string, string>> {
    const threads = [...new Map(logged.map(({ thread }) => [thread.id, thread])).values()];
    const subjects = await Promise.all(
      threads.map(async (thread) => [thread.id, await this.subjectOf(thread, records)] as const),
    );
    return new Map(subjects);
  }

  private async subjectOf(thread: Thread, records: HistoryRecords): Promise<string> {
    const person = records.person(thread.roleKey);
    const titled = thread.title === undefined ? "" : `: "${thread.title}"`;
    switch (thread.home.kind) {
      case "chat":
        return `Chat with ${person}${titled}`;
      case "task": {
        const { taskId } = thread.home;
        const title = (await this.work.taskTitle(taskId)) ?? "a Task no longer kept";
        const kind = thread.consultation
          ? "Consultation"
          : thread.stageThread
            ? "Stage Thread"
            : "Thread";
        return `${person}'s ${kind} on the Task "${title}" (Task ${taskId})`;
      }
      case "initiative": {
        const { initiativeId } = thread.home;
        const name =
          (await this.work.initiativeName(initiativeId)) ?? "an Initiative no longer kept";
        return `${person}'s Thread on the Initiative "${name}" (Initiative ${initiativeId})`;
      }
    }
  }

  /** The person filling the Role, or who filled it, by name and Role; undefined for nobody ever. */
  private async personOf(roleKey: string): Promise<string | undefined> {
    const hired = await this.roleCards.find(roleKey);
    if (hired) return `${hired.card.name}, the ${hired.card.title}`;
    const letGo = await this.roleCards.findLetGo(roleKey);
    return letGo && `${letGo.name}, once the ${this.roleCards.roleTitle(roleKey)}`;
  }
}

/** The time a value names, a date alone reading as its day's start or end; undefined for none. */
function timeOf(value: string, end: "start" | "end"): Date | undefined {
  const trimmed = value.trim();
  const time = new Date(
    DATE_ALONE.test(trimmed)
      ? `${trimmed}T00:00:00.000Z`
      : TIME_WITHOUT_OFFSET.test(trimmed)
        ? `${trimmed}Z`
        : trimmed,
  );
  if (Number.isNaN(time.getTime())) return undefined;
  return DATE_ALONE.test(trimmed) && end === "end"
    ? new Date(time.getTime() + LAST_MILLISECOND_OF_DAY)
    : time;
}

function notATime(field: "from" | "to", value: string): string {
  return `The ${field} "${value}" is no date or time: give one as 2026-11-12, or 2026-11-12T13:00:00Z.`;
}

/** The ids of the Decisions or Proposals the messages show, each once. */
function idsOf(messages: readonly Message[], kind: "decision" | "proposal"): string[] {
  const ids = messages.flatMap((message) => {
    if (kind === "decision") {
      return message.kind === "decision" || message.kind === "decision-answer"
        ? [message.decisionId]
        : [];
    }
    return message.kind === "proposal" ? [message.proposalId] : [];
  });
  return [...new Set(ids)];
}

/** The Roles a message names besides its Thread's person: who wrote it, and a Link card's person. */
function roleKeysNamedBy(message: Message): string[] {
  const writer = "roleKey" in message && message.roleKey !== undefined ? [message.roleKey] : [];
  return message.kind === "link-card" ? [...writer, message.to] : writer;
}

/** Each key's record, read at once, leaving out the keys with none. */
async function readEach<Value>(
  keys: readonly string[],
  read: (key: string) => Promise<Value | undefined>,
): Promise<Map<string, Value>> {
  const entries = await Promise.all(keys.map(async (key) => [key, await read(key)] as const));
  return new Map(
    entries.flatMap(([key, value]) => (value === undefined ? [] : [[key, value] as const])),
  );
}

/** The value trimmed, or undefined when left out or blank. */
function given(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}
