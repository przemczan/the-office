import { describe, expect, it } from "vitest";
import { signingInCeremonyOf } from "../../domain/pending-ceremony.js";
import { InMemoryPendingCeremonies } from "./in-memory-pending-ceremonies.js";

const NOW = new Date("2026-11-13T09:00:00.000Z");
const MINUTE = 60 * 1000;
const RELYING_PARTY = { rpId: "localhost", origin: "http://localhost:4310" };

function ceremonyAt(now: Date, challenge = "challenge") {
  return signingInCeremonyOf(challenge, RELYING_PARTY, now);
}

describe("InMemoryPendingCeremonies", () => {
  it("gives each ceremony once", () => {
    const pending = new InMemoryPendingCeremonies();
    pending.keep("a", ceremonyAt(NOW), NOW);

    expect(pending.take("a")?.challenge).toBe("challenge");
    expect(pending.take("a")).toBeUndefined();
  });

  it("keeps at most its cap, forgetting expired ones first, then the oldest", () => {
    const pending = new InMemoryPendingCeremonies(3);
    pending.keep("expired", ceremonyAt(NOW), NOW);
    const later = new Date(NOW.getTime() + 6 * MINUTE);
    pending.keep("oldest", ceremonyAt(later), later);
    pending.keep("older", ceremonyAt(later), later);

    pending.keep("new", ceremonyAt(later), later);
    expect(pending.take("expired")).toBeUndefined();
    expect(pending.take("oldest")).toBeDefined();

    pending.keep("again", ceremonyAt(later), later);
    pending.keep("one more", ceremonyAt(later), later);
    expect(pending.take("older")).toBeUndefined();
    expect(["new", "again", "one more"].map((key) => pending.take(key) !== undefined)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("keeps one ceremony under a key, the latest", () => {
    const pending = new InMemoryPendingCeremonies();
    pending.keep("device", ceremonyAt(NOW, "first"), NOW);
    pending.keep("device", ceremonyAt(NOW, "second"), NOW);

    expect(pending.take("device")?.challenge).toBe("second");
  });
});
