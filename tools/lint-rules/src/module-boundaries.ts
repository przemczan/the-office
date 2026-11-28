import {
  LAYERS,
  MODULE_DOMAIN_ENTRY,
  MODULE_ENTRY,
  MODULE_TEST_ENTRY,
  type Layer,
  type Place,
} from "./module-layout.ts";

/** The platform file the domain layer subclasses for its events; nothing else in the platform. */
const DOMAIN_EVENT_FILE = "events/domain-event";

/** The wire format of the HTTP API and the WebSocket push, mapped to and from in adapters only. */
const CONTRACTS_PACKAGE = "@the-office/contracts";

const TEMPLATE = "See the module template in apps/service/docs/module-template.md.";

export interface ImportInWorkspace {
  readonly importer: Place;
  readonly importerIsTest: boolean;
  readonly target: Place;
  /** Whether the import loads nothing at run time (`import type`); false when left out. */
  readonly typeOnly?: boolean;
}

/** Why importing a file of the same workspace breaks the module rules, or undefined if it doesn't. */
export function moduleBoundaryViolation({
  importer,
  importerIsTest,
  target,
  typeOnly = false,
}: ImportInWorkspace): string | undefined {
  if (importer.kind === "platform" && isInModule(target)) {
    return `src/platform/ is below the modules and never imports one. ${TEMPLATE}`;
  }
  if (isDomainEntry(importer) && !isDomainOf(target, importer.module)) {
    return `modules/${importer.module}/${MODULE_DOMAIN_ENTRY}.ts re-exports only its own domain/, so importing it loads no Nest module. ${TEMPLATE}`;
  }
  if (isInModule(target) && (!isInModule(importer) || importer.module !== target.module)) {
    if (!isEntryFor(target, importerIsTest)) {
      return `Another module is reached only through its public entry, modules/${target.module}/${MODULE_ENTRY}.ts, its domain entry ${MODULE_DOMAIN_ENTRY}.ts, and from tests also ${MODULE_TEST_ENTRY}.ts. ${TEMPLATE}`;
    }
    return crossModuleDomainViolation(importer, importerIsTest, target, typeOnly);
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

function isEntryFor(
  target: Place,
  importerIsTest: boolean,
): target is Extract<Place, { kind: "module root" }> {
  if (target.kind !== "module root") return false;
  return (
    target.file === MODULE_ENTRY ||
    target.file === MODULE_DOMAIN_ENTRY ||
    (importerIsTest && target.file === MODULE_TEST_ENTRY)
  );
}

/**
 * A domain takes another module's public entry only as types: its values would load that module's
 * Nest module, ports and adapters into a domain meant to be pure. Its values come from the other
 * module's domain entry instead. Tests may load anything.
 */
function crossModuleDomainViolation(
  importer: Place,
  importerIsTest: boolean,
  target: Extract<Place, { kind: "module root" }>,
  typeOnly: boolean,
): string | undefined {
  const isDomain = importer.kind === "layer" && importer.layer === "domain";
  if (!isDomain || importerIsTest || typeOnly || target.file !== MODULE_ENTRY) return undefined;
  return `The domain layer imports modules/${target.module}/${MODULE_ENTRY}.ts, which loads its Nest module; a domain takes another module's ${MODULE_ENTRY}.ts only with \`import type\`, and its values from modules/${target.module}/${MODULE_DOMAIN_ENTRY}.ts. ${TEMPLATE}`;
}

function isDomainEntry(place: Place): place is Extract<Place, { kind: "module root" }> {
  return place.kind === "module root" && place.file === MODULE_DOMAIN_ENTRY;
}

function isDomainOf(place: Place, module: string): boolean {
  return place.kind === "layer" && place.module === module && place.layer === "domain";
}

function isInModule(place: Place): place is Extract<Place, { module: string }> {
  return "module" in place;
}
