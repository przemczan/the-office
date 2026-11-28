import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import { BuiltWebApp } from "./built-web-app.js";
import { UnbuiltWebAppWarning } from "./unbuilt-web-app-warning.js";
import { ViteWebApp } from "./vite-web-app.js";
import { WebAppBuild, webAppBuildOf } from "./web-app-build.js";
import { WEB_APP_DIRECTORY } from "./web-app-directory.js";
import { WEB_APP_FORM_TARGETS } from "./web-app-policy.js";

/**
 * Where the web app's pages come from: `built` serves apps/web/dist as `npm run build` left it;
 * `source` compiles apps/web/src with Vite as it changes, for `npm run dev`.
 */
export type WebAppSource = "built" | "source";

export interface WebAppOptions {
  /** apps/web. */
  readonly directory: string;
  readonly source: WebAppSource;
  /**
   * The other origins the built pages' forms may post to, such as GitHub's website, which
   * registering the GitHub App posts its manifest to; none when left out.
   */
  readonly formTargets?: readonly string[];
}

/**
 * Serves the web app on every path outside the API, on the API's own origin, so the service's
 * localhost and Origin checks guard the pages too (spec §5.1). Gives every module the build it
 * serves (`WebAppBuild`), which the event stream names to the open tabs.
 */
@Module({})
export class WebAppModule {
  static register(options: WebAppOptions): DynamicModule {
    return {
      module: WebAppModule,
      global: true,
      providers: providersFor(options),
      exports: [WebAppBuild],
    };
  }
}

function providersFor({ directory, source, formTargets = [] }: WebAppOptions): Provider[] {
  if (source === "source") {
    return [
      { provide: WEB_APP_DIRECTORY, useValue: directory },
      { provide: WebAppBuild, useValue: WebAppBuild.NONE },
      ViteWebApp,
    ];
  }
  const builtDirectory = path.join(directory, "dist");
  const indexHtml = path.join(builtDirectory, "index.html");
  if (!existsSync(indexHtml)) {
    return [{ provide: WebAppBuild, useValue: WebAppBuild.NONE }, UnbuiltWebAppWarning];
  }
  return [
    { provide: WEB_APP_DIRECTORY, useValue: builtDirectory },
    { provide: WEB_APP_FORM_TARGETS, useValue: formTargets },
    {
      provide: WebAppBuild,
      useFactory: async () => webAppBuildOf(await readFile(indexHtml, "utf8")),
    },
    BuiltWebApp,
  ];
}
