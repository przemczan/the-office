import { healthReportSchema } from "@the-office/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError, getFromApi, sendToApi, shouldRetry } from "./api-client.ts";

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
    answer(200, { database: "up" });

    await expect(getFromApi("/health", healthReportSchema)).resolves.toEqual({ database: "up" });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/health");
  });

  it("refuses an answer that breaks the contract", async () => {
    answer(200, { database: "sideways" });

    await expect(getFromApi("/health", healthReportSchema)).rejects.toBeInstanceOf(ZodError);
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
    answer(200, { database: "up" });

    await expect(sendToApi("PUT", "/health", { check: true }, healthReportSchema)).resolves.toEqual(
      { database: "up" },
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

  it("tries a failure on the way or in the service three times", () => {
    expect(shouldRetry(0, new ApiError(503, "Down."))).toBe(true);
    expect(shouldRetry(2, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetry(3, new TypeError("Failed to fetch"))).toBe(false);
  });
});
