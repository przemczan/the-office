import { Inject, Injectable } from "@nestjs/common";
import { asc, desc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads, readKey, readOnce } from "../../../../platform/database/read-scope.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Attachment } from "../../domain/attachment.js";
import type { Idea } from "../../domain/idea.js";
import type { IdeaChange } from "../../domain/idea-changes.js";
import { IdeaNotFound } from "../../domain/idea-not-found.js";
import {
  IdeaRepository,
  type IdeaShapedIntoInitiative,
  type IdeaUpdate,
  type ShapedIdea,
} from "../../ports/idea-repository.js";
import { attachments, ideas, initiatives } from "./work.schema.js";
import {
  canBeRowId,
  holdManualOrder,
  insertTask,
  ownerColumns,
  takenOrders,
  toAttachment,
  toIdea,
  toIdeaRow,
  toInitiativeRow,
  type Transaction,
} from "./work-rows.js";

@Injectable()
export class PostgresIdeaRepository extends IdeaRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(idea: Idea): Promise<void> {
    await forgettingReads(() => this.database.insert(ideas).values(toIdeaRow(idea)));
  }

  find(id: string): Promise<Idea | undefined> {
    return readOnce(readKey("ideas.find", id), async () => {
      if (!canBeRowId(id)) return undefined;
      const [row] = await this.database.select().from(ideas).where(eq(ideas.id, id));
      return row && toIdea(row);
    });
  }

  async list(): Promise<readonly Idea[]> {
    const rows = await this.database
      .select()
      .from(ideas)
      .orderBy(desc(ideas.capturedAt), asc(ideas.id));
    return rows.map(toIdea);
  }

  async update<Event extends DomainEvent>(
    id: string,
    change: (idea: Idea) => IdeaChange<Event> | undefined,
  ): Promise<IdeaUpdate<Event>> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const idea = await heldIdea(transaction, id);
        const changed = change(idea);
        if (!changed) return { idea, event: undefined };
        await transaction.update(ideas).set(toIdeaRow(changed.idea)).where(eq(ideas.id, id));
        return changed;
      }),
    );
  }

  async shape(
    id: string,
    shape: (
      idea: Idea,
      attachments: readonly Attachment[],
      takenOrders: readonly string[],
    ) => ShapedIdea,
  ): Promise<ShapedIdea> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        await holdManualOrder(transaction);
        const idea = await heldIdea(transaction, id);
        const shaped = shape(
          idea,
          await attachmentsOf(transaction, id),
          await takenOrders(transaction),
        );
        await insertTask(transaction, shaped.taskCreated);
        await saveShapedIdea(transaction, shaped);
        return shaped;
      }),
    );
  }

  async shapeIntoInitiative(
    id: string,
    shape: (idea: Idea, attachments: readonly Attachment[]) => IdeaShapedIntoInitiative,
  ): Promise<IdeaShapedIntoInitiative> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const idea = await heldIdea(transaction, id);
        const shaped = shape(idea, await attachmentsOf(transaction, id));
        await transaction
          .insert(initiatives)
          .values(toInitiativeRow(shaped.initiativeCreated.initiative));
        await saveShapedIdea(transaction, shaped);
        return shaped;
      }),
    );
  }
}

/** The shaped Idea, and its Attachments with what it became as their owner. */
async function saveShapedIdea(
  transaction: Transaction,
  shaped: ShapedIdea | IdeaShapedIntoInitiative,
): Promise<void> {
  const { idea } = shaped.ideaShaped;
  await transaction.update(ideas).set(toIdeaRow(idea)).where(eq(ideas.id, idea.id));
  for (const { attachment } of shaped.moves) {
    await transaction
      .update(attachments)
      .set(ownerColumns(attachment.owner))
      .where(eq(attachments.id, attachment.id));
  }
}

async function heldIdea(transaction: Transaction, id: string): Promise<Idea> {
  if (!canBeRowId(id)) throw new IdeaNotFound(id);
  const [row] = await transaction.select().from(ideas).where(eq(ideas.id, id)).for("update");
  if (!row) throw new IdeaNotFound(id);
  return toIdea(row);
}

async function attachmentsOf(transaction: Transaction, ideaId: string): Promise<Attachment[]> {
  const rows = await transaction
    .select()
    .from(attachments)
    .where(eq(attachments.ideaId, ideaId))
    .for("update");
  return rows.map(toAttachment);
}
