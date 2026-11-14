import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { googleClientOf, type GoogleClientEntry } from "../domain/google-client.js";
import { GoogleClientRemoved, GoogleClientSaved } from "../domain/user-events.js";
import { UserRefused } from "../domain/user-refused.js";
import { GoogleClientRepository } from "../ports/google-client-repository.js";

/** The saved client as the web sees it: its id, and whether a secret is kept, never the secret. */
export interface GoogleClientShown {
  readonly clientId: string;
  readonly secretSet: boolean;
}

/**
 * The Google OAuth client, from Settings › Signing in (spec §2.10): one per Office, which any user
 * saves, changes or removes. Removing it keeps the linked Google identities, since Google's `sub`
 * doesn't depend on the client: they sign in again once a client is saved.
 */
@Injectable()
export class GoogleClients {
  constructor(
    private readonly clients: GoogleClientRepository,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  async shown(): Promise<GoogleClientShown | undefined> {
    const client = await this.clients.find();
    return client && { clientId: client.clientId, secretSet: client.clientSecret !== "" };
  }

  /** Saves it; an empty secret keeps the one saved. Throws `UserRefused` with every problem. */
  async save(userId: string, entry: GoogleClientEntry): Promise<GoogleClientShown> {
    const saved = await this.clients.find();
    const made = googleClientOf(entry, saved, this.schedule.now());
    if ("problems" in made) throw new UserRefused(made.problems);
    await this.clients.save(made.client);
    await this.eventBus.publish(
      new GoogleClientSaved(userId, made.client.clientId, made.client.savedAt),
    );
    return { clientId: made.client.clientId, secretSet: true };
  }

  async remove(userId: string): Promise<void> {
    if (await this.clients.remove()) await this.eventBus.publish(new GoogleClientRemoved(userId));
  }
}
