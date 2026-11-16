// Makes the Live view's zones.json, each time zone's principal place, from the tzdb on this machine.
//   --tzdb <folder>   the tzdata folder, /usr/share/zoneinfo when left out
// It never downloads anything: with no tzdata it fails, naming --tzdb.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseLinks, parseZone1970, zoneTable, type ZoneTable } from "./zone-table.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const output = join(repositoryRoot, "apps/web/src/surfaces/live-view/zones.json");
// npm runs a workspace's script in the workspace's folder; a path given on the command line is the caller's.
const callerFolder = process.env["INIT_CWD"] ?? process.cwd();

const { values } = parseArgs({ options: { tzdb: { type: "string" } } });
const tzdb = resolve(callerFolder, values.tzdb ?? "/usr/share/zoneinfo");

function readIfThere(name: string): string | undefined {
  const path = join(tzdb, name);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** tzdata.zi's first line `# version 2025b`, else a `version` or `+VERSION` file. */
function versionOf(tzdataZi: string | undefined): string | undefined {
  const fromZi = tzdataZi === undefined ? undefined : /^# version (\S+)/.exec(tzdataZi)?.[1];
  return fromZi ?? (readIfThere("version") ?? readIfThere("+VERSION"))?.trim();
}

/** The JSON as Prettier leaves it: objects one key a line, each place's pair on its key's line. */
function format(table: ZoneTable): string {
  const zones = Object.entries(table.zones).map(
    ([name, [latitude, longitude]]) =>
      `    ${JSON.stringify(name)}: [${String(latitude)}, ${String(longitude)}]`,
  );
  return [
    "{",
    `  "source": ${JSON.stringify(table.source)},`,
    `  "licence": ${JSON.stringify(table.licence)},`,
    `  "zones": {`,
    zones.join(",\n"),
    "  }",
    "}",
    "",
  ].join("\n");
}

const zone1970 = readIfThere("zone1970.tab");
const tzdataZi = readIfThere("tzdata.zi");
const links = tzdataZi ?? readIfThere("backward");
const version = versionOf(tzdataZi);

if (zone1970 === undefined || links === undefined || version === undefined) {
  console.error(
    `No tzdata in ${tzdb}: it needs zone1970.tab, tzdata.zi or backward, and a version. ` +
      "Install tzdata, or give its folder with --tzdb <folder>.",
  );
  process.exitCode = 1;
} else {
  const table = zoneTable(parseZone1970(zone1970), parseLinks(links), version);
  writeFileSync(output, format(table));
  console.log(
    `${Object.keys(table.zones).length} zones from tzdb ${version} written to ${relative(repositoryRoot, output)}.`,
  );
}
