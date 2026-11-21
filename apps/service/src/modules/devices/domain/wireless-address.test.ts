import { describe, expect, it } from "vitest";
import { adbSerialAt, wirelessAddressOf, wirelessDeviceKeyOf } from "./wireless-address.js";

function addressOf(given: string) {
  const reading = wirelessAddressOf(given);
  if ("problem" in reading) throw new Error(reading.problem);
  return reading.address;
}

function problemOf(given: string): string | undefined {
  const reading = wirelessAddressOf(given);
  return "problem" in reading ? reading.problem : undefined;
}

describe("wirelessAddressOf", () => {
  it("takes a phone's IPv4 and IPv6 addresses on the network, IPv6 in its shortest form", () => {
    expect(addressOf("192.168.1.20")).toEqual({ address: "192.168.1.20", family: 4 });
    expect(addressOf(" 10.0.0.7 ")).toEqual({ address: "10.0.0.7", family: 4 });
    expect(addressOf("2001:DB8:0:0:0:0:0:20")).toEqual({ address: "2001:db8::20", family: 6 });
    expect(addressOf("fd12:3456::1")).toEqual({ address: "fd12:3456::1", family: 6 });
  });

  it.each([
    ["127.0.0.1", "loopback"],
    ["127.4.5.6", "loopback"],
    ["::1", "loopback"],
    ["::ffff:127.0.0.1", "loopback"],
    ["0.0.0.0", "names no device"],
    ["::", "names no device"],
    ["224.0.0.251", "multicast"],
    ["239.255.255.250", "multicast"],
    ["ff02::fb", "multicast"],
    ["169.254.10.20", "link-local"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local"],
  ])("refuses %s in words (%s)", (given, words) => {
    const problem = problemOf(given);
    expect(problem).toContain(words);
    expect(problem).toContain("Wireless debugging screen");
  });

  it("refuses what isn't an IP address", () => {
    expect(problemOf("pixel.local")).toBe(
      "«pixel.local» isn't an IP address. Enter the address its Wireless debugging screen shows.",
    );
    expect(problemOf("192.168.1.300")).toContain("isn't an IP address");
    expect(problemOf("[2001:db8::1]")).toContain("isn't an IP address");
  });
});

describe("the device key and the adb serial", () => {
  it("keys the phone by its address alone, as its port changes", () => {
    expect(wirelessDeviceKeyOf(addressOf("192.168.1.20"))).toBe("android-wireless:192.168.1.20");
    expect(wirelessDeviceKeyOf(addressOf("2001:DB8::20"))).toBe("android-wireless:2001:db8::20");
  });

  it("names the phone as adb does, IPv6 in brackets", () => {
    expect(adbSerialAt(addressOf("192.168.1.20"), 41_234)).toBe("192.168.1.20:41234");
    expect(adbSerialAt(addressOf("2001:db8::20"), 41_234)).toBe("[2001:db8::20]:41234");
  });
});
