import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import {
  EnvironmentChecks,
  ProjectNotFound,
  ProjectRefused,
  ProjectService,
  type EnvironmentCheck,
} from "../../../projects/index.js";
import { HeldCalls } from "../../application/held-calls.js";
import { SessionStops } from "../../application/session-stops.js";
import { WorkRecords } from "../../application/work-records.js";
import { RUN_ENVIRONMENT_CHECK_TOOL } from "../../domain/session-instructions.js";
import { ThreadRepository } from "../../ports/thread-repository.js";

type Project = Awaited<ReturnType<ProjectService["read"]>>;
type Check = EnvironmentCheck["checks"][number];

/**
 * How long the tool waits for the check before it stops it and answers that it timed out. Each of
 * the check's commands may run for 30 minutes on its own (Projects' environment check), but the
 * Agent's turn waits on the call, so a check that hangs must not hold it, and the session's slot,
 * for longer than a whole check of a large Project takes.
 */
export const ENVIRONMENT_CHECK_TOOL_TIMEOUT_MS = 60 * 60_000;

/** How many of a step's last output lines the answer gives. */
const OUTPUT_TAIL_LINES = 40;

const DESCRIPTION = `Runs the environment check of a Project and answers when it ends: a fresh worktree, then the install command, then each of the Project's commands in its order, with the Project's saved environment. Given a Task, from any Thread, it checks the head of that Task's branch as committed; given none, in a Thread on a Task it checks that Task's branch, and anywhere else the freshly fetched base branch. A Task's branch is checked in the Task's run environment, built from the .devcontainer/ on that branch, while the Project's Run environment is On, else on the host (in a Stage, first commit your work so far with update_branch); the base branch always on the host. It changes no setting and no file of yours. It answers each step: its state, its command line, its exit code and the last lines of its output, then whether the check passed. A check of the same branch already running is waited for rather than started again. It installs, so your Run installs Hard switch decides the call: Allowed runs it at once; Ask me or Consult holds it as an approval card, so end your turn: the answer comes as your next message, and after "Allow once" you repeat the same call, word for word, which then runs once; Never refuses it.`;

const input = z.object({
  project: z
    .string()
    .optional()
    .describe(
      "The Project's id, as list_projects gives it. Required when no Task is checked; with a Task leave it out, or give the Task's Project.",
    ),
  task: z
    .string()
    .optional()
    .describe(
      "A Task's id, as list_tasks gives it, to check that Task's branch from any Thread. Left out, a Thread on a Task checks its own Task's branch, any other Thread the base branch.",
    ),
  why: z.string().describe("Why you run the check, in a sentence or two."),
});

type Input = z.infer<typeof input>;

/**
 * The Office tool that runs a Project's environment check for whoever onboards and repairs
 * Projects (spec §5.5), so they find out whether their setup works: of the given Task's branch, else
 * of the Thread's Task's branch in a Thread on a Task, else of the base branch. It installs, so the Run installs Hard switch holds it. It waits
 * for the check, which stops when the session does or after `ENVIRONMENT_CHECK_TOOL_TIMEOUT_MS`.
 */
