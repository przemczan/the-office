/**
 * An MCP tool's call in the user's words, for its approval. Its input's keys are sorted, so the
 * same call reads the same however the Agent orders them, and its repeat finds the approval.
 */
export function mcpToolCallWords(call: {
  readonly server: string;
  readonly tool: string;
  readonly input: unknown;
}): string {
  return `Call the ${call.server}/${call.tool} MCP tool with ${JSON.stringify(sortedKeys(call.input))}`;
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
      .map(([key, entry]) => [key, sortedKeys(entry)]),
  );
}
