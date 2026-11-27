import { Injectable, Module } from "@nestjs/common";
import { KnownPeople, type KnownPerson } from "./known-people.js";

/** People a test hires by setting `people`, keyed by their Role. */
@Injectable()
export class KnownPeopleForTests extends KnownPeople {
  readonly people = new Map<string, KnownPerson>();

  async find(roleKey: string): Promise<KnownPerson | undefined> {
    return this.people.get(roleKey);
  }
}

/** Gives `KnownPeopleForTests` to a test's Run environments module. */
@Module({ providers: [KnownPeopleForTests], exports: [KnownPeopleForTests] })
export class KnownPeopleForTestsModule {}
