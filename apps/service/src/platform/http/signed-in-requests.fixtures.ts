import { Injectable, Module, type DynamicModule } from "@nestjs/common";
import type { Unsubscribe } from "../events/event-bus.js";
import { RequestAccessModule } from "./request-access.module.js";
import { SignedInRequests, type SignedIn } from "./signed-in-requests.js";

/** Who signs in every request of an app that doesn't test signing in. */
export const SIGNED_IN_FOR_TESTS: SignedIn = {
  userId: "00000000-0000-4000-8000-0000000005e1",
  signedInDeviceId: "00000000-0000-4000-8000-00000000de71",
};

/** Takes every request as signed in, so a module's tests need no user. */
@Injectable()
export class EveryoneSignedIn extends SignedInRequests {
  signedInOf(): Promise<SignedIn> {
    return Promise.resolve(SIGNED_IN_FOR_TESTS);
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
