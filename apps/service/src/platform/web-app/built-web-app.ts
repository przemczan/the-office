import { readFile } from "node:fs/promises";
import path from "node:path";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import express, { type NextFunction, type Request, type Response } from "express";
import { isApiPath } from "../http/api-path.js";
import { WEB_APP_DIRECTORY } from "./web-app-directory.js";
import {
  inlineScriptHashesOf,
  WEB_APP_FORM_TARGETS,
  webAppContentSecurityPolicy,
} from "./web-app-policy.js";

/** The web app as `npm run build` left it in apps/web/dist. */
@Injectable()
export class BuiltWebApp implements OnModuleInit {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(WEB_APP_DIRECTORY) private readonly directory: string,
    @Inject(WEB_APP_FORM_TARGETS) private readonly formTargets: readonly string[],
  ) {}

  // After Nest registered the API's routes, and before its handler for paths none of them took.
  async onModuleInit(): Promise<void> {
    const files = express.static(this.directory, { index: false });
    const inlineScriptHashes = inlineScriptHashesOf(
      await readFile(path.join(this.directory, "index.html"), "utf8"),
    );
    this.httpAdapterHost.httpAdapter.use(
      (request: Request, response: Response, next: NextFunction) => {
        if (isApiPath(request.url)) {
          next();
          return;
        }
        // On every file, index.html as an app address or by its name, and the workers it starts.
        response.setHeader(
          "Content-Security-Policy",
          webAppContentSecurityPolicy(inlineScriptHashes, request.headers.host, this.formTargets),
        );
        files(request, response, () => {
          // An address of the app itself, such as /settings, gets index.html for the router to
          // open; a missing file, such as /assets/gone.js, stays a 404. Sent from `root`, so only
          // the path under it is checked for dot folders, not where The Office is, such as ~/.local.
          if (isAppAddress(request)) {
            response.sendFile("index.html", { root: this.directory, headers: NOT_CACHED });
          } else next();
        });
      },
    );
  }
}

// index.html names the current build's assets, so it is asked for again every time.
const NOT_CACHED = { "Cache-Control": "no-cache" };

function isAppAddress(request: Request): boolean {
  return (
    (request.method === "GET" || request.method === "HEAD") && path.extname(request.path) === ""
  );
}
