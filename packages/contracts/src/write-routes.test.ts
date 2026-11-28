import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFICE_ACTIONS } from "./office-action-list.js";
import { WRITE_ROUTE_REGISTER } from "./write-routes.js";

const SPEC_FOLDER = resolve(import.meta.dirname, "../../../docs/spec");

/**
 * How many known gaps are left. It only goes down: lower it when a gap becomes an Office action or
 * gets a written reason; never raise it (AGENTS.md, "Every user action has its Agent tool").
 */
const KNOWN_GAPS_LEFT = 28;

const ENTRIES = [
  ...WRITE_ROUTE_REGISTER.usersAlone,
  ...WRITE_ROUTE_REGISTER.noAction,
  ...WRITE_ROUTE_REGISTER.knownGaps,
];

/**
 * GitHub's anchor for each heading: lowercased, punctuation dropped, spaces as hyphens, repeats
 * numbered. A copy of `tools/install`'s, as a package may not import from tools.
 */
function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, "");
  for (const [, heading] of prose.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = (heading ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const repeats = seen.get(slug) ?? 0;
    seen.set(slug, repeats + 1);
    anchors.add(repeats === 0 ? slug : `${slug}-${repeats}`);
  }
  return anchors;
}

/** Why the spec heading doesn't resolve, or undefined when it does. */
function unresolved(specHeading: string): string | undefined {
  const [file = "", anchor, ...rest] = specHeading.split("#");
  if (anchor === undefined || anchor === "" || rest.length > 0) return "no single #anchor";
  const path = resolve(SPEC_FOLDER, file);
  if (relative(SPEC_FOLDER, path).startsWith("..") || !existsSync(path)) {
    return `no page docs/spec/${file}`;
  }
  return headingAnchors(readFileSync(path, "utf8")).has(anchor)
    ? undefined
    : `no heading #${anchor} on docs/spec/${file}`;
}

describe("the write-route register", () => {
  it("writes each route as its method, one space and the declared path", () => {
    const malformed = ENTRIES.map(({ route }) => route).filter(
      (route) => !/^(POST|PUT|PATCH|DELETE) \/\S*$/.test(route),
    );

    expect(malformed).toEqual([]);
  });

  it("lists each route once, across all three lists", () => {
    const routes = ENTRIES.map(({ route }) => route);

    expect(routes.filter((route, index) => routes.indexOf(route) !== index)).toEqual([]);
  });

  it("names no Office action route, which is classified by its declaration", () => {
    const officeActions = new Set<string>(
      OFFICE_ACTIONS.map(({ route }) => `${route.method} ${route.path}`),
    );

    expect(ENTRIES.filter(({ route }) => officeActions.has(route))).toEqual([]);
  });

  it("gives each route needing no action a reason of one line", () => {
    const unfit = WRITE_ROUTE_REGISTER.noAction.filter(
      ({ reason }) => reason.trim() === "" || /[\r\n]/.test(reason),
    );

    expect(unfit).toEqual([]);
  });

  it("gives each route the user's alone a spec heading that exists", () => {
    const broken = WRITE_ROUTE_REGISTER.usersAlone.flatMap(({ route, specHeading }) => {
      const problem = unresolved(specHeading);
      return problem === undefined ? [] : [`${route}: ${specHeading} (${problem})`];
    });

    expect(broken).toEqual([]);
  });

  it("holds exactly the tracked count of known gaps, so the list only shrinks", () => {
    expect(WRITE_ROUTE_REGISTER.knownGaps).toHaveLength(KNOWN_GAPS_LEFT);
  });

  it("marks every known gap by what covers it, none left undecided", () => {
    const marks = new Set<string>(["tool", "proposal", "partial", "gap"]);

    expect(WRITE_ROUTE_REGISTER.knownGaps.filter(({ agent }) => !marks.has(agent))).toEqual([]);
  });

  it("resolves a heading by its page and anchor", () => {
    expect(unresolved("6-permissions-and-safety.md#secrets")).toBeUndefined();
    expect(unresolved("6-permissions-and-safety.md#no-such-heading")).toBe(
      "no heading #no-such-heading on docs/spec/6-permissions-and-safety.md",
    );
    expect(unresolved("no-such-page.md#secrets")).toBe("no page docs/spec/no-such-page.md");
    expect(unresolved("6-permissions-and-safety.md")).toBe("no single #anchor");
    expect(unresolved("../README.md#x")).toBe("no page docs/spec/../README.md");
  });
});
