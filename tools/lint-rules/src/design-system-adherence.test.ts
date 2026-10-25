import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { designSystemAdherence } from "./design-system-adherence.ts";

const adherence = designSystemAdherence({
  configFile: path.resolve(import.meta.dirname, "../../../design-system/_adherence.oxlintrc.json"),
  files: ["apps/web/**"],
  barrel: "@the-office/ui",
});

function selectorMessages(): string[] {
  const rule = adherence.rules?.["office/restricted-syntax"];
  assert.ok(Array.isArray(rule), "office/restricted-syntax has options");
  return rule.slice(1).map((option) => (option as { message: string }).message);
}

test("lints the given files with the design system's plugins", () => {
  assert.deepEqual(adherence.files, ["apps/web/**"]);
  assert.ok(adherence.plugins?.includes("react"));
});

test("runs the restricted syntax as office/restricted-syntax, which oxlint has no native rule for", () => {
  assert.equal(adherence.rules?.["no-restricted-syntax"], undefined);
  const messages = selectorMessages();
  assert.ok(messages.some((message) => message.startsWith("Raw hex color")));
  assert.ok(messages.some((message) => message.startsWith("Raw px value")));
  assert.ok(messages.some((message) => message.startsWith("<Button> variant must be one of")));
});

test("leaves the prop lists to TypeScript, which knows the HTML attributes a .d.ts inherits", () => {
  assert.ok(selectorMessages().every((message) => !message.includes("doesn't accept that prop")));
});

test("points the import rule at the barrel", () => {
  assert.deepEqual(adherence.rules?.["no-restricted-imports"], [
    "warn",
    {
      patterns: [
        {
          group: ["**/design-system/**"],
          message: 'Import design-system components from "@the-office/ui", which types them.',
        },
      ],
    },
  ]);
});
