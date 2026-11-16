// The Live view's zone table: each time zone's principal place, from tzdb (public domain).

/** A place as [latitude, longitude] in decimal degrees, north and east positive. */
export type Place = [latitude: number, longitude: number];

export interface ZoneTable {
  source: string;
  licence: string;
  zones: Record<string, Place>;
}

/** Zones with no place: the Live view falls back to noon for them, so they stay out of the table. */
function isPlaceless(name: string): boolean {
  return name === "UTC" || name.startsWith("Etc/");
}

/** Rounds to 4 places, about 11 m: finer than the coordinates tzdb gives in minutes. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** One ISO 6709 part such as `+5215` or `-0740023`: sign, then degrees of `degreeDigits`, minutes and maybe seconds. */
function degrees(part: string, degreeDigits: number): number {
  const sign = part.startsWith("-") ? -1 : 1;
  const digits = part.slice(1);
  const whole = Number(digits.slice(0, degreeDigits));
  const minutes = Number(digits.slice(degreeDigits, degreeDigits + 2));
  const seconds = digits.length > degreeDigits + 2 ? Number(digits.slice(degreeDigits + 2)) : 0;
  return sign * (whole + minutes / 60 + seconds / 3600);
}

/** Parses zone1970.tab's coordinates, `±DDMM±DDDMM` or `±DDMMSS±DDDMMSS`. */
export function parseCoordinates(coordinates: string): Place {
  const match = /^([+-]\d{4}(?:\d{2})?)([+-]\d{5}(?:\d{2})?)$/.exec(coordinates);
  if (match === null) throw new Error(`Not ISO 6709 coordinates: ${coordinates}`);
  return [round(degrees(match[1]!, 2)), round(degrees(match[2]!, 3))];
}

/** zone1970.tab's lines (codes, coordinates, TZ, comments) as zone → place. */
export function parseZone1970(text: string): Map<string, Place> {
  const zones = new Map<string, Place>();
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const [, coordinates, zone] = line.split("\t");
    if (coordinates === undefined || zone === undefined) {
      throw new Error(`Not a zone1970.tab line: ${line}`);
    }
    zones.set(zone, parseCoordinates(coordinates));
  }
  return zones;
}

/** Links as name → target, from `backward`'s `Link TARGET NAME` or `tzdata.zi`'s `L TARGET NAME`. */
export function parseLinks(text: string): Map<string, string> {
  const links = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [keyword, target, name] = line.replace(/#.*/, "").trim().split(/\s+/);
    if ((keyword === "Link" || keyword === "L") && target !== undefined && name !== undefined) {
      links.set(name, target);
    }
  }
  return links;
}

/** Follows a chain of links to the zone it ends at; undefined when it loops. */
function resolveLink(name: string, links: Map<string, string>): string | undefined {
  const seen = new Set<string>();
  let current = name;
  while (links.has(current)) {
    if (seen.has(current)) return undefined;
    seen.add(current);
    current = links.get(current)!;
  }
  return current;
}

/**
 * Every zone1970.tab zone, plus each link that ends at one of them, since browsers still return
 * old names such as `Asia/Calcutta`, `Europe/Kiev` or `US/Eastern`. `UTC` and `Etc/*` are left out
 * even through a link: they have no place.
 */
export function zoneTable(
  zones: Map<string, Place>,
  links: Map<string, string>,
  version: string,
): ZoneTable {
  const places = new Map<string, Place>();
  for (const [name, place] of zones) places.set(name, place);
  for (const name of links.keys()) {
    const target = resolveLink(name, links);
    const place = target === undefined ? undefined : zones.get(target);
    if (place !== undefined && !places.has(name)) places.set(name, place);
  }
  const sorted: Record<string, Place> = {};
  for (const name of [...places.keys()].toSorted()) {
    if (!isPlaceless(name)) sorted[name] = places.get(name)!;
  }
  return {
    source: `tzdb ${version}: zone1970.tab and its links`,
    licence: "public domain",
    zones: sorted,
  };
}
