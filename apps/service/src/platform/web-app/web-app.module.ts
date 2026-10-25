import { existsSync } from "node:fs";
import path from "node:path";
import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import { BuiltWebApp } from "./built-web-app.js";
import { UnbuiltWebAppWarning } from "./unbuilt-web-app-warning.js";
import { ViteWebApp } from "./vite-web-app.js";
import { WEB_APP_DIRECTORY } from "./web-app-directory.js";

/**
 * Where the web app's pages come from: `built` serves apps/web/dist as `npm run build` left it;
 * `source` compiles apps/web/src with Vite as it changes, for `npm run dev`.
 */
export type WebAppSource = "built" | "source";

export interface WebAppOptions {
  /** apps/web. */
  readonly directory: string;
  readonly source: WebAppSource;
}

/**
 * Serves the web app on every path outside the API, on the API's own origin, so the service's
 * localhost and Origin checks guard the pages too (spec §5.1).
 */
@Module({})
export class WebAppModule {
  static register(options: WebAppOptions): DynamicModule {
    return { module: WebAppModule, providers: providersFor(options) };
  }
}

function providersFor({ directory, source }: WebAppOptions): Provider[] {
  if (source === "source") {
    return [{ provide: WEB_APP_DIRECTORY, useValue: directory }, ViteWebApp];
  }
  const builtDirectory = path.join(directory, "dist");
  if (!existsSync(path.join(builtDirectory, "index.html"))) return [UnbuiltWebAppWarning];
  return [{ provide: WEB_APP_DIRECTORY, useValue: builtDirectory }, BuiltWebApp];
}
