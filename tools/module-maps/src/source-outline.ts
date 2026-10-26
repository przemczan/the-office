/** What a source file declares that a reader looks for first. */
export interface SourceOutline {
  readonly exports: readonly string[];
  /** Classes extending `DomainEvent`. */
  readonly events: readonly string[];
  readonly routes: readonly Route[];
  /** Postgres table names declared with `pgTable`. */
  readonly tables: readonly string[];
}

export interface Route {
  readonly method: string;
  /** As declared, without the service's global `/api` prefix. */
  readonly path: string;
  /** `Controller.method` */
  readonly handler: string;
}

const IDENTIFIER = String.raw`[A-Za-z_$][\w$]*`;
const DECLARED_EXPORT = new RegExp(
  String.raw`^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function\*?|const|let|type|interface|enum)\s+(${IDENTIFIER})`,
  "gm",
);
const LISTED_EXPORT = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
const STAR_EXPORT = /^export\s+\*\s+(?:as\s+(\w+)\s+)?from\s+["']([^"']+)["']/gm;
const EVENT = new RegExp(
  String.raw`^export\s+class\s+(${IDENTIFIER})\s+extends\s+DomainEvent\b`,
  "gm",
);
const TABLE = /pgTable\(\s*["']([^"']+)["']/g;
const CONTROLLER = /@Controller\(\s*(?:["']([^"']*)["'])?\s*\)/g;
const ROUTE = /@(Get|Post|Put|Patch|Delete)\(\s*(?:["']([^"']*)["'])?\s*\)/g;
const CLASS_NAME = new RegExp(String.raw`\bclass\s+(${IDENTIFIER})`);
const METHOD_NAME = new RegExp(String.raw`\n\s*(?:public\s+|async\s+)*(${IDENTIFIER})\s*[(<]`);

export function outlineOf(source: string): SourceOutline {
  return {
    exports: unique([...declaredExports(source), ...listedExports(source), ...starExports(source)]),
    events: [...source.matchAll(EVENT)].map((match) => match[1]!),
    routes: routesOf(source),
    tables: [...source.matchAll(TABLE)].map((match) => match[1]!),
  };
}

function declaredExports(source: string): string[] {
  return [...source.matchAll(DECLARED_EXPORT)].map((match) => match[1]!);
}

function listedExports(source: string): string[] {
  return [...source.matchAll(LISTED_EXPORT)].flatMap((match) =>
    match[1]!
      .split(",")
      .map((entry) => entry.trim().replace(/^type\s+/, ""))
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.split(/\s+as\s+/).at(-1)!),
  );
}

function starExports(source: string): string[] {
  return [...source.matchAll(STAR_EXPORT)].map(([, alias, from]) =>
    alias ? `${alias} (all of ${from})` : `all of ${from}`,
  );
}

/** Each `@Controller` covers the routes declared after it, up to the next one. */
function routesOf(source: string): Route[] {
  const controllers = [...source.matchAll(CONTROLLER)];
  return controllers.flatMap((controller, index) => {
    const body = source.slice(controller.index, controllers[index + 1]?.index ?? source.length);
    const className = CLASS_NAME.exec(body)?.[1] ?? "?";
    return [...body.matchAll(ROUTE)].map((route) => ({
      method: route[1]!.toUpperCase(),
      path: joinPath(controller[1], route[2]),
      handler: `${className}.${METHOD_NAME.exec(body.slice(route.index))?.[1] ?? "?"}`,
    }));
  });
}

function joinPath(...parts: readonly (string | undefined)[]): string {
  return `/${parts
    .flatMap((part) => (part ?? "").split("/"))
    .filter((segment) => segment.length > 0)
    .join("/")}`;
}

function unique(names: readonly string[]): string[] {
  return [...new Set(names)];
}
