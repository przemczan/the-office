import type { INestApplication } from "@nestjs/common";
import type { OfficeAction } from "@the-office/contracts";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";

/** The Office tool of an action, as an Agent's session runs it with every call let through. */
export function toolOf(app: INestApplication, action: OfficeAction) {
  const [tool] = app.get(OfficeToolRegistry).named([action.name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${action.name}.`);
  return tool;
}

/** Sends a request to the service's API. */
export function sender(url: string) {
  return (method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}
