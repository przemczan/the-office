import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { mcpServerReviewSchema, type ServerValueEdit } from "@the-office/contracts";

/** The service's fake local MCP server, which the service starts with Node as it is. */
export const FAKE_MCP_SERVER = fileURLToPath(
  new URL("../../service/src/platform/mcp/fake-stdio-mcp-server.fixtures.ts", import.meta.url),
);

/** Its tools, as it lists them. */
export const FAKE_MCP_TOOLS = ["echo", "environment-variable", "started-process"];

/** A test connection starts Node and the MCP SDK, which takes a while on a cold start. */
export const CONNECTING = { timeout: 30_000 };

/** Adds the fake server to the library under `name`, off until reviewed. */
export async function addFakeMcpServer(
  page: Page,
  name: string,
  serverValues: readonly ServerValueEdit[] = [],
): Promise<void> {
  const added = await page.request.post("/api/mcp-servers", {
    data: {
      name,
      transport: "stdio",
      command: process.execPath,
      arguments: [FAKE_MCP_SERVER],
      serverValues,
    },
  });
  expect(added.status()).toBe(201);
}

/** Adds the fake server and turns it on with the tools its review lists, as the user would. */
export async function addFakeMcpServerTurnedOn(page: Page, name: string): Promise<void> {
  await addFakeMcpServer(page, name);
  const path = `/api/mcp-servers/${encodeURIComponent(name)}`;
  const review = mcpServerReviewSchema.parse(
    await (await page.request.get(`${path}/review`, CONNECTING)).json(),
  );
  if (!review.connected) throw new Error(`The fake MCP server didn't connect: ${review.problem}`);
  const turnedOn = await page.request.put(`${path}/state`, {
    data: { state: "on", reviewDigest: review.reviewDigest },
  });
  expect(turnedOn.status()).toBe(200);
}
