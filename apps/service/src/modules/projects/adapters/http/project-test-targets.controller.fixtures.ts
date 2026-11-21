import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EditedTestTarget } from "@the-office/contracts";
import { gitIn, type TemporaryRepository } from "../git/temporary-repository.fixtures.js";

/** Commits the entry points the test targets' tests name on the repository's `main`. */
export async function commitEntryPoints(repository: TemporaryRepository): Promise<void> {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "web",
      scripts: { start: "vite", build: "vite build" },
    }),
    "apps/broken/package.json": "{ not json",
    "scripts/start-test.sh": "#!/bin/sh\nexec npm start\n",
    "android/gradlew": "#!/bin/sh\n",
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(repository.path, path)), { recursive: true });
    await writeFile(join(repository.path, path), text);
  }
  gitIn(repository.path, "add", ".");
  gitIn(repository.path, "commit", "--quiet", "--message", "Add entry points");
}

/** A Gradle wrapper at the root, for a Gradle task's test. */
export async function commitGradleWrapper(repository: TemporaryRepository): Promise<void> {
  await writeFile(join(repository.path, "gradlew"), "#!/bin/sh\n");
  gitIn(repository.path, "add", "gradlew");
  gitIn(repository.path, "commit", "--quiet", "--message", "Add the Gradle wrapper");
}

export function aHostedTarget(fields: Partial<EditedTestTarget> = {}): EditedTestTarget {
  return {
    key: "web",
    name: "Web app",
    kind: "hosted",
    entryPoint: {
      kind: "package-script",
      manifest: "package.json",
      script: "start",
      arguments: [],
    },
    port: 5173,
    portVariable: "PORT",
    variables: [{ name: "MODE", value: "test" }],
    secretVariables: [{ name: "API_KEY", value: "api-s3cret-value" }],
    commandsBefore: [],
    memoryMegabytes: null,
    ...fields,
  } as EditedTestTarget;
}

export function aBuildToInstallTarget(fields: Partial<EditedTestTarget> = {}): EditedTestTarget {
  return {
    key: "android",
    name: "Android",
    kind: "build-to-install",
    entryPoint: {
      kind: "repository-file",
      path: "./scripts/start-test.sh",
      arguments: ["--debug"],
    },
    outputPatterns: ["app/build/outputs/apk/debug/*.apk"],
    variables: [],
    secretVariables: [],
    commandsBefore: [],
    memoryMegabytes: null,
    ...fields,
  } as EditedTestTarget;
}
