import { Injectable } from "@nestjs/common";
import type { PageAddress } from "../domain/page-address.js";
import {
  PASSKEY_WAY,
  PASSWORD_WAY,
  type SignInWay,
  type SignInWayKind,
  type WayUnavailable,
} from "../domain/sign-in-way.js";

/** A way the page offers, with the name its button shows when it has one of its own. */
export interface OfferedWay {
  readonly kind: SignInWayKind;
  readonly name: string | undefined;
}

/** A way set up that doesn't work at the page's address, with why. */
export interface UnavailableWay extends WayUnavailable {
  readonly kind: SignInWayKind;
}

/** The ways a page at an address offers, and those set up that it can't, each with why. */
export interface WaysAt {
  readonly ways: readonly OfferedWay[];
  readonly unavailable: readonly UnavailableWay[];
}

/**
 * The ways to sign in The Office offers, a registry each way's module fills as it starts (spec
 * §2.10): the sign-in page lists those set up that work at the address it was opened at, and says
 * why the others don't.
 */
@Injectable()
export class SignInWays {
  private readonly ways: SignInWay[] = [PASSWORD_WAY, PASSKEY_WAY];

  add(way: SignInWay): void {
    this.ways.push(way);
  }

  async at(page: PageAddress): Promise<WaysAt> {
    const available = await Promise.all(this.ways.map((way) => way.isAvailable()));
    const setUp = this.ways.filter((_, index) => available[index]);
    const offered: OfferedWay[] = [];
    const unavailable: UnavailableWay[] = [];
    for (const way of setUp) {
      const why = way.unavailableAt(page);
      if (why === undefined) offered.push({ kind: way.kind, name: await way.name?.() });
      else unavailable.push({ kind: way.kind, ...why });
    }
    return { ways: offered, unavailable };
  }
}
