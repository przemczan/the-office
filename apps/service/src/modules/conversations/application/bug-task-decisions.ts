import { Injectable } from "@nestjs/common";
import {
  bugTaskAnswerProblems,
  bugTaskDraft,
  bugTaskToCreate,
  closedDecisionRefusal,
  createsTheBugTask,
  isBugTask,
  proposedBugTaskProblems,
  type Answerer,
  type BugTaskFields,
  type Decision,
  type DecisionAnswer,
  type ProposedBugTask,
} from "../domain/decision.js";
import { DecisionNotFound } from "../domain/decision-not-found.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import type { Thread } from "../domain/thread.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import type { UserRef } from "../domain/user.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { DecisionService } from "./decision-service.js";
import { ProposalAppliers, type CreatedBugTask } from "./proposal-appliers.js";

/** A Bug Task as an Agent proposes it: its Project, when left out, is its own Task's. */
export type BugTaskProposal = Omit<ProposedBugTask, "projectId"> & {
  readonly projectId?: string | undefined;
};

/**
 * The Bug Tasks Agents propose from a Stage (spec §2.4): `propose_bug_task` opens a bug-task
 * Decision on the Agent's own Task, its problems checked first as a Proposal's are, and the user's
 * Create the Bug Task has Work create the Task, through the applier it registers on
 * `ProposalAppliers`, in the same request, before the answer is recorded with the new Task's id.
 */
@Injectable()
export class BugTaskDecisions {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly decisions: DecisionService,
    private readonly appliers: ProposalAppliers,
  ) {}

  /**
   * Opens the bug-task Decision in the Stage Thread whose engine session is `sessionId`, on its
   * Task, with the Project the Agent named or its Task's. Refused outside a Stage Thread on a
   * Task, with every problem of the proposal (an unknown Project or Task among them), and while
   * another Decision waits there.
   */
  async propose(sessionId: string, proposal: BugTaskProposal): Promise<Decision> {
    const thread = await this.repository.findBySession(sessionId);
    if (!thread) throw new ThreadRefused(["The Office doesn't know this session's Thread."]);
    const taskId = stageTaskOf(thread);
    const applier = this.appliers.bugTask();
    const projectId = proposal.projectId?.trim() || (await applier.projectOf(taskId));
    if (projectId === undefined) throw new ThreadRefused([`There is no Task ${taskId}.`]);
    const causedBy = proposal.causedBy?.trim();
    const proposed: ProposedBugTask = {
      title: proposal.title.trim(),
      description: proposal.description.trim(),
      why: proposal.why.trim(),
      projectId,
      ...(causedBy ? { causedBy } : {}),
    };
    const problems = [
      ...proposedBugTaskProblems(proposed),
      ...(await applier.problemsWith(proposed)),
    ];
    if (problems.length > 0) throw new ThreadRefused(problems);
    const { decision } = await this.decisions.open(sessionId, bugTaskDraft(proposed));
    return decision;
  }

  /**
   * Answers the Decision as `answerer`, as `DecisionService.answer` does. For a bug-task Decision
   * answered Create the Bug Task, the user's alone, Work first creates the Task with the fields as
   * edited, and the answer records them with its id; a refusal creates nothing and leaves the
   * Decision open, the refusal in its words. No answer gives the created Task's id itself. The
   * Decision is held from its read to its answer, so two answers at once create one Task at most,
   * and the second is refused as answered already.
   */
  async answer(id: string, given: DecisionAnswer, answerer: Answerer): Promise<Thread> {
    const answer = withoutCreatedTask(given);
    const decision = await this.repository.decision(id);
    if (!decision) throw new DecisionNotFound(id);
    if (!isBugTask(decision)) return this.decisions.answer(id, answer, answerer);
    // Every answer of it is held, so Don't create it can't land while its Task is being created.
    return this.repository.holdingDecision(id, async (held) => {
      if (!held) throw new DecisionNotFound(id);
      if (answer.kind !== "submitted" || !createsTheBugTask(answer)) {
        return this.decisions.answer(id, answer, answerer);
      }
      return this.create(held, answer, answerer);
    });
  }

  /** Creates the Task of the held bug-task Decision, then records the answer with its id. */
  private async create(
    decision: Decision,
    answer: Extract<DecisionAnswer, { kind: "submitted" }>,
    answerer: Answerer,
  ): Promise<Thread> {
    const { id } = decision;
    if (!isBugTask(decision)) throw new DecisionNotFound(id);
    if (decision.answer) throw new ThreadRefused(["This Decision is answered already."]);
    if (decision.closedAt) throw new ThreadRefused([closedDecisionRefusal(decision)]);
    const problems = bugTaskAnswerProblems(decision, answer);
    if (problems.length > 0) throw new ThreadRefused(problems);
    if (answerer.kind !== "user" || decision.taskId === undefined) {
      throw new ThreadRefused([
        "Only the user creates a proposed Bug Task, on its Decision's card.",
      ]);
    }
    const fields = bugTaskToCreate(decision.bugTask, answer.bugTask);
    const created = await this.createTask(fields, decision.taskId, answerer.user);
    return this.decisions.answer(
      id,
      { ...answer, bugTask: fields, createdTaskId: created.id },
      answerer,
    );
  }

  private async createTask(
    fields: BugTaskFields,
    foundWhileWorkingOn: string,
    createdBy: UserRef | null,
  ): Promise<CreatedBugTask> {
    try {
      return await this.appliers.bugTask().create(fields, foundWhileWorkingOn, createdBy);
    } catch (error) {
      if (error instanceof ProposalRefused) throw new ThreadRefused(error.reasons);
      throw error;
    }
  }
}

/** The Task of the Stage Thread a Bug Task is proposed from, refused from any other Thread. */
function stageTaskOf({ stageThread, home }: Thread): string {
  if (!stageThread || home.kind !== "task") {
    throw new ThreadRefused(["Propose a Bug Task from a Stage of a Task, in its Stage Thread."]);
  }
  return home.taskId;
}

/** The answer as whoever answers may give it: the created Task's id is The Office's to record. */
function withoutCreatedTask(answer: DecisionAnswer): DecisionAnswer {
  if (answer.kind !== "submitted" || answer.createdTaskId === undefined) return answer;
  const { createdTaskId: _createdTaskId, ...rest } = answer;
  return rest;
}
