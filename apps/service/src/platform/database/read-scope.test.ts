import { describe, expect, it, vi } from "vitest";
import { forgettingReads, inReadScope, readKey, readOnce, startInReadScope } from "./read-scope.js";

function countedRead(answer = "row") {
  return vi.fn<() => Promise<string>>(() => Promise.resolve(answer));
}

describe("readOnce", () => {
  it("reads every time outside a scope", async () => {
    const read = countedRead();

    await readOnce("roles.list", read);
    await readOnce("roles.list", read);

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads once per key within a scope, reads asked at the same time sharing one", async () => {
    const read = countedRead();

    const answers = await inReadScope(async () => {
      const together = await Promise.all([
        readOnce("roles.list", read),
        readOnce("roles.list", read),
      ]);
      return [...together, await readOnce("roles.list", read)];
    });

    expect(answers).toEqual(["row", "row", "row"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps reads of different arguments apart", async () => {
    const read = countedRead();

    await inReadScope(async () => {
      await readOnce(readKey("roles.find", "developer"), read);
      await readOnce(readKey("roles.find", "reviewer"), read);
      await readOnce(readKey("roles.find", "developer"), read);
    });

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads again after a write within the scope, and after a read that failed", async () => {
    const read = countedRead();
    const failing = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValue("row");

    await inReadScope(async () => {
      await readOnce("roles.list", read);
      await forgettingReads(() => Promise.resolve());
      await readOnce("roles.list", read);

      await expect(readOnce("dutyAssignments", failing)).rejects.toThrow("connection lost");
      await expect(readOnce("dutyAssignments", failing)).resolves.toBe("row");
    });

    expect(read).toHaveBeenCalledTimes(2);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("forgets the scope's reads even when the write fails", async () => {
    const read = countedRead();

    await inReadScope(async () => {
      await readOnce("roles.list", read);
      await expect(forgettingReads(() => Promise.reject(new Error("refused")))).rejects.toThrow(
        "refused",
      );
      await readOnce("roles.list", read);
    });

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads every time once the scope has ended, for work it left running", async () => {
    const read = countedRead();
    let endedScope: (() => void) | undefined;
    const scopeEnded = new Promise<void>((resolve) => (endedScope = resolve));
    let readWhileOpen = Promise.resolve();
    let readAfterEnd = Promise.resolve();

    const endScope = startInReadScope(() => {
      readWhileOpen = (async () => {
        await readOnce("roles.list", read);
        await readOnce("roles.list", read);
      })();
      readAfterEnd = (async () => {
        await scopeEnded;
        await readOnce("roles.list", read);
        await readOnce("roles.list", read);
      })();
    });
    await readWhileOpen;
    endScope();
    endedScope?.();
    await readAfterEnd;

    expect(read).toHaveBeenCalledTimes(3);
  });
});
