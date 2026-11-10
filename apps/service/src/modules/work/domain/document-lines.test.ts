import { describe, expect, it } from "vitest";
import { documentReader, lineCountWords, type DocumentReading } from "./document-lines.js";

const BUDGET = 25_000;

function read(lines: readonly string[], reading: DocumentReading, budget = BUDGET) {
  const reader = documentReader(reading, budget);
  for (const line of lines) reader.take(line);
  return reader.part();
}

function slice(fromLine: number, lineCount: number): DocumentReading {
  return { kind: "slice", fromLine, lineCount };
}

function search(phrase: string, fromLine = 1, contextLines = 2): DocumentReading {
  return { kind: "search", phrase, fromLine, contextLines };
}

const TEN = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`);

describe("a slice", () => {
  it("gives the lines asked for, numbered, and where to read on", () => {
    expect(read(TEN, slice(4, 3))).toEqual({
      lineCount: 10,
      text: "     4→line 4\n     5→line 5\n     6→line 6\n\nLines 4–6 of 10. Read on with fromLine 7.",
    });
  });

  it("says it reached the end of the document", () => {
    expect(read(TEN, slice(9, 5)).text).toBe(
      "     9→line 9\n    10→line 10\n\nLines 9–10 of 10: the end of the document.",
    );
  });

  it("says when it starts past the end", () => {
    expect(read(TEN, slice(11, 5)).text).toBe(
      "The document has 10 lines; fromLine 11 is past its end.",
    );
  });

  it("says an empty document is empty", () => {
    expect(read([], slice(1, 5))).toEqual({ lineCount: 0, text: "The document is empty." });
  });

  it("stops at the budget before the lines asked for, and reads on from there", () => {
    const long = Array.from({ length: 100 }, (_, index) => `${index + 1} ${"x".repeat(990)}`);

    const part = read(long, slice(1, 100), 10_000);

    expect(part.text.length).toBeLessThanOrEqual(10_000);
    expect(part.text).toMatch(
      /\n\nLines 1–9 of 100; one answer holds no more\. Read on with fromLine 10\.$/,
    );
  });

  it("cuts a single line longer than the budget, saying so", () => {
    const part = read(["x".repeat(50_000), "next"], slice(1, 10), 10_000);

    expect(part.text.length).toBeLessThanOrEqual(10_000);
    expect(part.text).toMatch(
      /^ {5}1→x+\n\nLine 1 of 2; one answer holds no more\. Read on with fromLine 2\. Line 1 is longer than one answer can hold, so it is cut: these are its first 9,592 of 50,000 characters\.$/,
    );
  });

  it("reads on past a long line that didn't fit, giving it a slice of its own", () => {
    const part = read(["short", "x".repeat(50_000)], slice(1, 10), 10_000);

    expect(part.text).toBe(
      "     1→short\n\nLine 1 of 2; one answer holds no more. Read on with fromLine 2.",
    );
  });
});

describe("a search", () => {
  const lines = [
    "Intro",
    "Nikon uses PTP.",
    "Its vendor operations",
    "extend ptp",
    "for live view.",
    "Unrelated",
    "Unrelated",
    "Unrelated",
    "Canon adds PTP too.",
    "End",
  ];

  it("shows each match with the lines around it, close ones sharing them, groups apart", () => {
    expect(read(lines, search("ptp", 1, 1))).toEqual({
      lineCount: 10,
      text: [
        "     1-Intro",
        "     2:Nikon uses PTP.",
        "     3-Its vendor operations",
        "     4:extend ptp",
        "     5-for live view.",
        "--",
        "     8-Unrelated",
        "     9:Canon adds PTP too.",
        "    10-End",
        "",
        "3 matches shown, up to line 9; none after it: the search reached the end of the document.",
      ].join("\n"),
    });
  });

  it("matches whatever the case", () => {
    expect(read(["NIKON", "nikon", "Nikon"], search("nIKoN", 1, 0)).text).toBe(
      "     1:NIKON\n     2:nikon\n     3:Nikon\n\n3 matches shown, up to line 3; none after it: the search reached the end of the document.",
    );
  });

  it("matches a phrase with regular expression characters literally", () => {
    const part = read(["a (b) c", "a b c", "price $5.00?", "price X5a00"], search("$5.00?", 1, 0));

    expect(part.text).toBe(
      "     3:price $5.00?\n\n1 match shown, up to line 3; none after it: the search reached the end of the document.",
    );
    expect(read(["a (b) c", "a b c"], search("(b)", 1, 0)).text).toContain(
      "     1:a (b) c\n\n1 match",
    );
  });

  it("starts at fromLine, so the next page of matches reads on the same way", () => {
    expect(read(lines, search("ptp", 5, 1)).text).toBe(
      "     8-Unrelated\n     9:Canon adds PTP too.\n    10-End\n\n1 match from line 5 on shown, up to line 9; none after it: the search reached the end of the document.",
    );
  });

  it("says when no line holds the phrase", () => {
    expect(read(lines, search("USB")).text).toBe("No line holds the phrase.");
    expect(read(lines, search("Intro", 2)).text).toBe("No line from line 2 on holds the phrase.");
  });

  it("says when it starts past the end", () => {
    expect(read(lines, search("ptp", 11)).text).toBe(
      "The document has 10 lines; fromLine 11 is past its end.",
    );
  });

  it("stops at the budget, counting the matches after it and saying where to search on", () => {
    const many = Array.from(
      { length: 1_000 },
      (_, index) => `${index + 1} match ${"y".repeat(90)}`,
    );

    const part = read(many, search("match", 1, 0), 5_000);

    expect(part.text.length).toBeLessThanOrEqual(5_000);
    expect(part.text).toMatch(
      /\n\n4\d matches shown, up to line (4\d); 95\d more after it\. Search on with fromLine (4\d)\.$/,
    );
    const [, upTo, searchOn] = /up to line (\d+);.*fromLine (\d+)\.$/.exec(part.text) ?? [];
    expect(Number(searchOn)).toBe(Number(upTo) + 1);
    expect(part.text).toContain(`${upTo?.padStart(6)}:${upTo} match`);
  });

  it("cuts a single matching line longer than the budget, saying so", () => {
    const part = read(
      ["context", `match ${"z".repeat(50_000)}`, "match again"],
      search("match"),
      10_000,
    );

    expect(part.text.length).toBeLessThanOrEqual(10_000);
    expect(part.text).toMatch(
      /^ {5}2:match z+\n\n1 match shown, up to line 2; 1 more after it\. Search on with fromLine 3\. Line 2 is longer than one answer can hold, so it is cut: these are its first 9,592 of 50,006 characters\.$/,
    );
  });

  it("numbers lines as a slice does, so a match's line starts a slice at it", () => {
    const found = read(lines, search("Canon", 1, 0)).text;
    const line = /^ +(\d+):/.exec(found)?.[1];

    expect(read(lines, slice(Number(line), 1)).text).toBe(
      "     9→Canon adds PTP too.\n\nLine 9 of 10. Read on with fromLine 10.",
    );
  });
});

describe("lineCountWords", () => {
  it("counts lines in words", () => {
    expect(lineCountWords(1)).toBe("1 line");
    expect(lineCountWords(1_312)).toBe("1,312 lines");
  });
});
