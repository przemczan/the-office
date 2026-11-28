import { describe, expect, it } from "vitest";
import { addressKeyOf, RequestsPerAddress } from "./requests-per-address.js";

const START = new Date("2026-11-13T09:00:00.000Z");

function after(ms: number): Date {
  return new Date(START.getTime() + ms);
}

describe("RequestsPerAddress", () => {
  it("takes the burst at once, then one more each refill", () => {
    const limit = new RequestsPerAddress(3, 1_000);

    const burst = [1, 2, 3, 4].map(() => limit.take("192.0.2.1", START));

    expect(burst).toEqual([true, true, true, false]);
    expect(limit.take("192.0.2.1", after(999))).toBe(false);
    expect(limit.take("192.0.2.1", after(1_000))).toBe(true);
    expect(limit.take("192.0.2.1", after(1_000))).toBe(false);
  });

  it("keeps each address apart", () => {
    const limit = new RequestsPerAddress(1, 1_000);

    expect(limit.take("192.0.2.1", START)).toBe(true);
    expect(limit.take("192.0.2.2", START)).toBe(true);
    expect(limit.take("192.0.2.1", START)).toBe(false);
  });

  it("counts an IPv6 address by its /64, and an IPv4-mapped one as IPv4", () => {
    const limit = new RequestsPerAddress(1, 1_000);

    expect(limit.take("2001:db8:1:2::1", START)).toBe(true);
    expect(limit.take("2001:db8:1:2:ffff::9", START)).toBe(false);
    expect(limit.take("2001:db8:1:3::1", START)).toBe(true);
    expect(limit.take("::ffff:192.0.2.1", START)).toBe(true);
    expect(limit.take("192.0.2.1", START)).toBe(false);
  });

  it("starts an address full again once its bucket has filled, kept or forgotten", () => {
    const limit = new RequestsPerAddress(2, 1_000);
    limit.take("192.0.2.1", START);
    limit.take("192.0.2.1", START);

    // Filled after 2 s, when a take by anyone forgets it.
    limit.take("192.0.2.2", after(2_000));

    expect([1, 2, 3].map(() => limit.take("192.0.2.1", after(2_000)))).toEqual([true, true, false]);
  });
});

describe("addressKeyOf", () => {
  it.each([
    ["192.0.2.1", "192.0.2.1"],
    ["::ffff:192.0.2.1", "192.0.2.1"],
    ["2001:0db8:0001:0002:0003:0004:0005:0006", "2001:db8:1:2::/64"],
    ["2001:DB8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["64:ff9b:1::192.0.2.1", "64:ff9b:1:0::/64"],
    ["not an address", "not an address"],
  ])("keeps %s as %s", (address, key) => {
    expect(addressKeyOf(address)).toBe(key);
  });
});
