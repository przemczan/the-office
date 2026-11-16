import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCoordinates, parseLinks, parseZone1970, zoneTable } from "./zone-table.ts";

const ZONE1970 = [
  "# tzdb timezone descriptions, for users who do not care about old timestamps",
  "#",
  "#country-",
  "#codes\tcoordinates\tTZ\tcomments",
  "US\t+404251-0740023\tAmerica/New_York\tEastern (most areas)",
  "BR\t-2332-04637\tAmerica/Sao_Paulo\tBrazil (southeast: GO, DF, MG, ES, RJ, SP, PR, SC, RS)",
  "IN\t+2232+08822\tAsia/Kolkata",
  "PL\t+5215+02100\tEurope/Warsaw",
  "",
].join("\n");

const BACKWARD = [
  "# Link\tTARGET\t\t\tLINK-NAME\t#= preferred",
  "Link\tAsia/Kolkata\t\tAsia/Calcutta",
  "Link\tEtc/UTC\t\t\tUTC",
  "Link\tUS/Eastern\t\tUS/EasternAgain",
].join("\n");

const TZDATA_ZI = [
  "# version 2026e",
  "Z Etc/UTC 0 - UTC",
  "L America/New_York US/Eastern",
  "L Etc/UTC Etc/Zulu",
  "L Etc/UTC UTC",
].join("\n");

describe("parseCoordinates", () => {
  it("reads degrees and minutes", () => {
    assert.deepEqual(parseCoordinates("+5215+02100"), [52.25, 21]);
  });

  it("reads seconds, rounded to 4 places", () => {
    assert.deepEqual(parseCoordinates("+404251-0740023"), [40.7142, -74.0064]);
  });

  it("puts south and west below zero", () => {
    assert.deepEqual(parseCoordinates("-2332-04637"), [-23.5333, -46.6167]);
  });

  it("refuses what isn't ISO 6709", () => {
    assert.throws(() => parseCoordinates("52.25,21"));
  });
});

describe("zoneTable", () => {
  const zones = parseZone1970(ZONE1970);

  it("has every zone1970.tab zone at its place", () => {
    const table = zoneTable(zones, new Map(), "2026e");
    assert.deepEqual(table.zones["Europe/Warsaw"], [52.25, 21]);
    assert.deepEqual(table.zones["America/Sao_Paulo"], [-23.5333, -46.6167]);
    assert.equal(Object.keys(table.zones).length, 4);
  });

  it("places an old name at its target, from backward and from tzdata.zi", () => {
    const table = zoneTable(zones, parseLinks(BACKWARD), "2026e");
    assert.deepEqual(table.zones["Asia/Calcutta"], table.zones["Asia/Kolkata"]);
    const fromZi = zoneTable(zones, parseLinks(TZDATA_ZI), "2026e");
    assert.deepEqual(fromZi.zones["US/Eastern"], [40.7142, -74.0064]);
  });

  it("follows a chain of links", () => {
    const links = new Map([...parseLinks(TZDATA_ZI), ...parseLinks(BACKWARD)]);
    const table = zoneTable(zones, links, "2026e");
    assert.deepEqual(table.zones["US/EasternAgain"], [40.7142, -74.0064]);
  });

  it("leaves out UTC and Etc zones, even through links", () => {
    const withUtc = new Map([...zones, ["Etc/UTC", [0, 0] as [number, number]]]);
    const table = zoneTable(withUtc, parseLinks(TZDATA_ZI + "\n" + BACKWARD), "2026e");
    for (const name of ["Etc/UTC", "Etc/Zulu", "UTC"]) assert.equal(table.zones[name], undefined);
  });

  it("sorts the zones by name and says where they came from", () => {
    const table = zoneTable(zones, parseLinks(BACKWARD), "2026e");
    const names = Object.keys(table.zones);
    assert.deepEqual(names, names.toSorted());
    assert.equal(table.source, "tzdb 2026e: zone1970.tab and its links");
    assert.equal(table.licence, "public domain");
  });
});
