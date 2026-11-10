import {
  attachmentSchema,
  searchResultsSchema,
  taskListSchema,
  taskSchema,
  type Attachment,
  type SearchResults,
  type Task,
} from "@the-office/contracts";
import { expect } from "vitest";
import { sendJson, type WorkApplication } from "./work-application.fixtures.js";

export const NONE_IN_OTHER_PROJECTS = { tasks: 0, ideas: 0, initiatives: 0, attachments: 0 };

/** The records and searches the search tests share, on the app and Project `current` gives. */
export function searchHttp(
  current: () => { readonly work: WorkApplication; readonly projectId: string },
) {
  async function createdTask(title: string, fields: object = {}): Promise<Task> {
    const response = await sendJson(current().work, "POST", "/tasks", {
      title,
      projectId: current().projectId,
      priority: "normal",
      ...fields,
    });
    return taskSchema.parse(await response.json());
  }

  async function boardTasks(query: string): Promise<string[]> {
    const params = new URLSearchParams({ query });
    const response = await fetch(`${current().work.url}/api/tasks?${params}`);
    expect(response.status).toBe(200);
    return taskListSchema.parse(await response.json()).map(({ title }) => title);
  }

  /** The Project filter shows the `projects` named, every Project when none is. */
  async function searched(query: string, projects: readonly string[] = []): Promise<SearchResults> {
    const params = new URLSearchParams([
      ["query", query],
      ...projects.map((id): [string, string] => ["project", id]),
    ]);
    const response = await fetch(`${current().work.url}/api/search?${params}`);
    expect(response.status).toBe(200);
    return searchResultsSchema.parse(await response.json());
  }

  async function uploaded(path: string, name: string, content: string): Promise<Attachment> {
    const query = new URLSearchParams({ fileName: name, mediaType: "text/markdown" });
    const response = await fetch(`${current().work.url}/api${path}/attachments/files?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new TextEncoder().encode(content),
    });
    expect(response.status).toBe(201);
    return attachmentSchema.parse(await response.json());
  }

  return { createdTask, boardTasks, searched, uploaded };
}
