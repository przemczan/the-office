import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProposedCommandChanges } from "./devops-proposal-changes.tsx";

function rowsOf(markup: string): string[] {
  const list = document.createElement("div");
  list.innerHTML = markup;
  return [...list.querySelectorAll("li")].map((row) => row.textContent ?? "");
}

describe("ProposedCommandChanges", () => {
  it("shows a command's name on both sides only when the Proposal renames it", () => {
    const rows = rowsOf(
      renderToStaticMarkup(
        <ProposedCommandChanges
          changes={{
            commands: [
              {
                key: "test",
                from: { name: "Test", kind: "test", commandLine: "npm test" },
                to: { name: "Unit tests", kind: "test", commandLine: "npm test" },
              },
              {
                key: "lint",
                from: { name: "Lint", kind: "lint", commandLine: "npm run lint" },
                to: { name: "Lint", kind: "lint", commandLine: "npm run lint:all" },
              },
            ],
          }}
        />,
      ),
    );

    expect(rows).toEqual([
      "Test (test)Test · Test · npm testUnit tests · Test · npm test",
      "Lint (lint)Lint · npm run lintLint · npm run lint:all",
    ]);
  });
});
