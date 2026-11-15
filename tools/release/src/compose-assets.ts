// `npm run compose-assets -- --version <version>`: writes the Compose install's release assets,
// dist/release/docker-compose.yml as it is and dist/release/the-office.env with OFFICE_VERSION set
// to the version (docs/releasing.md). tools/release/prepare.sh runs it after packing.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { COMPOSE_ASSETS, COMPOSE_FOLDER, stampComposeEnv } from "./compose-install.ts";
import { RELEASE_VERSION } from "./release-package.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const composeFolder = join(repositoryRoot, COMPOSE_FOLDER);
const releaseFolder = join(repositoryRoot, "dist", "release");

const version = versionGiven();
mkdirSync(releaseFolder, { recursive: true });

const { composeFile, envFile } = COMPOSE_ASSETS;
copyFileSync(join(composeFolder, composeFile.source), join(releaseFolder, composeFile.asset));
const template = readFileSync(join(composeFolder, envFile.source), "utf8");
writeFileSync(join(releaseFolder, envFile.asset), stampComposeEnv(template, version));
console.log(
  `Wrote ${composeFile.asset} and ${envFile.asset} for ${version} in ${relative(repositoryRoot, releaseFolder)}.`,
);

function versionGiven(): string {
  const { values } = parseArgs({ options: { version: { type: "string" } } });
  if (!values.version || !RELEASE_VERSION.test(values.version)) {
    throw new Error("Give the release's version as --version <major.minor.patch[-prerelease]>.");
  }
  return values.version;
}
