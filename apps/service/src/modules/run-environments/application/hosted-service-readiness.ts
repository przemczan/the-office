import { connect } from "node:net";

/** Whether something accepts a TCP connection on the port of 127.0.0.1. */
export type PortAnswers = (port: number) => Promise<boolean>;

/** How long a Hosted Test instance's app may take to answer on its port after it starts. */
export const HOSTED_READY_TIMEOUT_MS = 120_000;
/** How long between two tries of the app's port. */
const HOSTED_READY_INTERVAL_MS = 500;
/** How long one try may wait for the connection. */
const CONNECT_TIMEOUT_MS = 2_000;
/** How long a connection must stay open to count as the app's, not the port proxy's. */
const HELD_OPEN_MS = 300;

/** How a Hosted Test instance's app is known to be up: it answers on its published port. */
export interface HostedServiceReadinessOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  /** A TCP connect to 127.0.0.1 unless a test gives its own. */
  readonly answers?: PortAnswers;
}

/**
 * When a Hosted Test instance's app counts as started: a TCP connect to its published port on
 * 127.0.0.1 succeeds, tried every `intervalMs` for up to `timeoutMs`.
 */
export class HostedServiceReadiness {
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly answers: PortAnswers;

  constructor({
    timeoutMs = HOSTED_READY_TIMEOUT_MS,
    intervalMs = HOSTED_READY_INTERVAL_MS,
    answers = tcpAnswers,
  }: HostedServiceReadinessOptions = {}) {
    this.timeoutMs = timeoutMs;
    this.intervalMs = intervalMs;
    this.answers = answers;
  }
}

/**
 * Connects to 127.0.0.1:port and closes; false on a refusal, an error or no answer. The runtime's
 * port proxy accepts a connection whether or not the app listens, then closes it when the app
 * refuses, so the connection counts only once it stays open for `HELD_OPEN_MS`.
 */
export function tcpAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    let settled = false;
    let held: NodeJS.Timeout | undefined;
    const done = (answered: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(held);
      socket.destroy();
      resolve(answered);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => {
      socket.setTimeout(0);
      held = setTimeout(() => done(true), HELD_OPEN_MS);
    });
    socket.once("end", () => done(false));
    socket.once("close", () => done(false));
    socket.once("error", () => done(false));
    // Whatever the app says first is read and dropped.
    socket.resume();
  });
}
