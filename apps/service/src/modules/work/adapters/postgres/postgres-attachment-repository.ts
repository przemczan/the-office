import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads, readKey, readOnce } from "../../../../platform/database/read-scope.js";
import type { Attachment, AttachmentOwner, StoredFileAttachment } from "../../domain/attachment.js";
import { AttachmentRepository } from "../../ports/attachment-repository.js";
import { attachments, attachmentTexts } from "./work.schema.js";
import { toAttachment, toAttachmentRow } from "./work-rows.js";

@Injectable()
export class PostgresAttachmentRepository extends AttachmentRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(attachment: Attachment, documentText?: string): Promise<void> {
    await forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        await transaction.insert(attachments).values(toAttachmentRow(attachment));
        if (documentText !== undefined) {
          await transaction
            .insert(attachmentTexts)
            .values({ attachmentId: attachment.id, text: documentText });
        }
      }),
    );
  }

  async replace(file: StoredFileAttachment, documentText?: string): Promise<void> {
    return forgettingReads(async () => {
      const { id, ...copy } = toAttachmentRow(file);
      await this.database.transaction(async (transaction) => {
        await transaction.update(attachments).set(copy).where(eq(attachments.id, id));
        await transaction.delete(attachmentTexts).where(eq(attachmentTexts.attachmentId, id));
        if (documentText !== undefined) {
          await transaction
            .insert(attachmentTexts)
            .values({ attachmentId: id, text: documentText });
        }
      });
    });
  }

  find(id: string): Promise<Attachment | undefined> {
    return readOnce(readKey("attachments.find", id), async () => {
      const [row] = await this.database.select().from(attachments).where(eq(attachments.id, id));
      return row && toAttachment(row);
    });
  }

  async findAll(ids: readonly string[]): Promise<readonly Attachment[]> {
    if (ids.length === 0) return [];
    const rows = await this.database
      .select()
      .from(attachments)
      .where(inArray(attachments.id, [...ids]));
    return rows.map(toAttachment);
  }

  listOf(owner: AttachmentOwner): Promise<readonly Attachment[]> {
    return readOnce(readKey("attachments.listOf", owner), async () => {
      const rows = await this.database
        .select()
        .from(attachments)
        .where(ownedBy(owner))
        .orderBy(asc(attachments.addedAt), asc(attachments.id));
      return rows.map(toAttachment);
    });
  }

  async documentsWithoutText(): Promise<readonly Attachment[]> {
    const rows = await this.database
      .select({ attachment: attachments })
      .from(attachments)
      .leftJoin(attachmentTexts, eq(attachmentTexts.attachmentId, attachments.id))
      .where(and(eq(attachments.kind, "document"), isNull(attachmentTexts.attachmentId)));
    return rows.map(({ attachment }) => toAttachment(attachment));
  }

  async keepDocumentText(attachmentId: string, text: string): Promise<void> {
    await forgettingReads(() =>
      this.database.insert(attachmentTexts).values({ attachmentId, text }).onConflictDoNothing(),
    );
  }

  async filesNotJudged(): Promise<readonly StoredFileAttachment[]> {
    const rows = await this.database
      .select()
      .from(attachments)
      .where(and(ne(attachments.kind, "link"), isNull(attachments.text)));
    return rows.map(toAttachment).filter((file) => file.kind !== "link");
  }

  async keepJudgement(attachmentId: string, text: boolean): Promise<void> {
    await forgettingReads(() =>
      this.database
        .update(attachments)
        .set({ text })
        .where(and(eq(attachments.id, attachmentId), isNull(attachments.text))),
    );
  }

  /** Its text goes with it. */
  async remove(id: string): Promise<void> {
    await forgettingReads(() => this.database.delete(attachments).where(eq(attachments.id, id)));
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
    case "thread":
      return eq(attachments.threadId, owner.threadId);
  }
}
