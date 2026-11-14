import type { AddressKind } from "@the-office/contracts";

/** The kind of address a device signed in at, in words (spec §2.10). */
export const ADDRESS_KIND_WORDS: Readonly<Record<AddressKind, string>> = {
  localhost: "Localhost",
  "loopback-ip": "Loopback IP",
  "local-network-ip": "Local network",
  public: "Public address",
};

/** Browsers by what their user agent names, the more specific first (Edge and Opera say Chrome). */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdgA?\//, "Edge"],
  [/\bOPR\//, "Opera"],
  [/\bFirefox\//, "Firefox"],
  [/\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\b(Headless)?Chrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

/** Systems by what the user agent names, the more specific first (Android says Linux). */
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\b(iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

/**
 * The browser a device signed in from, as "Chrome on Linux", from its user agent; "A browser" when
 * neither is known.
 */
export function browserWords(userAgent: string | null): string {
  if (userAgent === null) return "A browser";
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return browser;
  if (system) return `A browser on ${system}`;
  return "A browser";
}
