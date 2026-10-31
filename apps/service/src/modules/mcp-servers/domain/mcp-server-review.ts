import { createHash } from "node:crypto";
import type { McpServer, McpServerTool } from "./mcp-server.js";

/**
 * What a review showed, as a digest: what runs, the values' names and the tools listed, each
 * tool's description and input schema among them. Turning a server on needs the digest of the
 * review the user saw to match the server as kept and its tools as listed again, so a change
 * made meanwhile, in another window or by the server, is never turned on unreviewed.
 */
export function reviewDigest(server: McpServer, tools: readonly McpServerTool[]): string {
  const reviewed = {
    connection: server.connection,
    serverValueNames: server.serverValues.map(({ name }) => name).toSorted(inCodeOrder),
    tools: tools.toSorted((one, other) => inCodeOrder(one.name, other.name)),
  };
  return createHash("sha256").update(canonicalJson(reviewed)).digest("hex");
}

/** By code unit, never by locale, so the digest is the same wherever it is made. */
function inCodeOrder(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

/** JSON with every object's keys sorted, so a schema's key order changes nothing. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([one], [other]) => inCodeOrder(one, other));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
