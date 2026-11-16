import { mix } from "./art/pixel-grid.ts";
import type { Light, Place, Sky, SunDay } from "./live-view-types.ts";
import { instantOfMinutes, localMinutes, phaseAt, sunDay, sunElevation } from "./sun.ts";
import zoneTable from "./zones.json";

/*
 * The hours (design decision 11): the light follows the sun where the browser is. The place comes
 * only from the browser's time zone, looked up in zones.json (made by `npm run live-view-zones`):
 * nothing asks for the location and nothing is sent anywhere.
 */

const ZONES: Readonly<Record<string, readonly number[]>> = zoneTable.zones;

/** The browser's IANA time zone, or null when it gives none. */
export function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** The zone's principal place from tzdb, or null for a zone it has none for (`Etc/*`, `UTC`). */
export function placeOfZone(zone: string | null): Place | null {
  if (zone === null || !Object.hasOwn(ZONES, zone)) return null;
  const [latitude, longitude] = ZONES[zone] ?? [];
  return latitude === undefined || longitude === undefined ? null : { latitude, longitude };
}

/** The tint by the sun's height, morning and evening: blue at night, warm near the horizon, white from 14°. */
type LightStops = readonly (readonly [elevation: number, color: number])[];

const DAWN_LIGHT: LightStops = [
  [-12, 0x525d9c],
  [-6, 0x7177b2],
  [-2, 0xc49bbb],
  [2, 0xf5c6b5],
  [8, 0xfff0dd],
  [14, 0xffffff],
];
const DUSK_LIGHT: LightStops = [
  [-12, 0x525d9c],
  [-6, 0x6c6ba8],
  [-2, 0xb88a9c],
  [2, 0xf0b48e],
  [8, 0xffe6c8],
  [14, 0xffffff],
];
/** Tints change in steps of 8 per channel, so the minute's light only changes the art now and then. */
const TINT_STEP = 8;
/** Dark enough for desk lamps, which is dusk too. */
const LAMPS_ON_DARKNESS = 0.3;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const channels = (color: number): [number, number, number] => [
  (color >> 16) & 0xff,
  (color >> 8) & 0xff,
  color & 0xff,
];

function tintAt(elevation: number, morning: boolean): number {
  const stops = morning ? DAWN_LIGHT : DUSK_LIGHT;
  let tint = stops[0]?.[1] ?? 0xffffff;
  if (elevation >= (stops.at(-1)?.[0] ?? 0)) tint = 0xffffff;
  else {
    for (let i = 1; i < stops.length; i++) {
      const [fromElevation, fromColor] = stops[i - 1] ?? [0, 0];
      const [toElevation, toColor] = stops[i] ?? [0, 0];
      if (elevation <= toElevation) {
        tint = mix(
          fromColor,
          toColor,
          clamp((elevation - fromElevation) / (toElevation - fromElevation), 0, 1),
        );
        break;
      }
    }
  }
  const [red, green, blue] = channels(tint).map((value) =>
    Math.min(255, Math.round(value / TINT_STEP) * TINT_STEP),
  );
  return ((red ?? 0) << 16) | ((green ?? 0) << 8) | (blue ?? 0);
}

function darknessOf(tint: number): number {
  const [red, green, blue] = channels(tint);
  return clamp(1 - (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255, 0, 1);
}

function skyAt(elevation: number, morning: boolean): Sky {
  if (elevation >= 8) return "day";
  if (elevation >= 2) return "golden";
  if (elevation >= -8) return morning ? "dawn" : "dusk";
  return "night";
}

function sunPatchAt(elevation: number): Light["sunPatch"] {
  if (elevation <= 2) return null;
  return elevation > 12 ? { color: 0xfff1cf, alpha: 0.3 } : { color: 0xffc58f, alpha: 0.24 };
}

/** The light at a minute of a sunny day. */
export function lightOfDay(day: SunDay, minutes: number): Light {
  const elevation = sunElevation(day, minutes);
  const morning = minutes < day.noon;
  const tint = tintAt(elevation, morning);
  const darkness = darknessOf(tint);
  return {
    phase: phaseAt(day, minutes),
    tint,
    lampsOn: darkness > LAMPS_ON_DARKNESS,
    glow: clamp((darkness - 0.12) / 0.45, 0, 1),
    sky: skyAt(elevation, morning),
    sunPatch: sunPatchAt(elevation),
    elevation,
    minutes,
    dawnAt:
      day.polar === null && day.civilDawn !== null ? instantOfMinutes(day, day.civilDawn) : null,
    sun: day,
  };
}

/** Noon's light, all day, where the browser's zone gives no place to work the sun out from. */
function noonLight(minutes: number): Light {
  const elevation = 60;
  return {
    phase: "day",
    tint: 0xffffff,
    lampsOn: false,
    glow: 0,
    sky: "day",
    sunPatch: sunPatchAt(elevation),
    elevation,
    minutes,
    dawnAt: null,
    sun: null,
  };
}

/** The last day worked out: the sun changes only with the zone and the local date. */
let cachedDay: { readonly key: string; readonly day: SunDay } | null = null;

function sunDayOf(place: Place, zone: string, now: Date): SunDay {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(now);
  const key = `${zone} ${date}`;
  if (cachedDay?.key !== key) cachedDay = { key, day: sunDay(place, zone, now) };
  return cachedDay.day;
}

/** The light now in the zone (the browser's by default). */
export function lightAt(now: Date, zone: string | null = browserZone()): Light {
  const place = placeOfZone(zone);
  if (zone === null || place === null) return noonLight(now.getHours() * 60 + now.getMinutes());
  return lightOfDay(sunDayOf(place, zone, now), localMinutes(zone, now));
}
