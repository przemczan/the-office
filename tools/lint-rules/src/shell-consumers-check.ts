// `npm run lint` (in `verify`) runs this after oxlint: it fails when a file of apps/web's shell is
// used by one surface alone (shell-consumers.ts).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { singleSurfaceShellFiles, singleSurfaceWords, type WebFile } from "./shell-consumers.ts";
import { WEB_APP_DIRECTORY } from "./web-layers.ts";

const webApp = resolve(import.meta.dirname, "../../..", WEB_APP_DIRECTORY);
const SOURCE = /\.(?:[cm]?[jt]sx?|css)$/;

// The app's source, its end-to-end tests and its configs: whatever else may import the shell.
const inFolder = (folder: string): string[] =>
  readdirSync(join(webApp, folder), { recursive: true, encoding: "utf8" }).map(
    (path) => `${folder}/${path.replaceAll("\\", "/")}`,
  );
const files: WebFile[] = [...inFolder("src"), ...inFolder("e2e"), ...readdirSync(webApp)]
  .filter((path) => SOURCE.test(path))
  .map((path) => ({ path, text: readFileSync(join(webApp, path), "utf8") }));

const found = singleSurfaceShellFiles(files);
for (const file of found) console.error(`${WEB_APP_DIRECTORY}/${singleSurfaceWords(file)}`);
if (found.length > 0) process.exitCode = 1;
