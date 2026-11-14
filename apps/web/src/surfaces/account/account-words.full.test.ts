import { describe, expect, it } from "vitest";
import { ADDRESS_KIND_WORDS, browserWords } from "./account-words.ts";

const CHROME_ON_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEADLESS_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36";
const EDGE_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const SAFARI_ON_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const FIREFOX_ON_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0";
const SAFARI_ON_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

describe("a signed-in device's browser in words", () => {
  it("names the browser and its system", () => {
    expect(browserWords(CHROME_ON_LINUX)).toBe("Chrome on Linux");
    expect(browserWords(HEADLESS_CHROME)).toBe("Chrome on Linux");
    expect(browserWords(EDGE_ON_WINDOWS)).toBe("Edge on Windows");
    expect(browserWords(SAFARI_ON_MAC)).toBe("Safari on macOS");
    expect(browserWords(FIREFOX_ON_ANDROID)).toBe("Firefox on Android");
    expect(browserWords(SAFARI_ON_IPHONE)).toBe("Safari on iOS");
  });

  it("says as much as it knows, or that it was a browser", () => {
    expect(browserWords(null)).toBe("A browser");
    expect(browserWords("curl/8.5.0")).toBe("A browser");
    expect(browserWords("Something (Windows NT 10.0)")).toBe("A browser on Windows");
  });

  it("words each kind of address plainly", () => {
    expect(Object.values(ADDRESS_KIND_WORDS)).toEqual([
      "Localhost",
      "Loopback IP",
      "Local network",
      "Public address",
    ]);
  });
});