@Injectable()
export class EnvironmentCheckOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly projects: ProjectService,
    private readonly checks: EnvironmentChecks,
    private readonly heldCalls: HeldCalls,
    private readonly threads: ThreadRepository,
    private readonly workRecords: WorkRecords,
    private readonly stops: SessionStops,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: RUN_ENVIRONMENT_CHECK_TOOL,
      description: DESCRIPTION,
      input,
      run: (given, { sessionId }) => this.run(sessionId, given),
    });
  }

  private async run(sessionId: string, given: Input): Promise<OfficeToolResult> {
    const thread = await this.threads.findBySession(sessionId);
    if (!thread) return refusal("The Office doesn't know this session's Thread.");
    const threadTaskId = thread.home.kind === "task" ? thread.home.taskId : undefined;
    const givenTaskId = given.task?.trim() || undefined;
    const taskId = givenTaskId ?? threadTaskId;
    const projectId = await this.projectIdOf(
      taskId,
      given.project?.trim(),
      givenTaskId !== undefined,
    );
    if (projectId.kind === "refused") return refusal(projectId.reason);
    try {
      const project = await this.projects.find(projectId.id);
      if (!project) return refusal(`The Office has no Project "${projectId.id}".`);
      const where =
        taskId === undefined
          ? `base branch ${project.baseBranch}`
          : taskId === threadTaskId
            ? "Task's branch"
            : `branch of the Task ${taskId}`;
      const outcome = await this.heldCalls.hold({
        sessionId,
        switchKey: "runInstalls",
        call: `Run the environment check of the Project ${project.name} on its ${where}`,
        context: `${given.why}\n\nThe check makes a fresh worktree of ${project.name}'s ${where}, then runs its install command and each of its commands there, with its saved environment, ${taskId === undefined ? "on the host" : "in the Task's run environment, built from the branch's .devcontainer/, while the Project's Run environment is On, else on the host"}. It changes no setting.`,
        why: given.why,
      });
      if (outcome.kind === "refused") return refusal(outcome.reason);
      if (outcome.kind === "held") {
        return {
          text: `The call waits on ${outcome.waitingOn}, as a Decision in this Thread. End your turn now: their answer comes as your next message.`,
          isError: false,
        };
      }
      return await this.checked(sessionId, project, taskId, where);
    } catch (error) {
      if (error instanceof ProjectRefused || error instanceof ProjectNotFound) {
        return refusal(error.message);
      }
      throw error;
    }
  }

  /**
   * The Project to check: the checked Task's, where another one given is refused; else the given.
   * `taskGiven` says the Task came from the call rather than the Thread.
   */
  private async projectIdOf(
    taskId: string | undefined,
    given: string | undefined,
    taskGiven: boolean,
  ): Promise<{ kind: "found"; id: string } | { kind: "refused"; reason: string }> {
    if (taskId === undefined) {
      return given
        ? { kind: "found", id: given }
        : {
            kind: "refused",
            reason: "Give the Project to check, by its id: this Thread is on no Task.",
          };
    }
    const subject = (await this.workRecords.taskSubjects([taskId])).get(taskId);
    if (!subject) return { kind: "refused", reason: `The Office has no Task "${taskId}".` };
    if (given && given !== subject.projectId) {
      return {
        kind: "refused",
        reason: taskGiven
          ? `The Task ${taskId} is of the Project ${subject.projectId}, not ${given}. Leave project out, or give the Task's Project.`
          : `This Thread is on a Task of the Project ${subject.projectId}: with no task given you check only this Task's branch. Leave project out, give another Task with task, or check another Project's base branch from a Thread on no Task.`,
      };
    }
    return { kind: "found", id: subject.projectId };
  }

  /** Waits for the check, stopped when the session stops or the wait times out. */
  private async checked(
    sessionId: string,
    project: Project,
    taskId: string | undefined,
    where: string,
  ): Promise<OfficeToolResult> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), ENVIRONMENT_CHECK_TOOL_TIMEOUT_MS);
    const sessionStop = this.stops.signalOf(sessionId);
    try {
      const check = await this.checks.check(project.id, {
        ...(taskId === undefined ? {} : { taskId }),
        signal: AbortSignal.any([sessionStop, timeout.signal]),
      });
      const steps = check.checks.map(stepWords).join("\n\n");
      const heading = `The environment check of ${project.name}'s ${where}:`;
      if (timeout.signal.aborted) {
        return {
          text: `${heading}\n\n${steps}\n\nTimed out: it ran past ${ENVIRONMENT_CHECK_TOOL_TIMEOUT_MS / 60_000} minutes, so The Office stopped it.`,
          isError: true,
        };
      }
      return {
        text: `${heading}\n\n${steps}\n\n${verdict(check)}`,
        isError: check.state !== "passed",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function refusal(text: string): OfficeToolResult {
  return { text, isError: true };
}

/** One step as the answer gives it: its state, command line, exit code and its output's tail. */
function stepWords(check: Check): string {
  if (check.step === "worktree") {
    const base = check.base
      ? ` (commit ${check.base.commit.slice(0, 12)}${check.base.fetchedFrom ? `, fetched from ${check.base.fetchedFrom}` : ""})`
      : "";
    const problem = check.problem ? `: ${check.problem}` : "";
    return `- Worktree: ${check.state}${base}${problem}`;
  }
  const name = check.step === "install" ? "Install" : `Command ${check.key} (${check.name})`;
  const run = check.run;
  const lines = [
    `- ${name}: ${check.state}`,
    `  Command line: ${run?.commandLine ?? check.commandLine}`,
  ];
  if (run) {
    lines.push(
      `  Outcome: ${run.outcome}, exit code ${run.exitCode ?? "none"}, ${Math.round(run.durationMs / 1000)} s`,
    );
    const tail = tailOf(run.output);
    if (tail !== "") lines.push(fenced(tail));
  }
  return lines.join("\n");
}

/** The last lines of the output, as Projects stored it, masked. */
function tailOf(output: string): string {
  return output.trimEnd().split(/\r?\n/).slice(-OUTPUT_TAIL_LINES).join("\n");
}

/** The text in a code block whose fence no line of it closes. */
function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

/** "Passed.", or which steps failed, in one line. */
function verdict(check: EnvironmentCheck): string {
  if (check.state === "passed") return "Passed: every step passed.";
  if (check.state === "stopped") return "Stopped before it finished.";
  const failed = check.checks
    .filter(({ state }) => state === "failed")
    .map((each) =>
      each.step === "worktree" ? "worktree" : each.step === "install" ? "install" : each.key,
    );
  return `Failed: ${failed.length > 0 ? failed.join(", ") : "a step"}.`;
}
