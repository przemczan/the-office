/** The web app, laid out as the Build defaults name it (docs/tasks/README.md). */
export const WEB_APP_DIRECTORY = "apps/web";

/** Where a file lies in apps/web. */
export type WebPlace =
  /** A file directly in `src/` (main, app, router), without the extension: it composes the app. */
  | { readonly kind: "composition"; readonly file: string }
  /** `src/api/`: the web's side of the service, its API and event stream. */
  | { readonly kind: "api" }
  /** `src/shell/`: the frame every surface opens in, and what surfaces share. */
  | { readonly kind: "shell" }
  | { readonly kind: "surface"; readonly surface: string }
  /** A folder in `src/` that is none of the above. */
  | { readonly kind: "other folder"; readonly folder: string }
  /** Outside `src/`, such as the configs and the end-to-end tests. */
  | { readonly kind: "elsewhere" };

const LAYOUT = "See the web's layout in the Build defaults (docs/tasks/README.md).";

/**
 * @param workspacePath - the file's path inside apps/web, with forward slashes, e.g.
 *   `src/surfaces/now/now-page.tsx`.
 */
export function webPlaceOf(workspacePath: string): WebPlace {
  const [source, area, ...rest] = workspacePath.split("/");
  if (source !== "src" || area === undefined) return { kind: "elsewhere" };
  if (rest.length === 0) return { kind: "composition", file: area.replace(/\.[cm]?[jt]sx?$/, "") };
  switch (area) {
    case "api":
      return { kind: "api" };
    case "shell":
      return { kind: "shell" };
    case "surfaces":
      return { kind: "surface", surface: rest[0]! };
    default:
      return { kind: "other folder", folder: area };
  }
}

/** Where a file of apps/web lies, from its path in the repository, e.g. `apps/web/src/main.tsx`. */
export function webPlaceAt(repositoryPath: string): WebPlace {
  return webPlaceOf(repositoryPath.slice(WEB_APP_DIRECTORY.length + 1));
}

/** Why one file of apps/web importing another breaks its layout, or undefined if it doesn't. */
export function webLayerViolation(importer: WebPlace, target: WebPlace): string | undefined {
  if (importer.kind === "elsewhere" || target.kind === "elsewhere") return undefined;
  if (target.kind === "other folder") {
    return `src/${target.folder}/ is none of the web's areas: src/api/, src/shell/ and src/surfaces/<surface>/. ${LAYOUT}`;
  }
  if (target.kind === "composition" && importer.kind !== "composition") {
    return `src/${target.file} composes the app; nothing in src/api/, src/shell/ or src/surfaces/ imports it. ${LAYOUT}`;
  }
  if (importer.kind === "api" && (target.kind === "shell" || target.kind === "surface")) {
    return `src/api/ is the web's side of the service, below the shell and the surfaces; it imports neither. ${LAYOUT}`;
  }
  if (importer.kind === "shell" && target.kind === "surface") {
    return `The shell frames the surfaces and never imports one; src/router.tsx puts each in it. ${LAYOUT}`;
  }
  if (
    importer.kind === "surface" &&
    target.kind === "surface" &&
    importer.surface !== target.surface
  ) {
    return `The ${importer.surface} surface imports the ${target.surface} surface; what two surfaces share belongs in src/shell/ or src/api/. ${LAYOUT}`;
  }
  return undefined;
}
