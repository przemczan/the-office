/** A module's layers from the innermost out; a layer imports its own and the ones before it. */
export const LAYERS = ["domain", "ports", "application", "adapters"] as const;

export type Layer = (typeof LAYERS)[number];

/** Where a file lies in a workspace laid out as `src/modules/<module>/` and `src/platform/`. */
export type Place =
  | { readonly kind: "layer"; readonly module: string; readonly layer: Layer }
  /** A file directly in the module's folder: its public entry or its wiring. */
  | { readonly kind: "module root"; readonly module: string; readonly file: string }
  /** A folder in a module that is none of its layers. */
  | { readonly kind: "module folder"; readonly module: string; readonly folder: string }
  /** A file directly in `src/`, such as the composition root, without the extension. */
  | { readonly kind: "top level"; readonly file: string }
  /** Relative to `src/platform/`, without the extension, e.g. `events/domain-event`. */
  | { readonly kind: "platform"; readonly file: string }
  | { readonly kind: "elsewhere" };

/** The one file every module imports, and the one name others reach it by. */
export const MODULE_ENTRY = "index";

/**
 * What a module gives other modules' tests, such as a fake of a server its adapters talk to: a
 * fixture, left out of the build, so only tests reach it.
 */
export const MODULE_TEST_ENTRY = "index.fixtures";

/**
 * @param workspacePath - the file's path inside its workspace, with forward slashes, e.g.
 *   `src/modules/work/domain/task.ts`. A folder stands for its `index` file.
 */
export function placeOf(workspacePath: string): Place {
  const [source, area, ...rest] = workspacePath.split("/");
  if (source !== "src" || area === undefined) return { kind: "elsewhere" };
  if (rest.length === 0) return { kind: "top level", file: withoutExtension(area) };
  if (area === "platform") return { kind: "platform", file: withoutExtension(rest.join("/")) };
  if (area !== "modules") return { kind: "elsewhere" };
  const [module, folderOrFile, ...inside] = rest as [string, ...string[]];
  if (folderOrFile === undefined) return { kind: "module root", module, file: MODULE_ENTRY };
  if (inside.length === 0) {
    return { kind: "module root", module, file: withoutExtension(folderOrFile) };
  }
  return isLayer(folderOrFile)
    ? { kind: "layer", module, layer: folderOrFile }
    : { kind: "module folder", module, folder: folderOrFile };
}

export function isTestFile(workspacePath: string): boolean {
  return /\.(test|fixtures)\.[cm]?[jt]sx?$/.test(workspacePath);
}

function isLayer(folder: string): folder is Layer {
  return (LAYERS as readonly string[]).includes(folder);
}

function withoutExtension(file: string): string {
  return file.replace(/\.[cm]?[jt]sx?$/, "");
}
