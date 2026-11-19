import { DUTIES, Duties, type DutyKey } from "../../people/index.js";

/**
 * Who holds each duty, for tests that stand in for People: its default Role key, hired or not,
 * until a test moves it to another Role or to nobody.
 */
export class DutiesStandIn implements Pick<Duties, "heldBy" | "holders"> {
  private readonly holding = new Map<DutyKey, string | undefined>(
    DUTIES.map((duty) => [duty.key, duty.defaultRoleKey]),
  );

  /** `duty` goes to the Role keyed `roleKey`, or to nobody. */
  set(duty: DutyKey, roleKey: string | undefined): void {
    this.holding.set(duty, roleKey);
  }

  heldBy(roleKey: string): Promise<DutyKey[]> {
    return Promise.resolve(
      DUTIES.filter((duty) => this.holding.get(duty.key) === roleKey).map((duty) => duty.key),
    );
  }

  holders(): Promise<ReadonlyMap<DutyKey, string>> {
    return Promise.resolve(
      new Map(
        [...this.holding].flatMap(([duty, roleKey]) =>
          roleKey === undefined ? [] : [[duty, roleKey] as const],
        ),
      ),
    );
  }
}

/** People's `Duties`, as `standIn` answers it. */
export function dutiesProvider(standIn: DutiesStandIn = new DutiesStandIn()): {
  readonly provide: typeof Duties;
  readonly useValue: DutiesStandIn;
} {
  return { provide: Duties, useValue: standIn };
}
