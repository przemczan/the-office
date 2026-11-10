import { attachmentSchema, type Attachment, type Task } from "@the-office/contracts";
import { expect } from "vitest";
import type { WorkApplication } from "./work-application.fixtures.js";

/** The uploads and reads of the Attachments routes' tests, on `current`'s app and Task. */
export function attachmentsHttp(
  current: () => { readonly work: WorkApplication; readonly task: Task },
) {
  async function upload(
    path: string,
    name: string,
    mediaType: string,
    content: string | Uint8Array,
  ): Promise<Response> {
    const query = new URLSearchParams({ fileName: name, mediaType });
    return fetch(`${current().work.url}/api${path}?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: typeof content === "string" ? new TextEncoder().encode(content) : content,
    });
  }

  async function uploadToTask(
    name: string,
    mediaType: string,
    content: string,
  ): Promise<Attachment> {
    const path = `/tasks/${current().task.id}/attachments/files`;
    const response = await upload(path, name, mediaType, content);
    expect(response.status).toBe(201);
    return attachmentSchema.parse(await response.json());
  }

  function contentOf(attachment: Attachment): Promise<Response> {
    return fetch(`${current().work.url}/api/attachments/${attachment.id}/content`);
  }

  return { upload, uploadToTask, contentOf };
}
