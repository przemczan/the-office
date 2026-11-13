import { Injectable } from "@nestjs/common";
import type { AddressKind } from "../domain/address-kind.js";
import { PASSWORD_WAY, type SignInWay, type SignInWayKind } from "../domain/sign-in-way.js";

/**
 * The ways to sign in The Office offers, a registry each way's module fills as it starts (spec
 * §2.10): the sign-in page lists only those set up that work at the address it was opened at.
 */
@Injectable()
export class SignInWays {
  private readonly ways: SignInWay[] = [PASSWORD_WAY];

  add(way: SignInWay): void {
    this.ways.push(way);
  }

  async at(addressKind: AddressKind): Promise<readonly SignInWayKind[]> {
    const offered = await Promise.all(
      this.ways.map(async (way) => way.worksAt(addressKind) && (await way.isAvailable())),
    );
    return this.ways.filter((_, index) => offered[index]).map((way) => way.kind);
  }
}
