import { isIPv6 } from "node:net";

interface Bucket {
  readonly tokens: number;
  readonly at: number;
}

/**
 * A token bucket per client address, in memory: `burst` requests at once, then one more every
 * `refillEveryMs`. An address whose bucket has filled again is forgotten, so the addresses kept are
 * only those seen within `burst × refillEveryMs`. An IPv6 address counts by its /64, which one
 * client holds whole.
 */
export class RequestsPerAddress {
  // A Map keeps its insertion order: each take moves its address last, so the first are the least
  // recently seen.
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly burst: number,
    private readonly refillEveryMs: number,
  ) {}

  /** Takes one request for the address; false when its bucket is empty. */
  take(address: string, now: Date): boolean {
    const at = now.getTime();
    this.forgetFilled(at);
    const key = addressKeyOf(address);
    const kept = this.buckets.get(key);
    const tokens =
      kept === undefined
        ? this.burst
        : Math.min(this.burst, kept.tokens + Math.max(0, at - kept.at) / this.refillEveryMs);
    const taken = tokens >= 1;
    this.buckets.delete(key);
    this.buckets.set(key, { tokens: taken ? tokens - 1 : tokens, at });
    return taken;
  }

  private forgetFilled(at: number): void {
    const filledWithin = this.burst * this.refillEveryMs;
    for (const [key, bucket] of this.buckets) {
      if (at - bucket.at < filledWithin) break;
      this.buckets.delete(key);
    }
  }
}

/** The address a bucket is kept for: an IPv4 address whole, an IPv6 one by its first 64 bits. */
export function addressKeyOf(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped?.[1] !== undefined) return mapped[1];
  const withoutZone = address.split("%", 1)[0] ?? address;
  if (!isIPv6(withoutZone)) return address;
  return `${ipv6Groups(withoutZone).slice(0, 4).join(":")}::/64`;
}

/** The eight groups of an IPv6 address, `::` filled in, each without leading zeros. */
function ipv6Groups(address: string): string[] {
  const [head = "", tail] = address.toLowerCase().split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined || tail === "" ? [] : tail.split(":");
  // An IPv4 tail, as in 64:ff9b::192.0.2.1, holds two groups.
  const tailLength = tailGroups.length + (tailGroups.at(-1)?.includes(".") === true ? 1 : 0);
  const filled =
    tail === undefined ? [] : Array<string>(8 - headGroups.length - tailLength).fill("0");
  return [...headGroups, ...filled, ...tailGroups].map((group) => group.replace(/^0+(?=.)/, ""));
}
