import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveWhenFree } from "./move-when-free.js";

type Rename = typeof import("node:fs/promises").rename;

// The real rename unless a test makes it fail.
const fs = vi.hoisted(() => ({
  rename: vi.fn<Rename>(),
  realRename: undefined as Rename | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  fs.realRename = original.rename;
  return { ...original, rename: fs.rename };
});
const { rename } = fs;

let folder: string;

beforeEach(async () => {
  rename.mockReset();
  if (fs.realRename) rename.mockImplementation(fs.realRename);
  folder = await mkdtemp(join(tmpdir(), "office-move-when-free-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(folder, { recursive: true, force: true });
});

function failure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("moveWhenFree", () => {
  it("tries again while the folder is busy, then renames it", async () => {
    await mkdir(join(folder, "from"));
    rename.mockRejectedValueOnce(failure("EPERM")).mockRejectedValueOnce(failure("EBUSY"));

    await moveWhenFree(join(folder, "from"), join(folder, "to"));

    expect(await readdir(folder)).toEqual(["to"]);
  });

  it("gives up on a folder still busy after its last try", async () => {
    vi.useFakeTimers();
    rename.mockRejectedValue(failure("EACCES"));

    const moved = moveWhenFree(join(folder, "from"), join(folder, "to"));
    const refusal = moved.catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(await refusal).toMatchObject({ code: "EACCES" });
    expect(rename).toHaveBeenCalledTimes(5);
  });

  it("fails at once for anything but a busy folder", async () => {
    await expect(moveWhenFree(join(folder, "missing"), join(folder, "to"))).rejects.toThrow(
      "ENOENT",
    );
  });
});
