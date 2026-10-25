import type { z } from "zod";

/** Where the service answers, on the page's own origin. */
const API_PATH = "/api";

/** A request the service refused or failed, with what it said. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Reads `path` under /api and checks the answer against its contract schema, so every caller gets
 * the contract's type or an error, never an unchecked body.
 */
export async function getFromApi<Schema extends z.ZodType>(
  path: `/${string}`,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.infer<Schema>> {
  const response = await fetch(`${API_PATH}${path}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, await refusalOf(response));
  return schema.parse(await response.json());
}

/** Nest answers errors with `{ message }`; anything else is shown by its status. */
async function refusalOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "message" in body) {
      return String(body.message);
    }
  } catch {
    // Not JSON: fall through to the status.
  }
  return `The service answered ${response.status} ${response.statusText}.`;
}
