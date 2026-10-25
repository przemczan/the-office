import { Injectable } from "@nestjs/common";
import { freshChatThreadBrief, newChatThreadBrief, type Brief } from "../domain/brief.js";
import type { Thread } from "../domain/thread.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/** Assembles each new session's Brief from the record, with no model call (spec §2.5). */
@Injectable()
export class Briefs {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly bases: ProjectBases,
  ) {}

  /**
   * The Brief of a chat Thread's next session: a new Thread's, or the one it continues fresh with
   * from its log so far. Read before the message it answers is logged.
   */
  async forChatThread(thread: Thread): Promise<Brief> {
    const projects = await this.bases.list();
    if (thread.session === undefined) return newChatThreadBrief(projects);
    const log = await this.repository.messages(thread.id);
    return freshChatThreadBrief({ title: thread.title, log, projects });
  }
}
