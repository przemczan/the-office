/** The cookie that ties a passkey sign-in's answer to the browser that started it. */
export const PASSKEY_CEREMONY_COOKIE = "office_passkey_ceremony";

/** As long as a ceremony is pending: 5 minutes. */
const KEPT_SECONDS = 5 * 60;

/**
 * The Set-Cookie header for a passkey sign-in started: HttpOnly; sent back only to the passkey
 * sign-in's own routes and only from The Office's own pages (SameSite=Strict); Secure when the page
 * came through the public address over HTTPS.
 */
export function passkeyCeremonyCookie(ceremonyKey: string, secure: boolean): string {
  return cookie(ceremonyKey, KEPT_SECONDS, secure);
}

/** The Set-Cookie header that makes the browser forget it, once the ceremony is taken. */
export function clearedPasskeyCeremonyCookie(secure: boolean): string {
  return cookie("", 0, secure);
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return [
    `${PASSKEY_CEREMONY_COOKIE}=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/api/sign-in/passkey",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
