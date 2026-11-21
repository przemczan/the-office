/**
 * An Android phone over wireless debugging's address (spec §2.13, "Android phone over wireless
 * debugging"): an IP literal adb in the run environment reaches it at, never a name, since mDNS
 * doesn't cross the run environment's network.
 */
export interface WirelessAddress {
  /** IPv4 as written, IPv6 in its shortest lower-case form, so one phone has one device key. */
  readonly address: string;
  readonly family: 4 | 6;
}

const ENTER_THE_PHONES_ADDRESS = "Enter the address its Wireless debugging screen shows.";

/** The address, or why the run environment can't reach a phone there, in the UI's words. */
export function wirelessAddressOf(
  given: string,
): { readonly address: WirelessAddress } | { readonly problem: string } {
  const written = given.trim();
  const ipv4 = ipv4Octets(written);
  if (ipv4 !== undefined) {
    const problem = ipv4ProblemOf(written, ipv4);
    return problem === undefined ? { address: { address: written, family: 4 } } : { problem };
  }
  const ipv6 = canonicalIpv6(written);
  if (ipv6 === undefined) {
    return { problem: `«${written}» isn't an IP address. ${ENTER_THE_PHONES_ADDRESS}` };
  }
  const problem = ipv6ProblemOf(ipv6);
  return problem === undefined ? { address: { address: ipv6, family: 6 } } : { problem };
}

/**
 * What a phone over wireless debugging is recognised by: its address alone, since its port
 * changes each time wireless debugging is turned off and on.
 */
export function wirelessDeviceKeyOf(address: WirelessAddress): string {
  return `android-wireless:${address.address}`;
}

/** `<address>:<port>`, the address in brackets for IPv6: how adb names the phone. */
export function adbSerialAt(address: WirelessAddress, port: number): string {
  return address.family === 6 ? `[${address.address}]:${port}` : `${address.address}:${port}`;
}

function ipv4Octets(written: string): readonly number[] | undefined {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(written);
  if (parts === null) return undefined;
  const octets = parts.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

function ipv4ProblemOf(
  written: string,
  [first = 0, second = 0]: readonly number[],
): string | undefined {
  if (first === 127) return loopback(written);
  if (first === 0) return unspecified(written);
  if (first >= 224 && first <= 239) return multicast(written);
  if (first === 169 && second === 254) return linkLocal(written);
  return undefined;
}

function ipv6ProblemOf(address: string): string | undefined {
  // An IPv4-mapped address reaches the IPv4 one, so it is weighed as that.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mapped !== null) {
    const high = Number.parseInt(mapped[1] ?? "0", 16);
    const low = Number.parseInt(mapped[2] ?? "0", 16);
    return ipv4ProblemOf(address, [high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  if (address === "::1") return loopback(address);
  if (address === "::") return unspecified(address);
  const first = address.startsWith("::") ? 0 : Number.parseInt(address.split(":")[0] ?? "0", 16);
  if (first >= 0xff00) return multicast(address);
  if ((first & 0xffc0) === 0xfe80) return linkLocal(address);
  return undefined;
}

/** The shortest lower-case form, as the WHATWG URL parser writes it; undefined if it isn't IPv6. */
function canonicalIpv6(written: string): string | undefined {
  if (!written.includes(":") || /[[\]/%]/.test(written)) return undefined;
  try {
    return new URL(`http://[${written}]/`).hostname.slice(1, -1);
  } catch {
    return undefined;
  }
}

function loopback(address: string): string {
  return `«${address}» is a loopback address: in the run environment it reaches the run environment itself, not the phone. ${ENTER_THE_PHONES_ADDRESS}`;
}

function unspecified(address: string): string {
  return `«${address}» names no device. ${ENTER_THE_PHONES_ADDRESS}`;
}

function multicast(address: string): string {
  return `«${address}» is a multicast address, not one phone's. ${ENTER_THE_PHONES_ADDRESS}`;
}

function linkLocal(address: string): string {
  return `«${address}» is a link-local address, which the run environment can't reach. ${ENTER_THE_PHONES_ADDRESS}`;
}
