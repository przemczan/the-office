import { Injectable } from "@nestjs/common";
import { SecondSteps, type SecondStep } from "../../ports/second-steps.js";

/** No second step after any way: until a user can set up an authenticator, a sign-in is whole. */
@Injectable()
export class NoSecondSteps extends SecondSteps {
  after(): Promise<SecondStep | undefined> {
    return Promise.resolve(undefined);
  }
}
