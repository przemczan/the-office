import type { TestTargetsChat } from "../domain/test-targets-chat.js";

/** Every chat each Project's page asked to set up its test targets in (spec §2.12). */
export abstract class TestTargetsChatRepository {
  /** Keeps a chat just asked, of a Project that exists. */
  abstract add(chat: TestTargetsChat): Promise<void>;

  /** The Project's newest chat, the one its page follows; undefined while none was asked. */
  abstract newestOf(projectId: string): Promise<TestTargetsChat | undefined>;
}
