import { isPending, type PendingCeremony } from "../../domain/pending-ceremony.js";
import { PendingCeremonies } from "../../ports/pending-ceremonies.js";

/**
 * At most this many ceremonies are kept: starting a passkey sign-in needs no sign-in, so anyone
 * can start them. Each is a challenge and a few names, so the cap costs little memory.
 */
export const PENDING_CEREMONIES_CAP = 1000;

/**
 * Pending ceremonies in memory, lost at a restart, which only means starting again. Past the cap,
 * expired ones go first, then the oldest.
 */
export class InMemoryPendingCeremonies extends PendingCeremonies {
  // A Map keeps its insertion order, so its first key is the oldest kept.
  private readonly ceremonies = new Map<string, PendingCeremony>();

  constructor(private readonly cap: number = PENDING_CEREMONIES_CAP) {
    super();
  }

  keep(key: string, ceremony: PendingCeremony, now: Date): void {
    this.ceremonies.delete(key);
    if (this.ceremonies.size >= this.cap) this.forgetExpired(now);
    while (this.ceremonies.size >= this.cap) {
      const [oldest] = this.ceremonies.keys();
      if (oldest === undefined) break;
      this.ceremonies.delete(oldest);
    }
    this.ceremonies.set(key, ceremony);
  }

  take(key: string): PendingCeremony | undefined {
    const ceremony = this.ceremonies.get(key);
    this.ceremonies.delete(key);
    return ceremony;
  }

  private forgetExpired(now: Date): void {
    for (const [key, ceremony] of this.ceremonies) {
      if (!isPending(ceremony, now)) this.ceremonies.delete(key);
    }
  }
}
