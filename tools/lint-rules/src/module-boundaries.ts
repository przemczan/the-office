import { LAYERS, MODULE_ENTRY, type Layer, type Place } from "./module-layout.ts";

/** The platform file the domain layer subclasses for its events; nothing else in the platform. */
const DOMAIN_EVENT_FILE = "events/domain-event";

/** The wire format of the HTTP API and the WebSocket push, mapped to and from in adapters only. */
const CONTRACTS_PACKAGE = "@the-office/contracts";

const TEMPLATE = "See the module template in apps/service/README.md.";

export interface ImportInWorkspace {
  readonly importer: Place;
  readonly importerIsTest: boolean;
  readonly target: Place;
}

/** Why importing a file of the same workspace breaks the module rules, or undefined if it doesn't. */
export function moduleBoundaryViolation({
  importer,
  importerIsTest,
  target,
}: ImportInWorkspace): string | undefined {
  if (importer.kind === "platform" && isInModule(target)) {
    return `src/platform/ is below the modules and never imports one. ${TEMPLATE}`;
  }
  if (isInModule(target) && (!isInModule(importer) || importer.module !== target.module)) {
    return target.kind === "module root" && target.file === MODULE_ENTRY
      ? undefined
      : `Another module is reached only through its public entry, modules/${target.module}/${MODULE_ENTRY}.ts. ${TEMPLATE}`;
  }
  // Tests may wire a module's layers together and boot the app; the module boundary above still
  // holds for them.
  if (importerIsTest) return undefined;
  if (target.kind === "top level" && (isInModule(importer) || importer.kind === "platform")) {
    return `src/${target.file}.ts is above the modules and the platform; neither imports it. ${TEMPLATE}`;
  }
  if (importer.kind !== "layer") return undefined;
  return target.kind === "platform"
    ? platformViolation(importer.layer, target.file)
    : sameModuleViolation(importer.layer, target);
}

/** Why importing a package breaks the module rules, or undefined if it doesn't. */
export function modulePackageViolation(
  importer: Place,
  importerIsTest: boolean,
  packageName: string,
): string | undefined {
  if (importer.kind !== "layer" || importerIsTest || importer.layer === "adapters") {
    return undefined;
  }
  return packageName === CONTRACTS_PACKAGE
    ? `The ${importer.layer} layer imports ${CONTRACTS_PACKAGE}; only adapters map to and from the contracts. ${TEMPLATE}`
    : undefined;
}

function sameModuleViolation(layer: Layer, target: Place): string | undefined {
  switch (target.kind) {
    case "module root":
      return `The ${layer} layer imports ${target.file}.ts, which wires the module or opens it to others; layers never import it. ${TEMPLATE}`;
    case "module folder":
      return `modules/${target.module}/${target.folder}/ is not a layer; a module holds ${LAYERS.join("/, ")}/ and its root files. ${TEMPLATE}`;
    case "layer":
      return LAYERS.indexOf(target.layer) > LAYERS.indexOf(layer)
        ? `The ${layer} layer imports the ${target.layer} layer; layers import only inward: ${LAYERS.toReversed().join(" → ")}. ${TEMPLATE}`
        : undefined;
    default:
      return undefined;
  }
}

function platformViolation(layer: Layer, platformFile: string): string | undefined {
  const usesOnlyDomainEvent = layer === "domain" || layer === "ports";
  return usesOnlyDomainEvent && platformFile !== DOMAIN_EVENT_FILE
    ? `The ${layer} layer imports src/platform/${platformFile}; ${layer} uses only src/platform/${DOMAIN_EVENT_FILE}.ts from the platform. ${TEMPLATE}`
    : undefined;
}

function isInModule(place: Place): place is Extract<Place, { module: string }> {
  return "module" in place;
}
