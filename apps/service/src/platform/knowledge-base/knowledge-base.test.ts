import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeBase } from "./knowledge-base.js";

const CHECKOUT_SPEC = fileURLToPath(new URL("../../../../../docs/spec/", import.meta.url));

describe("KnowledgeBase", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds docs/spec/ of the install the service runs from, the checkout here", () => {
    const knowledgeBase = KnowledgeBase.at();

    expect(knowledgeBase.folder).toBe(path.resolve(CHECKOUT_SPEC));
    expect(knowledgeBase.index).toBe(path.join(path.resolve(CHECKOUT_SPEC), "README.md"));
    expect(knowledgeBase.readableFolders).toEqual([path.resolve(CHECKOUT_SPEC)]);
  });

  it("is none, logged, where the install has no index", () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const empty = mkdtempSync(path.join(tmpdir(), "office-knowledge-base-"));
    try {
      const knowledgeBase = KnowledgeBase.at(empty);

      expect(knowledgeBase.folder).toBeUndefined();
      expect(knowledgeBase.index).toBeUndefined();
      expect(knowledgeBase.readableFolders).toEqual([]);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain(`No knowledge base at ${empty}`);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
