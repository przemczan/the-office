import type { Plugin } from "vite";
import { APPEARANCE_RULES, applyAppearance } from "./appearance/apply-appearance.ts";

/**
 * The Vite settings an app needs to build with @the-office/ui, whose components are the design
 * system's .jsx files outside the app's root.
 */
export function designSystem(): Plugin {
  return {
    name: "the-office:design-system",
    config: () => ({
      // The .jsx files resolve react from design-system/; one copy keeps hooks working.
      resolve: { dedupe: ["react", "react-dom"] },
    }),
    // The appearance is set before the first paint, so a dark palette never shows the page white.
    transformIndexHtml: () => [
      { tag: "script", children: appearanceScript(), injectTo: "head-prepend" },
    ],
  };
}

export function appearanceScript(): string {
  return `(${applyAppearance.toString()})(${JSON.stringify(APPEARANCE_RULES)});`;
}
