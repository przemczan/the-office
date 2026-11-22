import { officeActionBody, officeActionPath, type OfficeAction } from "@the-office/contracts";
import type { z } from "zod";

/** Where the service answers, on the page's own origin. */
const API_PATH = "/api";

/** A request the service refused or failed, with what it said. */
export class ApiError extends Error {
  /** Every reason the service gave; a refusal of several rules names each, otherwise the message. */
  readonly reasons: readonly string[];

  constructor(
    readonly status: number,
    message: string,
    reasons: readonly string[] = [message],
  ) {
    super(message);
    this.name = "ApiError";
    this.reasons = reasons;
  }
}

/**
 * The service answered 401: this browser is not a signed-in device, never was or was signed out
 * (spec §2.10). The app sends the user to the sign-in page on it (`app.tsx`).
 */
export class SignedOut extends ApiError {
  constructor(message = "Sign in to The Office first.") {
    super(401, message);
    this.name = "SignedOut";
  }
}

/**
 * A refusal whose body a contract schema describes, such as a sign-in's with when to try again;
 * `refusal` is that body, checked.
 */
export class RefusedAs<Refusal> extends ApiError {
  constructor(
    status: number,
    message: string,
    readonly refusal: Refusal,
  ) {
    super(status, message);
    this.name = "RefusedAs";
  }
}

/**
 * Whether a failed query is tried again: not when the service refused it, since asking again gets
 * the same answer, and at most three times otherwise.
 */
export function shouldRetry(failureCount: number, error: Error): boolean {
  const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
  return !refused && failureCount < 3;
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
  return answerOf(response, schema);
}

/** Sends `body` as JSON to `path` under /api and checks the answer as getFromApi does. */
export async function sendToApi<Schema extends z.ZodType>(
  method: "POST" | "PUT" | "PATCH",
  path: `/${string}`,
  body: unknown,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.infer<Schema>> {
  const response = await fetch(`${API_PATH}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return answerOf(response, schema);
}

/** Deletes what `path` under /api names, and checks the answer as getFromApi does. */
export async function deleteFromApiReturning<Schema extends z.ZodType>(
  path: `/${string}`,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const response = await fetch(`${API_PATH}${path}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  return answerOf(response, schema);
}

/**
 * Carries out an Office action through its route, its method, path and body all from its
 * declaration, the same one its Office tool comes from, and checks the answer as getFromApi does.
 */
export async function callOfficeAction<Input extends z.ZodObject, Answer extends z.ZodType>(
  action: OfficeAction<Input, Answer>,
  input: z.input<Input>,
): Promise<z.infer<Answer>> {
  const body = officeActionBody(action, input);
  const response = await fetch(`${API_PATH}${officeActionPath(action, input)}`, {
    method: action.route.method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return answerOf(response, action.answer);
}

/**
 * Sends a file's bytes to `path` under /api, with its name and `query` in the query, and checks the
 * answer.
 */
export async function sendFileToApi<Schema extends z.ZodType>(
  path: `/${string}`,
  file: File,
  schema: Schema,
  query: Readonly<Record<string, string>> = {},
): Promise<z.infer<Schema>> {
  const search = new URLSearchParams({ ...query, fileName: file.name });
  const response = await fetch(`${API_PATH}${path}?${search}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/octet-stream" },
    body: file,
  });
  return answerOf(response, schema);
}

/** Sends `body` as JSON to `path` under /api; the service answers with no body. */
export async function sendToApiWithNoAnswer(
  method: "POST" | "PUT",
  path: `/${string}`,
  body: unknown,
): Promise<void> {
  const response = await fetch(`${API_PATH}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await refusalOf(response);
}

/**
 * Sends `body` as JSON to `path` under /api as sendToApi does; a refusal whose body
 * `refusalSchema` describes fails as `RefusedAs` with that body, any other as sendToApi's.
 */
export async function sendToApiRefusedAs<
  Schema extends z.ZodType,
  RefusalSchema extends z.ZodType<{ readonly message: string }>,
>(
  method: "POST" | "PUT",
  path: `/${string}`,
  body: unknown,
  schema: Schema,
  refusalSchema: RefusalSchema,
): Promise<z.infer<Schema>> {
  const response = await fetch(`${API_PATH}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return schema.parse(await response.json());
  throw await refusedAs(response, refusalSchema);
}

/**
 * Sends `body` as JSON to `path` under /api as sendToApiWithNoAnswer does; a refusal whose body
 * `refusalSchema` describes fails as `RefusedAs` with that body.
 */
export async function sendToApiWithNoAnswerRefusedAs(
  method: "POST" | "PUT" | "DELETE",
  path: `/${string}`,
  body: unknown,
  refusalSchema: z.ZodType<{ readonly message: string }>,
): Promise<void> {
  const response = await fetch(`${API_PATH}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await refusedAs(response, refusalSchema);
}

/** A refusal as `RefusedAs` when `refusalSchema` describes its body; a 401 is always `SignedOut`. */
async function refusedAs(
  response: Response,
  refusalSchema: z.ZodType<{ readonly message: string }>,
): Promise<Error> {
  const refusal = refusalSchema.safeParse(await bodyOf(response.clone()));
  if (response.status !== 401 && refusal.success) {
    return new RefusedAs(response.status, refusal.data.message, refusal.data);
  }
  return refusalOf(response);
}

/** Deletes what `path` under /api names; the service answers with no body. */
export async function deleteFromApi(path: `/${string}`): Promise<void> {
  const response = await fetch(`${API_PATH}${path}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw await refusalOf(response);
}

async function answerOf<Schema extends z.ZodType>(
  response: Response,
  schema: Schema,
): Promise<z.infer<Schema>> {
  if (!response.ok) throw await refusalOf(response);
  return schema.parse(await response.json());
}

/** Nest answers errors with `{ message }`, refusals also with `reasons`; anything else by its status. */
async function refusalOf(response: Response): Promise<ApiError> {
  if (response.status === 401) return new SignedOut(await messageOf(response));
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "message" in body) {
      const message = String(body.message);
      return new ApiError(response.status, message, reasonsIn(body) ?? [message]);
    }
  } catch {
    // Not JSON: fall through to the status.
  }
  return new ApiError(
    response.status,
    `The service answered ${response.status} ${response.statusText}.`,
  );
}

/** What a 401 said, or undefined to use SignedOut's own words. */
async function messageOf(response: Response): Promise<string | undefined> {
  const body = await bodyOf(response);
  if (typeof body === "object" && body !== null && "message" in body) return String(body.message);
  return undefined;
}

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function reasonsIn(body: object): string[] | undefined {
  if (!("reasons" in body) || !Array.isArray(body.reasons) || body.reasons.length === 0) {
    return undefined;
  }
  return body.reasons.map(String);
}
