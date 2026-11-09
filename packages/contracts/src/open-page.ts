import { z } from "zod";

/**
 * The Open page (spec §2.4): the record whose page is open beside the chat drawer as the user sends
 * a message there. The person answering is given its record with the message, as a Mention's.
 */
export const openPageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), taskId: z.uuid() }),
  z.object({ kind: z.literal("initiative"), initiativeId: z.uuid() }),
  z.object({ kind: z.literal("idea"), ideaId: z.uuid() }),
  z.object({ kind: z.literal("person"), roleKey: z.string().min(1) }),
  z.object({ kind: z.literal("project"), projectId: z.string().min(1) }),
]);
export type OpenPage = z.infer<typeof openPageSchema>;

/** Whether two Open pages are the same record's. */
export function sameOpenPage(one: OpenPage, other: OpenPage): boolean {
  return openPageKey(one) === openPageKey(other);
}

function openPageKey(page: OpenPage): string {
  switch (page.kind) {
    case "task":
      return `task:${page.taskId}`;
    case "initiative":
      return `initiative:${page.initiativeId}`;
    case "idea":
      return `idea:${page.ideaId}`;
    case "person":
      return `person:${page.roleKey}`;
    case "project":
      return `project:${page.projectId}`;
  }
}
