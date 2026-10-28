import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, type SQL } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Attachment, AttachmentOwner } from "../../domain/attachment.js";
import { AttachmentRepository } from "../../ports/attachment-repository.js";
import { attachments } from "./work.schema.js";
import { toAttachment, toAttachmentRow } from "./work-rows.js";

@Injectable()
export class PostgresAttachmentRepository extends AttachmentRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(attachment: Attachment): Promise<void> {
    await this.database.insert(attachments).values(toAttachmentRow(attachment));
  }

  async find(id: string): Promise<Attachment | undefined> {
    const [row] = await this.database.select().from(attachments).where(eq(attachments.id, id));
    return row && toAttachment(row);
  }

  async listOf(owner: AttachmentOwner): Promise<readonly Attachment[]> {
    const rows = await this.database
      .select()
      .from(attachments)
      .where(ownedBy(owner))
      .orderBy(asc(attachments.addedAt), asc(attachments.id));
    return rows.map(toAttachment);
  }

  async remove(id: string): Promise<void> {
    await this.database.delete(attachments).where(eq(attachments.id, id));
  }
}

function ownedBy(owner: AttachmentOwner): SQL {
  switch (owner.kind) {
    case "idea":
      return eq(attachments.ideaId, owner.ideaId);
    case "initiative":
      return eq(attachments.initiativeId, owner.initiativeId);
    case "task":
      return eq(attachments.taskId, owner.taskId);
  }
}
