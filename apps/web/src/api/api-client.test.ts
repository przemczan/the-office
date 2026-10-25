import { healthReportSchema } from "@the-office/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError, getFromApi } from "./api-client.ts";

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
});
