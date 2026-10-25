import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, Plugin } from "vite";
import { appearanceScript } from "./appearance/apply-appearance.ts";

const FAVICON = fileURLToPath(
  new URL("../../../design-system/assets/logo/favicon.svg", import.meta.url),
);

/**
 * The Vite settings an app needs to build with @the-office/ui, whose components are the design
 * system's .jsx files outside the app's root, and the page's favicon and appearance.
 */
export function designSystem(): Plugin {
  return {
    name: "the-office:design-system",
    config: () => ({
      // The .jsx files resolve react from design-system/; one copy keeps hooks working.
      resolve: { dedupe: ["react", "react-dom"] },
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: {
              // Icon keeps every Lucide icon (index.ts): a chunk of their own, changed only with
              // the pinned version, so a new build of the app leaves it cached.
              groups: [{ name: "lucide-icons", test: /[\\/]node_modules[\\/]lucide[\\/]/ }],
            },
          },
        },
      },
    }),
    transformIndexHtml: {
      // Before Vite's own pass, which turns the favicon's path into an asset of the build.
      order: "pre",
      handler: (_html, { filename }) => [faviconTag(filename), appearanceTag()],
    },
  };
}

function faviconTag(htmlFile: string): HtmlTagDescriptor {
  const href = path.relative(path.dirname(htmlFile), FAVICON).split(path.sep).join("/");
  return { tag: "link", attrs: { rel: "icon", type: "image/svg+xml", href }, injectTo: "head" };
}

// The appearance is set before the first paint, so a dark palette never shows the page white.
function appearanceTag(): HtmlTagDescriptor {
  return { tag: "script", children: appearanceScript(), injectTo: "head-prepend" };
}
