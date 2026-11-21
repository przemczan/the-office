import { createHash, randomBytes } from "node:crypto";
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EventBus, type Unsubscribe } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { TestInstanceStateChanged } from "../domain/test-instance-events.js";
import { TestInstanceRefused } from "../domain/test-instance-refused.js";
import { notRunning } from "../domain/stop-reason.js";
import { RunningTestInstances } from "./running-test-instances.js";
import { TestInstances } from "./test-instances.js";

/** How long a hand-off link works once made (spec §2.10, "about 60 seconds"). */
export const HAND_OFF_MS = 60_000;

/** A hand-off link's token, kept only as its hash, until it is used or expires. */
interface WaitingHandOff {
  readonly instanceId: string;
  readonly expiresAt: number;
}

/**
 * Signing in to a Hosted test instance (spec §2.10, "Signing in to a test instance"), in memory: a
 * hand-off token made by Open, single-use, about 60 seconds, bound to its instance, exchanged at the
 * instance's port for a cookie session of that instance alone; every session of an instance ends
 * when it stops or fails. Tokens and session values are random and kept only as their hashes.
 */
@Injectable()
export class TestInstanceHandOffs implements OnModuleInit, OnModuleDestroy {
  private readonly handOffs = new Map<string, WaitingHandOff>();
  /** Each Running instance's cookie sessions, by their values' hashes. */
  private readonly sessions = new Map<string, Set<string>>();
  private unsubscribe: Unsubscribe | undefined;

  constructor(
    private readonly running: RunningTestInstances,
    private readonly instances: TestInstances,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe(TestInstanceStateChanged, ({ instanceId, to }) => {
      if (to !== "running") this.end(instanceId);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /**
   * A new hand-off token for the Running instance, with its Proxy port; refused unless it is
   * Running, and not found unless there is one by that id.
   */
  async open(instanceId: string): Promise<{ readonly token: string; readonly port: number }> {
    const instance = await this.instances.read(instanceId);
    if (!this.running.isRunning(instanceId) || instance.port === undefined) {
      throw new TestInstanceRefused([notRunning(instance.targetName)]);
    }
    const now = this.schedule.now().getTime();
    for (const [hash, waiting] of this.handOffs) {
      if (waiting.expiresAt <= now) this.handOffs.delete(hash);
    }
    const token = randomBytes(32).toString("base64url");
    this.handOffs.set(hashOf(token), { instanceId, expiresAt: now + HAND_OFF_MS });
    return { token, port: instance.port };
  }

  /**
   * Exchanges a token at the port of the Running instance `instanceId` for a new cookie session's
   * value; undefined when it was used already, has expired or belongs to another instance. Any
   * use spends it.
   */
  exchange(instanceId: string, token: string): string | undefined {
    const hash = hashOf(token);
    const waiting = this.handOffs.get(hash);
    this.handOffs.delete(hash);
    if (waiting === undefined || waiting.instanceId !== instanceId) return undefined;
    if (waiting.expiresAt <= this.schedule.now().getTime()) return undefined;
    if (!this.running.isRunning(instanceId)) return undefined;
    const value = randomBytes(32).toString("base64url");
    const kept = this.sessions.get(instanceId) ?? new Set<string>();
    kept.add(hashOf(value));
    this.sessions.set(instanceId, kept);
    return value;
  }

  /** Whether a cookie's value is a session of the Running instance. */
  admits(instanceId: string, value: string | undefined): boolean {
    if (value === undefined || !this.running.isRunning(instanceId)) return false;
    return this.sessions.get(instanceId)?.has(hashOf(value)) ?? false;
  }

  /** It ended: its sessions and its waiting tokens go. */
  private end(instanceId: string): void {
    this.sessions.delete(instanceId);
    for (const [hash, waiting] of this.handOffs) {
      if (waiting.instanceId === instanceId) this.handOffs.delete(hash);
    }
  }
}

function hashOf(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
