import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ContractPipe } from "./contract-pipe.js";

const pipe = new ContractPipe(
  z.object({ name: z.string(), mark: z.object({ label: z.string() }) }),
);

describe("ContractPipe", () => {
  it("passes a value that matches the contract", () => {
    expect(pipe.transform({ name: "Admin", mark: { label: "AP" } })).toEqual({
      name: "Admin",
      mark: { label: "AP" },
    });
  });

  it("answers 400 with where each mismatch is", () => {
    expect(() => pipe.transform({ mark: {} })).toThrow(
      new BadRequestException(
        "name: Invalid input: expected string, received undefined; mark.label: Invalid input: expected string, received undefined",
      ),
    );
  });
});
