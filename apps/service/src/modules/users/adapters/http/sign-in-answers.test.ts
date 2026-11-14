import type { Response } from "express";
import { describe, expect, it } from "vitest";
import type { SignInOutcome } from "../../application/sign-ins.js";
import { answerSignIn, redirectSignIn } from "./sign-in-answers.js";

/** A response that keeps what was set on it. */
function recordingResponse() {
  const recorded: { cookies: string[]; status?: number; location?: string } = { cookies: [] };
  const response = {
    setHeader: (name: string, value: string[]) => {
      if (name === "Set-Cookie") recorded.cookies = value;
    },
    redirect: (status: number, location: string) => {
      recorded.status = status;
      recorded.location = location;
    },
  } as unknown as Response;
  return { response, recorded };
}

const SIGNED_IN: SignInOutcome = {
  outcome: "signed-in",
  token: "device-token",
  signedInDeviceId: "device-1",
};
const CODE_NEEDED: SignInOutcome = { outcome: "code-needed", pendingToken: "pending-token" };

describe("a way's callback, as Continue with GitHub and Continue with Google answer", () => {
  it("sends the browser to the code page when the code is needed, the pending cookie set", () => {
    const { response, recorded } = recordingResponse();

    redirectSignIn(CODE_NEEDED, true, "/work?tab=board", response);

    expect(recorded.status).toBe(303);
    expect(recorded.location).toBe("/sign-in/code?returnTo=%2Fwork%3Ftab%3Dboard");
    expect(recorded.cookies).toEqual([
      "office_pending_sign_in=pending-token; HttpOnly; SameSite=Lax; Path=/api/sign-in; Max-Age=300; Secure",
    ]);
  });

  it("sends the browser on once signed in, never to another site", () => {
    const signedIn = recordingResponse();
    const elsewhere = recordingResponse();

    redirectSignIn(SIGNED_IN, false, "/now", signedIn.response);
    redirectSignIn(SIGNED_IN, false, "//evil.example.com", elsewhere.response);

    expect(signedIn.recorded.location).toBe("/now");
    expect(signedIn.recorded.cookies[0]).toMatch(/^office_signed_in=device-token; /);
    expect(elsewhere.recorded.location).toBe("/");
  });
});

describe("a sign-in answered in the body", () => {
  it("never carries a token, only the outcome", () => {
    const { response, recorded } = recordingResponse();

    expect(answerSignIn(CODE_NEEDED, false, response)).toEqual({ outcome: "code-needed" });
    expect(recorded.cookies).toHaveLength(1);
  });
});
