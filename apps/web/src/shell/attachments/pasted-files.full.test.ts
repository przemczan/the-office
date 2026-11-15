import { describe, expect, it } from "vitest";
import { clipboardOf, screenshot } from "./pasted-files.fixtures.ts";
import { pastedFiles, pastedImageName } from "./pasted-files.ts";

const NOW = new Date(2026, 10, 5, 9, 4, 3);

describe("pastedFiles", () => {
  it("names a screenshot by when it was pasted, with no colon", () => {
    const [file] = pastedFiles(clipboardOf([screenshot()]), NOW);
    expect(file?.name).toBe("Pasted image 2026-11-05 09.04.03.png");
    expect(file?.type).toBe("image/png");
  });

  it("numbers the later images of one paste", () => {
    const names = pastedFiles(clipboardOf([screenshot(), screenshot(), screenshot()]), NOW).map(
      (file) => file.name,
    );
    expect(names).toEqual([
      "Pasted image 2026-11-05 09.04.03.png",
      "Pasted image 2026-11-05 09.04.03-2.png",
      "Pasted image 2026-11-05 09.04.03-3.png",
    ]);
  });

  it("names an image with no name by its type", () => {
    const unnamed = new File(["gif"], "", { type: "image/gif" });
    expect(pastedFiles(clipboardOf([unnamed]), NOW)[0]?.name).toBe(
      "Pasted image 2026-11-05 09.04.03.gif",
    );
  });

  it("keeps a file's own name", () => {
    const files = [screenshot("Login page.png"), new File(["# Notes"], "notes.md")];
    expect(pastedFiles(clipboardOf(files), NOW).map((file) => file.name)).toEqual([
      "Login page.png",
      "notes.md",
    ]);
  });

  it("takes nothing from a paste that holds plain text, though a picture comes with it", () => {
    expect(pastedFiles(clipboardOf([screenshot()], "A1\tB1"), NOW)).toEqual([]);
  });

  it("takes nothing from an empty clipboard", () => {
    expect(pastedFiles(clipboardOf([]), NOW)).toEqual([]);
    expect(pastedFiles(null, NOW)).toEqual([]);
  });
});

describe("pastedImageName", () => {
  it("uses no character Windows forbids in a file name", () => {
    expect(pastedImageName(new Date(2026, 0, 1, 23, 59, 59), "png")).not.toMatch(/[<>:"/\\|?*]/);
  });
});
