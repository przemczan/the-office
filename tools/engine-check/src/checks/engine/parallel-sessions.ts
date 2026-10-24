import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Check } from "../../check.ts";
import type { ProbeHook } from "../../probe-session.ts";
import { allowCallsWithin } from "../permissions/hook-decisions.ts";
import { turnEnding } from "./running-command.ts";

const SESSIONS = 3;
/** How long a session waits in its tool call for the others; serialized sessions never all arrive. */
const BARRIER_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Three Tasks' sessions in three worktrees of one repository at once (spec §5.1, §5.5). Each holds
 * its first tool call until every session is in one, so the barrier opens only if they run in parallel.
 */
export const parallelSessionsCheck: Check = {
  id: "engine.parallel-sessions",
  title: "three sessions run in parallel",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const worktrees = await Promise.all(Array.from({ length: SESSIONS }, (_, index) => sandbox.addWorktree(repository, `task-${index + 1}`)));
    const barrier = new Barrier(SESSIONS);
    const allowRead = allowCallsWithin("Read", sandbox.root);
    const sessions = await Promise.all(
      worktrees.map((worktree) => startSession({ repository: worktree, hooks: { PreToolUse: barrier.before(allowRead) } })),
    );
    sessions.forEach((session, index) => session.send(`Use the Read tool on ${join(worktrees[index] as string, "README.md")}, then reply with just OK.`));
    const results = await Promise.all(sessions.map((session) => session.nextResult()));
    return {
      allInAToolCallAtOnce: barrier.opened,
      turnsEnded: [...new Set(results.map(turnEnding))],
      distinctSessions: new Set(results.map((result) => result.session_id)).size === SESSIONS,
    };
  },
};

/** Holds each session's first `PreToolUse` call until `parties` sessions have made one, or the timeout passes. */
class Barrier {
  opened = false;
  private readonly arrived = new Set<string>();
  private readonly parties: number;
  private open: () => void = () => undefined;
  private readonly allArrived: Promise<void>;

  constructor(parties: number) {
    this.parties = parties;
    this.allArrived = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  before(decide: ProbeHook): ProbeHook {
    return async (input, session) => {
      this.arrived.add(session.sessionId);
      if (this.arrived.size === this.parties) {
        this.opened = true;
        this.open();
      }
      // An unreferenced timer, so a barrier that opened does not keep the process alive.
      await Promise.race([this.allArrived, delay(BARRIER_TIMEOUT_MS, undefined, { ref: false })]);
      return decide(input, session);
    };
  }
}
