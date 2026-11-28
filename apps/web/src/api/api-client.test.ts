import { healthReportSchema } from "@the-office/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError, getFromApi, sendToApi, shouldRetry, UnreadableAnswer } from "./api-client.ts";

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => Response.json(body, { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFromApi", () => {
  it("reads a path under /api and returns the contract's value", async () => {
    answer(200, { database: "up", testInstance: false });

    await expect(getFromApi("/health", healthReportSchema)).resolves.toEqual({
      database: "up",
      testInstance: false,
    });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/health");
  });

  it("refuses an answer that breaks the contract, in plain words, keeping what the contract found", async () => {
    answer(200, { database: "sideways" });

    const failure = await getFromApi("/health", healthReportSchema).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(UnreadableAnswer);
    expect(failure).toMatchObject({
      message:
        "The Office answered in a way this page can't read, as after an update. Reload the page.",
    });
    expect((failure as UnreadableAnswer).cause).toBeInstanceOf(ZodError);
  });

  it("fails with what the service said when it refuses", async () => {
    answer(403, { statusCode: 403, message: "The Office answers only its own pages." });

    await expect(getFromApi("/health", healthReportSchema)).rejects.toEqual(
      new ApiError(403, "The Office answers only its own pages."),
    );
  });

  it("keeps every reason of a refusal", async () => {
    answer(422, {
      statusCode: 422,
      message: "No name. No branch.",
      reasons: ["No name.", "No branch."],
    });

    await expect(getFromApi("/health", healthReportSchema)).rejects.toEqual(
      new ApiError(422, "No name. No branch.", ["No name.", "No branch."]),
    );
  });
});

describe("sendToApi", () => {
  it("sends the body as JSON and returns the contract's value", async () => {
    answer(200, { database: "up", testInstance: false });

    await expect(sendToApi("PUT", "/health", { check: true }, healthReportSchema)).resolves.toEqual(
      { database: "up", testInstance: false },
    );
    const [path, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(path).toBe("/api/health");
    expect(init).toMatchObject({ method: "PUT", body: '{"check":true}' });
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });
});

describe("shouldRetry", () => {
  it("doesn't ask again what the service refused", () => {
    expect(shouldRetry(0, new ApiError(404, 'There is no Project "x".'))).toBe(false);
  });

  it("doesn't ask again for an answer this page can't read", () => {
    const zodError = healthReportSchema.safeParse({ database: "sideways" }).error;
    if (zodError === undefined) throw new Error("The answer should break the contract.");

    expect(shouldRetry(0, new UnreadableAnswer(zodError))).toBe(false);
    expect(shouldRetry(0, zodError)).toBe(false);
  });

  it("tries a failure on the way or in the service three times", () => {
    expect(shouldRetry(0, new ApiError(503, "Down."))).toBe(true);
    expect(shouldRetry(2, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetry(3, new TypeError("Failed to fetch"))).toBe(false);
  });
});
