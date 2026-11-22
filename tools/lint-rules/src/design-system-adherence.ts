import { readFileSync } from "node:fs";
import type { AllowWarnDeny, DummyRule, DummyRuleMap, OxlintOverride } from "oxlint";
import type { RestrictedSyntax } from "./restricted-syntax.ts";

/** The parts of design-system/_adherence.oxlintrc.json that lint an app. */
interface AdherenceConfig {
  readonly plugins: NonNullable<OxlintOverride["plugins"]>;
  readonly rules: Readonly<Record<string, DummyRule>>;
}

export interface AdherenceOptions {
  /** The design system's adherence config, which stays as it is. */
  readonly configFile: string;
  /** The files it lints. */
  readonly files: readonly string[];
  /** The package the app imports the design system from. */
  readonly barrel: string;
}

/**
 * A selector refusing every JSX attribute missing from a component's prop list. The lists leave out
 * the HTML attributes a component's .d.ts inherits (onClick, aria-*, type), so they are not applied:
 * TypeScript checks every prop against the .d.ts instead.
 */
const PROP_LIST_SELECTOR = /> JSXAttribute > JSXIdentifier\[name!=/;

/**
 * The design system's adherence lint as an oxlint override: its `no-restricted-syntax` runs as
 * `office/restricted-syntax`, which oxlint lacks, and its import rule points at the barrel.
 */
export function designSystemAdherence(options: AdherenceOptions): OxlintOverride {
  const { plugins, rules } = JSON.parse(
    readFileSync(options.configFile, "utf8"),
  ) as AdherenceConfig;
  const {
    "no-restricted-syntax": restrictedSyntax,
    "no-restricted-imports": restrictedImports,
    ...otherRules
  } = rules;
  return {
    files: [...options.files],
    plugins,
    rules: {
      ...otherRules,
      ...(restrictedSyntax && {
        "office/restricted-syntax": [
          severityOf(restrictedSyntax),
          ...selectorsOf(restrictedSyntax).filter(
            ({ selector }) => !PROP_LIST_SELECTOR.test(selector),
          ),
        ],
      }),
      ...(restrictedImports && {
        "no-restricted-imports": [
          severityOf(restrictedImports),
          {
            patterns: [
              {
                group: ["**/design-system/**"],
                message: `Import design-system components from "${options.barrel}", which types them.`,
              },
            ],
          },
        ],
      }),
    } satisfies DummyRuleMap,
  };
}

function severityOf(rule: DummyRule): AllowWarnDeny {
  return Array.isArray(rule) ? rule[0] : rule;
}

function selectorsOf(rule: DummyRule): RestrictedSyntax[] {
  return Array.isArray(rule) ? (rule.slice(1) as RestrictedSyntax[]) : [];
}
