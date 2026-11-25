import { describe, expect, it } from "vitest";
import type { InterfaceAddress } from "../../ports/workstation-addresses.js";
import { addressedToProxy, reachableHostnames } from "./proxy-hosts.js";

const INTERFACES: readonly InterfaceAddress[] = [
  { address: "127.0.0.1", family: "IPv4", internal: true },
  { address: "::1", family: "IPv6", internal: true },
  { address: "192.168.1.20", family: "IPv4", internal: false },
  { address: "10.8.0.2", family: "IPv4", internal: false },
  { address: "2001:db8::20", family: "IPv6", internal: false },
  { address: "fe80::1", family: "IPv6", internal: false },
];

function reachable(officeHost: string, pageHostname = "localhost"): string[] {
  return reachableHostnames({ officeHost, pageHostname, interfaces: INTERFACES });
}

describe("reachableHostnames", () => {
  it("offers localhost and each IPv4 network address when the proxy listens on every IPv4 address", () => {
    expect(reachable("0.0.0.0")).toEqual(["localhost", "192.168.1.20", "10.8.0.2"]);
  });

  it("offers the IPv6 network addresses too on ::, never a link-local one", () => {
    expect(reachable("::")).toEqual(["localhost", "192.168.1.20", "10.8.0.2", "[2001:db8::20]"]);
  });

  it("offers only localhost when the proxy listens on loopback", () => {
    expect(reachable("127.0.0.1")).toEqual(["localhost"]);
    expect(reachable("::1")).toEqual(["localhost"]);
  });

  it("offers only OFFICE_HOST when the proxy listens on one address", () => {
    expect(reachable("192.168.1.20", "192.168.1.20")).toEqual(["192.168.1.20"]);
  });

  it("puts the page's own address first, once", () => {
    expect(reachable("0.0.0.0", "10.8.0.2")).toEqual(["10.8.0.2", "localhost", "192.168.1.20"]);
    expect(reachable("127.0.0.1", "office.example.com")).toEqual([
      "office.example.com",
      "localhost",
    ]);
  });

  it("offers only hostnames the proxy lets through", () => {
    for (const hostname of reachable("0.0.0.0")) {
      const localAddress = hostname === "localhost" ? "127.0.0.1" : hostname;
      expect(
        addressedToProxy(`${hostname}:4400`, { officeHost: "0.0.0.0", localAddress, port: 4400 }),
      ).toBe(true);
    }
  });
});

describe("addressedToProxy", () => {
  it("lets the public address's name through, and no other name", () => {
    const at = { officeHost: "0.0.0.0", localAddress: "192.168.1.20", port: 4400 };

    expect(
      addressedToProxy("Office.Example.com:4400", { ...at, publicHostname: "office.example.com" }),
    ).toBe(true);
    expect(addressedToProxy("office.example.com:4400", at)).toBe(false);
    expect(
      addressedToProxy("rebound.example.com:4400", { ...at, publicHostname: "office.example.com" }),
    ).toBe(false);
  });
});
