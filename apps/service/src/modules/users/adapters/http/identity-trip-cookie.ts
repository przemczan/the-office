/** The cookie that ties Continue with a provider's sign-in to the browser that started it. */
export const IDENTITY_TRIP_COOKIE = "office_identity_trip";

/** As long as a trip is under way: 10 minutes. */
const KEPT_SECONDS = 10 * 60;

/**
 * The Set-Cookie header for a sign-in's trip to a provider: HttpOnly; sent back only to the sign-in
 * routes, the callback among them; `SameSite=Lax`, so the provider's redirect back carries it;
 * Secure when the page came through the public address over HTTPS.
 */
export function identityTripCookie(nonce: string, secure: boolean): string {
  return cookie(nonce, KEPT_SECONDS, secure);
}

/** The Set-Cookie header that makes the browser forget it, once the trip is back. */
export function clearedIdentityTripCookie(secure: boolean): string {
  return cookie("", 0, secure);
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return [
    `${IDENTITY_TRIP_COOKIE}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/api/sign-in",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
