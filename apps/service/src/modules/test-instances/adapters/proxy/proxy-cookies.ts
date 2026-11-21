/**
 * The cookies at a Proxy port (spec §5.1, "Upstream cookie names"). Browsers don't separate
 * cookies by port, so every cookie of The Office and of every test instance reaches every port:
 * the instance's own sign-in is `office_test_instance_<id>`, and each cookie its app sets is kept
 * by the browser as `oti_<first 8 hex digits of the id>_<name>`, mapped back on the way in. Only
 * those reach the app: The Office's `office_signed_in`, every instance's sign-in and every other
 * instance's cookies are dropped, and an app's own `office_signed_in` can't overwrite The Office's.
 */

/** The cookie that signs a browser in to one test instance alone. */
export function instanceCookieName(instanceId: string): string {
  return `office_test_instance_${instanceId}`;
}

/** The prefix of the instance's app's cookies, as the browser keeps them. */
export function appCookiePrefix(instanceId: string): string {
  return `oti_${instanceId.replaceAll("-", "").slice(0, 8)}_`;
}

/** The Set-Cookie header that signs the browser in to the instance: HttpOnly, SameSite=Strict. */
export function instanceCookie(instanceId: string, value: string): string {
  return `${instanceCookieName(instanceId)}=${value}; HttpOnly; SameSite=Strict; Path=/`;
}

/** The value of the cookie of this name a Cookie header carries, or undefined. */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  return cookiesOf(header).find((cookie) => cookie.name === name)?.value;
}

/**
 * The Cookie header the app gets: only its own cookies, by their own names; undefined when it has
 * none.
 */
export function appCookieHeader(
  header: string | undefined,
  instanceId: string,
): string | undefined {
  const prefix = appCookiePrefix(instanceId);
  const kept = cookiesOf(header)
    .filter(({ name }) => name.startsWith(prefix) && name.length > prefix.length)
    .map(({ name, value }) => `${name.slice(prefix.length)}=${value}`);
  return kept.length === 0 ? undefined : kept.join("; ");
}

/** An app's Set-Cookie header as the browser gets it: its name prefixed, any `Domain` left out. */
export function browserSetCookie(setCookie: string, instanceId: string): string {
  const [pair = "", ...attributes] = setCookie.split(";");
  const separator = pair.indexOf("=");
  const name = (separator === -1 ? "" : pair.slice(0, separator)).trim();
  const value = separator === -1 ? pair.trim() : pair.slice(separator + 1).trim();
  const kept = attributes.filter((attribute) => !/^\s*domain\s*(=|$)/i.test(attribute));
  return [`${appCookiePrefix(instanceId)}${name}=${value}`, ...kept.map((each) => each.trim())]
    .filter((part) => part !== "")
    .join("; ");
}

function cookiesOf(header: string | undefined): { name: string; value: string }[] {
  return (header ?? "").split(";").flatMap((pair) => {
    const separator = pair.indexOf("=");
    if (separator === -1) return [];
    const name = pair.slice(0, separator).trim();
    return name === "" ? [] : [{ name, value: pair.slice(separator + 1).trim() }];
  });
}
