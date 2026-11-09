import { createHash } from "node:crypto";
import { carrierOf, type InstallVariable } from "./run-environment.js";

/** A file the image's key is made of, by its path in the worktree; no content when it isn't there. */
export interface KeyedFile {
  readonly path: string;
  readonly content: Uint8Array | undefined;
}

/** What the image is made from (spec §5.5, "Image cache"). */
export interface ImageInputs {
  /** Every file in the Run environment definition's folder. */
  readonly definitionFiles: readonly KeyedFile[];
  readonly installCommand: string | undefined;
  /** The Project's Install inputs. */
  readonly installInputs: readonly KeyedFile[];
  readonly installVariables: readonly InstallVariable[];
}

/** Bumped when the way an image is built changes, so images built the old way are built again. */
const IMAGE_RECIPE_VERSION = 2;
const KEY_LENGTH = 24;

/** Where the Install inputs are copied in the image, and the install command runs. */
export const INSTALL_FOLDER = "/office-install";
/** The folder of the image's build context the Install inputs are copied into. */
export const INSTALL_INPUTS_FOLDER = "install-inputs";

/**
 * The image's key: a digest of the definition's files, the install command, the variables it runs
 * with (a Secret variable by its name alone) and the contents of the Install inputs, each file by
 * its path and contents, in path order, so the same inputs always give the same key and any change
 * gives another.
 */
export function imageKeyOf(inputs: ImageInputs): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      version: IMAGE_RECIPE_VERSION,
      install: inputs.installCommand ?? null,
      variables: inputs.installVariables.map(({ name, value, secret }) =>
        secret ? [name] : [name, value],
      ),
    }),
  );
  for (const [kind, files] of [
    ["definition", inputs.definitionFiles],
    ["install-input", inputs.installInputs],
  ] as const) {
    for (const file of files.toSorted((one, other) => one.path.localeCompare(other.path))) {
      hash.update(`\0${kind}\0${file.path}\0`);
      hash.update(file.content === undefined ? "absent" : `${file.content.length}\0`);
      if (file.content !== undefined) hash.update(file.content);
    }
  }
  return hash.digest("hex").slice(0, KEY_LENGTH);
}

/** The image a Project's run environments run its checks in: `the-office/<project>:<key>`. */
export function imageNameOf(projectId: string, key: string): string {
  return `the-office/${projectId}:${key}`;
}

/** The image built from the definition's own Dockerfile, which the keyed image starts from. */
export function baseImageNameOf(projectId: string, key: string): string {
  return `the-office/${projectId}-base:${key}`;
}

/**
 * The Dockerfile that runs the install command over the definition's image, with the Project's
 * variables, each a BuildKit secret by its carrier (`installSecrets`), mounted as the variable for
 * that one step: no value lands in a layer, the image's history or a build argument.
 */
export function installDockerfile(
  fromImage: string,
  installCommand: string | undefined,
  variableNames: readonly string[],
): string {
  const mounts = variableNames.map(
    (name, index) => `--mount=type=secret,id=${carrierOf(index)},env=${name} `,
  );
  return [
    `FROM ${fromImage}`,
    `COPY ${INSTALL_INPUTS_FOLDER}/ ${INSTALL_FOLDER}/`,
    `WORKDIR ${INSTALL_FOLDER}`,
    // The exec form, so the command reaches the shell exactly as the Project keeps it.
    ...(installCommand?.trim()
      ? [`RUN ${mounts.join("")}${JSON.stringify(["/bin/sh", "-c", installCommand])}`]
      : []),
    "",
  ].join("\n");
}

/** The values installDockerfile's mounts read, by their ids: the BuildKit secrets of the build. */
export function installSecrets(variables: readonly InstallVariable[]): Record<string, string> {
  return Object.fromEntries(variables.map(({ value }, index) => [carrierOf(index), value]));
}
