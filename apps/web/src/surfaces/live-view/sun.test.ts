import { describe, expect, it } from "vitest";
import { localMinutes, phaseAt, sunDay, sunElevation, zoneOffsetMinutes } from "./sun.ts";
import type { Place, SunDay } from "./live-view-types.ts";

const HOUR_MS = 3_600_000;

/** Noon local time on a date in a zone. */
function localNoon(timeZone: string, year: number, month: number, day: number): Date {
  const noonUtc = Date.UTC(year, month - 1, day, 12);
  return new Date(noonUtc - zoneOffsetMinutes(timeZone, new Date(noonUtc)) * 60_000);
}

const minutesOf = (clock: string): number => {
  const [hours, minutes] = clock.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

interface City {
  readonly name: string;
  readonly timeZone: string;
  readonly place: Place;
  /** Sunrise and sunset, local time with DST, from NOAA's Solar Calculator's yearly tables. */
  readonly source: string;
  readonly times: Readonly<Record<string, readonly [sunrise: string, sunset: string]>>;
}

// Coordinates are each zone's in /usr/share/zoneinfo/zone1970.tab, in decimal degrees.
const CITIES: readonly City[] = [
  {
    name: "Warsaw",
    timeZone: "Europe/Warsaw",
    place: { latitude: 52.25, longitude: 21 },
    source: "https://gml.noaa.gov/grad/solcalc/table.php?lat=52.25&lon=21&year=2026",
    times: {
      "2026-03-20": ["05:39", "17:49"],
      "2026-06-21": ["04:14", "21:01"],
      "2026-09-22": ["06:22", "18:35"],
      "2026-12-21": ["07:43", "15:25"],
    },
  },
  {
    name: "London",
    timeZone: "Europe/London",
    place: { latitude: 51.5083, longitude: -0.1253 },
    source: "https://gml.noaa.gov/grad/solcalc/table.php?lat=51.5083&lon=-0.1253&year=2026",
    times: {
      "2026-03-20": ["06:03", "18:13"],
      "2026-06-21": ["04:43", "21:22"],
      "2026-09-22": ["06:46", "18:59"],
      "2026-12-21": ["08:04", "15:53"],
    },
  },
  {
    name: "New York",
    timeZone: "America/New_York",
    place: { latitude: 40.7142, longitude: -74.0064 },
    source: "https://gml.noaa.gov/grad/solcalc/table.php?lat=40.7142&lon=-74.0064&year=2026",
    times: {
      "2026-03-20": ["06:59", "19:08"],
      "2026-06-21": ["05:25", "20:31"],
      "2026-09-22": ["06:44", "18:53"],
      "2026-12-21": ["07:17", "16:32"],
    },
  },
  {
    name: "Sydney",
    timeZone: "Australia/Sydney",
    place: { latitude: -33.8667, longitude: 151.2167 },
    source: "https://gml.noaa.gov/grad/solcalc/table.php?lat=-33.8667&lon=151.2167&year=2026",
    times: {
      "2026-03-20": ["06:58", "19:07"],
      "2026-06-21": ["07:00", "16:54"],
      "2026-09-22": ["05:45", "17:51"],
      "2026-12-21": ["05:41", "20:05"],
    },
  },
  {
    name: "Tokyo",
    timeZone: "Asia/Tokyo",
    place: { latitude: 35.6544, longitude: 139.7447 },
    source: "https://gml.noaa.gov/grad/solcalc/table.php?lat=35.6544&lon=139.7447&year=2026",
    times: {
      "2026-03-20": ["05:45", "17:52"],
      "2026-06-21": ["04:25", "19:00"],
      "2026-09-22": ["05:29", "17:39"],
      "2026-12-21": ["06:47", "16:31"],
    },
  },
];

const CASES = CITIES.flatMap((city) =>
  Object.entries(city.times).map(([date, [sunrise, sunset]]) => ({
    city,
    date,
    sunrise,
    sunset,
  })),
);

describe("sunDay", () => {
  it.each(CASES)(
    "$city.name on $date: sunrise $sunrise, sunset $sunset, within 2 minutes of NOAA",
    ({ city, date, sunrise, sunset }) => {
      const [year, month, day] = date.split("-").map(Number) as [number, number, number];
      const sun = sunDay(city.place, city.timeZone, localNoon(city.timeZone, year, month, day));

      expect(sun.date).toEqual({ year, month, day });
      expect(sun.polar).toBeNull();
      expect(Math.abs((sun.sunrise ?? Number.NaN) - minutesOf(sunrise))).toBeLessThanOrEqual(2);
      expect(Math.abs((sun.sunset ?? Number.NaN) - minutesOf(sunset))).toBeLessThanOrEqual(2);
    },
  );

  const SVALBARD: Place = { latitude: 78.22, longitude: 15.65 };

  it("is polar day all of midsummer and polar night all of midwinter in Svalbard", () => {
    const summer = sunDay(SVALBARD, "Europe/Oslo", localNoon("Europe/Oslo", 2026, 6, 21));
    const winter = sunDay(SVALBARD, "Europe/Oslo", localNoon("Europe/Oslo", 2026, 12, 21));

    expect(summer.polar).toBe("day");
    expect(winter.polar).toBe("night");
    for (let hour = 0; hour < 24; hour++) {
      expect(phaseAt(summer, hour * 60)).toBe("day");
      expect(phaseAt(winter, hour * 60)).toBe("night");
    }
  });

  it("gives a white night civil twilight from sunset to sunrise in Reykjavik at midsummer", () => {
    const reykjavik: Place = { latitude: 64.15, longitude: -21.85 };
    const sun = sunDay(
      reykjavik,
      "Atlantic/Reykjavik",
      localNoon("Atlantic/Reykjavik", 2026, 6, 21),
    );
    let lowest = Infinity;
    for (let minute = 0; minute < 1440; minute++)
      lowest = Math.min(lowest, sunElevation(sun, minute));

    // The sun sets, but never sinks to 6° below the horizon (about 2.4° at its lowest).
    expect(lowest).toBeLessThan(-0.833);
    expect(lowest).toBeGreaterThan(-4);
    expect(sun.polar).toBeNull();
    expect(sun.sunrise).not.toBeNull();
    expect(sun.sunset).not.toBeNull();
    expect(sun.civilDawn).toBe(sun.sunrise);
    expect(sun.civilDusk).toBe(sun.sunset);
  });
});

describe("zoneOffsetMinutes", () => {
  it("moves to summer time in Warsaw at 01:00 UTC on 2026-03-29", () => {
    expect(zoneOffsetMinutes("Europe/Warsaw", new Date("2026-03-29T00:59:00Z"))).toBe(60);
    expect(zoneOffsetMinutes("Europe/Warsaw", new Date("2026-03-29T01:00:00Z"))).toBe(120);
  });

  it("moves back to standard time in New York at 06:00 UTC on 2026-11-01", () => {
    expect(zoneOffsetMinutes("America/New_York", new Date("2026-11-01T05:59:00Z"))).toBe(-240);
    expect(zoneOffsetMinutes("America/New_York", new Date("2026-11-01T06:00:00Z"))).toBe(-300);
  });
});

describe("localMinutes", () => {
  it("reads the zone's clock, with summer time", () => {
    expect(localMinutes("Europe/Warsaw", new Date("2026-07-01T20:30:00Z"))).toBe(22 * 60 + 30);
    expect(localMinutes("Europe/Warsaw", new Date("2026-01-15T21:30:00Z"))).toBe(22 * 60 + 30);
    expect(localMinutes("Europe/Warsaw", new Date(Date.UTC(2026, 0, 15, 23) + HOUR_MS / 2))).toBe(
      30,
    );
  });
});

describe("phaseAt", () => {
  const day: SunDay = {
    timeZone: "UTC",
    latitude: 0,
    longitude: 0,
    date: { year: 2026, month: 3, day: 20 },
    offset: 0,
    noon: 700,
    polar: null,
    sunrise: 400,
    sunset: 1000,
    civilDawn: 360,
    civilDusk: 1040,
  };

  it.each([
    [0, "night"],
    [359, "night"],
    [360, "dawn"],
    [439, "dawn"],
    [440, "day"],
    [959, "day"],
    [960, "dusk"],
    [1039, "dusk"],
    [1040, "night"],
    [1439, "night"],
  ] as const)("at minute %i is %s", (minute, phase) => {
    expect(phaseAt(day, minute)).toBe(phase);
  });
});
