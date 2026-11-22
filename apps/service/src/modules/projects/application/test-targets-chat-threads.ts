import { Injectable } from "@nestjs/common";
import type { TestTargetsChatThread } from "../domain/test-targets-chat.js";

/** A chat Thread started with whoever holds "Onboards and repairs Projects", or why none was. */
export type TestTargetsChatThreadStart =
  | { readonly kind: "started"; readonly threadId: string; readonly roleKey: string }
  | { readonly kind: "nobody" }
  | { readonly kind: "refused"; readonly reasons: readonly string[] };

/** What Conversations gives for the Project page's Set up test targets chat. */
export interface TestTargetsChatThreadSource {
  /**
   * A new chat Thread titled `title` with whoever holds "Onboards and repairs Projects", with no
   * message sent; `nobody` while nobody holds it, `refused` with Conversations' reasons.
   */
  start(title: string): Promise<TestTargetsChatThreadStart>;
  /** What the Thread holds now, its Proposals of `projectId`'s test targets; undefined once gone. */
  read(threadId: string, projectId: string): Promise<TestTargetsChatThread | undefined>;
}

/**
 * Where the Set up test targets chat is started and read, registered by Conversations as it starts:
 * Conversations reads Projects, so Projects can't ask it directly (the module template's registry).
 */
@Injectable()
export class TestTargetsChatThreads {
  private source: TestTargetsChatThreadSource | undefined;

  register(source: TestTargetsChatThreadSource): void {
    this.source = source;
  }

  start(title: string): Promise<TestTargetsChatThreadStart> {
    return this.registered().start(title);
  }

  read(threadId: string, projectId: string): Promise<TestTargetsChatThread | undefined> {
    return this.registered().read(threadId, projectId);
  }

  private registered(): TestTargetsChatThreadSource {
    if (!this.source) throw new Error("No source of the test targets chat is registered.");
    return this.source;
  }
}
