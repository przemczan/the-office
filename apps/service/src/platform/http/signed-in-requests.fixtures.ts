import type { IncomingMessage } from "node:http";
import { Injectable, Module, type DynamicModule } from "@nestjs/common";
import type { Unsubscribe } from "../events/event-bus.js";
import { RequestAccessModule } from "./request-access.module.js";
import { SignedInRequests, type SignedIn } from "./signed-in-requests.js";

/** Who signs in every request of an app that doesn't test signing in. */
export const SIGNED_IN_FOR_TESTS: SignedIn = {
  userId: "00000000-0000-4000-8000-0000000005e1",
  name: "Ann Lee",
  signedInDeviceId: "00000000-0000-4000-8000-00000000de71",
};

/** A second user, for a test of what two users do; a request names them with `signedInAs`. */
export const ANOTHER_SIGNED_IN_FOR_TESTS: SignedIn = {
  userId: "00000000-0000-4000-8000-0000000005e2",
  name: "Ben Ito",
  signedInDeviceId: "00000000-0000-4000-8000-00000000de72",
};

const SIGNED_IN_AS_HEADER = "x-test-signed-in-as";

/** The header that makes `EveryoneSignedIn` take a request as signed in by `user`. */
export function signedInAs(user: SignedIn): Record<string, string> {
  return { [SIGNED_IN_AS_HEADER]: JSON.stringify(user) };
}

/**
 * Takes every request as signed in, so a module's tests need no user: by `SIGNED_IN_FOR_TESTS`, or
 * by whoever the request's `signedInAs` header names.
 */
@Injectable()
export class EveryoneSignedIn extends SignedInRequests {
  signedInOf(request: IncomingMessage): Promise<SignedIn> {
    const named = request.headers[SIGNED_IN_AS_HEADER];
    return Promise.resolve(
      typeof named === "string" ? (JSON.parse(named) as SignedIn) : SIGNED_IN_FOR_TESTS,
    );
  }

  onSignedOut(): Unsubscribe {
    return () => undefined;
  }

  signedOutAmong(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}

@Module({ providers: [EveryoneSignedIn], exports: [EveryoneSignedIn] })
class EveryoneSignedInModule {}

/** Request access for an app that doesn't test signing in: everyone signed in. */
export function everyoneSignedIn(publicAddress?: string): DynamicModule {
  return RequestAccessModule.register({
    publicAddress,
    imports: [EveryoneSignedInModule],
    signedInRequests: EveryoneSignedIn,
  });
}
