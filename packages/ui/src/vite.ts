import type { Plugin } from "vite";

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
  };
}
