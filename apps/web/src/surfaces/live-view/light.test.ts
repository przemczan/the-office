import { afterEach, describe, expect, it, vi } from "vitest";
import { lightAt, lightOfDay, placeOfZone } from "./light.ts";
import type { Light, SunDay } from "./live-view-types.ts";
import { sunDay } from "./sun.ts";

const WARSAW = "Europe/Warsaw";
/** 2026-03-20 in Warsaw, noon local (11:00 UTC). */
const EQUINOX = new Date(Date.UTC(2026, 2, 20, 11));

function warsawDay(): SunDay {
  const place = placeOfZone(WARSAW);
  if (place === null) throw new Error("Warsaw has no place");
  return sunDay(place, WARSAW, EQUINOX);
}

/** Every minute of a day's light. */
function lightsOf(day: SunDay): Light[] {
  return Array.from({ length: 1440 }, (_, minutes) => lightOfDay(day, minutes));
}

const channels = (color: number): number[] => [
  (color >> 16) & 0xff,
  (color >> 8) & 0xff,
  color & 0xff,
];

/** Design decision 11's sky by the sun's height, morning or evening. */
function expectedSky({ elevation, minutes }: Light, noon: number): Light["sky"] {
  if (elevation >= 8) return "day";
  if (elevation >= 2) return "golden";
  if (elevation >= -8) return minutes < noon ? "dawn" : "dusk";
  return "night";
}

function expectedSunPatch(elevation: number): Light["sunPatch"] {
  if (elevation <= 2) return null;
  return elevation > 12 ? { color: 0xfff1cf, alpha: 0.3 } : { color: 0xffc58f, alpha: 0.24 };
}

describe("the place of the browser's time zone", () => {
  it("finds a zone's principal place in zones.json", () => {
    expect(placeOfZone(WARSAW)).toEqual({ latitude: 52.25, longitude: 21 });
  });

  it("follows an old name to its zone: Asia/Calcutta is Kolkata", () => {
    const kolkata = placeOfZone("Asia/Kolkata");
    expect(kolkata).not.toBeNull();
    expect(placeOfZone("Asia/Calcutta")).toEqual(kolkata);
  });

  it("has no place for UTC or a zone it doesn't know", () => {
    expect(placeOfZone("Etc/UTC")).toBeNull();
    expect(placeOfZone("UTC")).toBeNull();
    expect(placeOfZone("Mars/Olympus_Mons")).toBeNull();
    expect(placeOfZone(null)).toBeNull();
  });
});

describe("the light without a place", () => {
  it.each(["Etc/UTC", "Mars/Olympus_Mons"])("is noon's day light all day in %s", (zone) => {
    for (const hour of [0, 3, 12, 22]) {
      const light = lightAt(new Date(Date.UTC(2026, 11, 21, hour)), zone);
      expect(light).toMatchObject({
        phase: "day",
        tint: 0xffffff,
        lampsOn: false,
        glow: 0,
        sky: "day",
        sunPatch: { color: 0xfff1cf, alpha: 0.3 },
        dawnAt: null,
        sun: null,
      });
    }
  });
});

describe("the light through a day", () => {
  const day = warsawDay();
  const lights = lightsOf(day);

  it("works the sun out where the browser's zone is", () => {
    const light = lightAt(EQUINOX, WARSAW);
    expect(light.sun).toMatchObject({ timeZone: WARSAW, latitude: 52.25, longitude: 21 });
    expect(light.minutes).toBe(12 * 60);
    expect(light.phase).toBe("day");
    expect(light.dawnAt).toBe(Date.UTC(2026, 2, 20) + ((day.civilDawn ?? 0) - day.offset) * 60_000);
  });

  it("is white from 14° up, and tinted low in the sky", () => {
    const high = lights.filter((light) => light.elevation >= 14);
    // Just under 14° the ramp rounds to white within a step of 8.
    const low = lights.filter((light) => light.elevation < 8);
    expect(high.length).toBeGreaterThan(0);
    expect(high.every((light) => light.tint === 0xffffff)).toBe(true);
    expect(low.some((light) => light.tint === 0xffffff)).toBe(false);
  });

  it("ramps differently at dawn and at dusk", () => {
    const nearHorizon = (morning: boolean) =>
      lights.find(
        (light) =>
          light.minutes < day.noon === morning && light.elevation > -1 && light.elevation < 1,
      );
    const morning = nearHorizon(true);
    const evening = nearHorizon(false);
    expect(morning).toBeDefined();
    expect(evening).toBeDefined();
    expect(morning?.tint).not.toBe(evening?.tint);
    // Deep night is the same blue either side of midnight.
    expect(lights[0]?.tint).toBe(lights[1439]?.tint);
    expect(lights[0]?.tint).toBe(0x5060a0);
  });

  it("changes each channel in steps of 8", () => {
    const offStep = lights.flatMap((light) =>
      channels(light.tint).filter((channel) => channel !== 255 && channel % 8 !== 0),
    );
    expect(offStep).toEqual([]);
  });

  it("turns the lamps on once it is dark enough, at dusk too", () => {
    expect(lights.some((light) => light.phase === "dusk" && light.lampsOn)).toBe(true);
    expect(lights.filter((light) => light.phase === "day").every((light) => !light.lampsOn)).toBe(
      true,
    );
    expect(lights.filter((light) => light.phase === "night").every((light) => light.lampsOn)).toBe(
      true,
    );
    expect(lights[0]?.glow).toBe(1);
    expect(lights[12 * 60]?.glow).toBe(0);
  });

  it("shows the day sky from 8°, golden from 2°, dawn or dusk down to -8°, then night", () => {
    expect(lights.map((light) => light.sky)).toEqual(
      lights.map((light) => expectedSky(light, day.noon)),
    );
    const skies = new Set(lights.map((light) => light.sky));
    expect(skies).toEqual(new Set(["night", "dawn", "golden", "day", "dusk"]));
  });

  it("lets sunlight fall on the floor only above 2°, warmer when low", () => {
    expect(lights.map((light) => light.sunPatch)).toEqual(
      lights.map((light) => expectedSunPatch(light.elevation)),
    );
  });
});

describe("privacy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never touches the browser's location", () => {
    const geolocation = vi.fn<() => Geolocation>();
    Object.defineProperty(navigator, "geolocation", { get: geolocation, configurable: true });
    lightAt(EQUINOX);
    lightAt(EQUINOX, WARSAW);
    expect(geolocation).not.toHaveBeenCalled();
  });
});
