import type { Phase, Place, SunDay } from "./live-view-types.ts";

/* Sunrise, sunset and the sun's height from NOAA's solar equations (https://gml.noaa.gov/grad/solcalc/). */

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** The sun's centre this far from the zenith is sunrise or sunset: refraction and its radius. */
const SUNRISE_ZENITH = 90.833;
/** Civil twilight ends with the sun 6° below the horizon. */
const CIVIL_ZENITH = 96;
/** Dawn lasts until this long after sunrise, and dusk starts this long before sunset. */
const PHASE_EDGE_MINUTES = 40;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;
const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export interface SunPosition {
  /** Degrees north of the equator. */
  readonly declination: number;
  /** How far sundial time runs ahead of clock time, in minutes. */
  readonly equationOfTime: number;
}

/** The sun's declination and the equation of time at an instant (NOAA's solar calculator). */
export function sunAt(utcMs: number): SunPosition {
  const t = (utcMs / DAY_MS + 2440587.5 - 2451545) / 36525;
  const meanLongitude = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = toRadians(meanAnomaly);
  const centre =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(toRadians(omega));
  const obliquity =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 +
    0.00256 * Math.cos(toRadians(omega));
  const declination = toDegrees(
    Math.asin(Math.sin(toRadians(obliquity)) * Math.sin(toRadians(apparentLongitude))),
  );
  const y = Math.tan(toRadians(obliquity / 2)) ** 2;
  const l = toRadians(meanLongitude);
  const equationOfTime =
    4 *
    toDegrees(
      y * Math.sin(2 * l) -
        2 * eccentricity * Math.sin(m) +
        4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l) -
        0.5 * y * y * Math.sin(4 * l) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * m),
    );
  return { declination, equationOfTime };
}

type Parts = Partial<Record<Intl.DateTimeFormatPartTypes, number>>;

function partsOf(timeZone: string, date: Date, withTime: boolean): Parts {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    ...(withTime
      ? { hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" }
      : {}),
  });
  const parts: Parts = {};
  for (const part of format.formatToParts(date))
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  return parts;
}

/** How far the zone is ahead of UTC at that instant, in minutes. */
export function zoneOffsetMinutes(timeZone: string, date: Date): number {
  const parts = partsOf(timeZone, date, true);
  const asUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    (parts.hour ?? 0) % 24,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return Math.round((asUtc - (date.getTime() - date.getMilliseconds())) / MINUTE_MS);
}

/** Minutes after local midnight in the zone, from its clock. */
export function localMinutes(timeZone: string, now: Date): number {
  const parts = partsOf(timeZone, now, true);
  return ((parts.hour ?? 0) % 24) * 60 + (parts.minute ?? 0) + (parts.second ?? 0) / 60;
}

type Crossing =
  | { readonly polar: "day" | "night" }
  | { readonly polar: null; readonly rise: number; readonly set: number };

/** Today in a zone at a place: its date, offset, and when the sun rises and sets, in minutes after local midnight. */
export function sunDay(place: Place, timeZone: string, now: Date): SunDay {
  const { latitude, longitude } = place;
  const parts = partsOf(timeZone, now, false);
  const date = { year: parts.year ?? 1970, month: parts.month ?? 1, day: parts.day ?? 1 };
  const offset = zoneOffsetMinutes(timeZone, now);
  const midnightUtc = Date.UTC(date.year, date.month - 1, date.day) - offset * MINUTE_MS;
  const instantOf = (minutes: number): number => midnightUtc + minutes * MINUTE_MS;
  const noonAt = (utcMs: number): number =>
    720 - 4 * longitude - sunAt(utcMs).equationOfTime + offset;
  const hourAngleAt = (zenith: number, utcMs: number): number | "day" | "night" => {
    const { declination } = sunAt(utcMs);
    const cosHourAngle =
      Math.cos(toRadians(zenith)) /
        (Math.cos(toRadians(latitude)) * Math.cos(toRadians(declination))) -
      Math.tan(toRadians(latitude)) * Math.tan(toRadians(declination));
    if (cosHourAngle > 1) return "night";
    if (cosHourAngle < -1) return "day";
    return toDegrees(Math.acos(cosHourAngle));
  };
  // NOAA's refinement: work each time out at noon, then again at the instant the first pass gave.
  const timeOf = (zenith: number, side: -1 | 1, estimate: number): number => {
    const at = instantOf(estimate);
    const hourAngle = hourAngleAt(zenith, at);
    if (typeof hourAngle !== "number") return estimate;
    return noonAt(at) + side * 4 * hourAngle;
  };
  const crossing = (zenith: number): Crossing => {
    const noonUtc = instantOf(720);
    const hourAngle = hourAngleAt(zenith, noonUtc);
    if (typeof hourAngle !== "number") return { polar: hourAngle };
    const solarNoon = noonAt(noonUtc);
    return {
      polar: null,
      rise: timeOf(zenith, -1, solarNoon - 4 * hourAngle),
      set: timeOf(zenith, 1, solarNoon + 4 * hourAngle),
    };
  };
  const noon = noonAt(instantOf(720));
  const sun = crossing(SUNRISE_ZENITH);
  if (sun.polar !== null)
    return {
      timeZone,
      latitude,
      longitude,
      date,
      offset,
      noon,
      polar: sun.polar,
      sunrise: null,
      sunset: null,
      civilDawn: null,
      civilDusk: null,
    };
  // A white night: the sun never sinks 6° below the horizon, so twilight lasts from sunset to sunrise.
  const civil = crossing(CIVIL_ZENITH);
  return {
    timeZone,
    latitude,
    longitude,
    date,
    offset,
    noon,
    polar: null,
    sunrise: sun.rise,
    sunset: sun.set,
    civilDawn: civil.polar === null ? civil.rise : sun.rise,
    civilDusk: civil.polar === null ? civil.set : sun.set,
  };
}

/** The sun's height above the horizon at a minute of the day, in degrees. */
export function sunElevation(day: SunDay, minutes: number): number {
  const utcMs =
    Date.UTC(day.date.year, day.date.month - 1, day.date.day) + (minutes - day.offset) * MINUTE_MS;
  const { declination, equationOfTime } = sunAt(utcMs);
  const trueSolar =
    (((minutes - day.offset + equationOfTime + 4 * day.longitude) % 1440) + 1440) % 1440;
  const hourAngle = trueSolar / 4 - 180;
  const cosZenith =
    Math.sin(toRadians(day.latitude)) * Math.sin(toRadians(declination)) +
    Math.cos(toRadians(day.latitude)) *
      Math.cos(toRadians(declination)) *
      Math.cos(toRadians(hourAngle));
  return 90 - toDegrees(Math.acos(clamp(cosZenith, -1, 1)));
}

/** Night before civil dawn and after civil dusk; dawn until 40 minutes past sunrise; dusk from 40 minutes before sunset. */
export function phaseAt(day: SunDay, minutes: number): Phase {
  if (day.polar !== null) return day.polar;
  const { sunrise, sunset, civilDawn, civilDusk } = day;
  if (sunrise === null || sunset === null || civilDawn === null || civilDusk === null) return "day";
  if (minutes < civilDawn || minutes >= civilDusk) return "night";
  if (minutes < sunrise + PHASE_EDGE_MINUTES) return "dawn";
  if (minutes >= sunset - PHASE_EDGE_MINUTES) return "dusk";
  return "day";
}

/** Epoch ms of a minute of the day. */
export function instantOfMinutes(day: SunDay, minutes: number): number {
  return (
    Date.UTC(day.date.year, day.date.month - 1, day.date.day) + (minutes - day.offset) * MINUTE_MS
  );
}
