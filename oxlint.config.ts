import { fileURLToPath } from "node:url";
import { defineConfig } from "oxlint";
import { designSystemAdherence } from "./tools/lint-rules/src/design-system-adherence.ts";

const inRepository = (file: string): string => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  // react is on everywhere: oxlint applies the categories to a plugin an override turns on after
  // that override's rules, so a react rule could not be turned off there.
  plugins: [
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "node",
    "promise",
    "vitest",
    "react",
  ],
  categories: { correctness: "error", suspicious: "error" },
  options: { denyWarnings: true, reportUnusedDisableDirectives: "error" },
  ignorePatterns: ["design-system/**"],
  // The layering rules of apps/service/docs/module-template.md and the Build defaults; see tools/lint-rules/.
  jsPlugins: [inRepository("./tools/lint-rules/src/plugin.ts")],
  rules: {
    "office/workspace-boundaries": "error",
    "office/module-boundaries": "error",
    "office/operating-system-branches": "error",
    "office/web-layers": "error",
    "import/no-cycle": "error",
    // A stylesheet is imported for what it adds to the page.
    "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
    // JSX compiles with the automatic runtime, which needs no React in scope.
    "react/react-in-jsx-scope": "off",
  },
  overrides: [
    {
      // Nest declares modules as decorated classes, empty or with static factory methods.
      files: ["apps/service/**"],
      rules: { "typescript/no-extraneous-class": ["error", { allowWithDecorator: true }] },
    },
    designSystemAdherence({
      configFile: inRepository("./design-system/_adherence.oxlintrc.json"),
      files: ["apps/web/**"],
      barrel: "@the-office/ui",
    }),
  ],
});
