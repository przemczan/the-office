import type {
  Passkey as PasskeyMessage,
  PasskeyAuthentication,
  PasskeyRegistration,
} from "@the-office/contracts";
import type { PageAddress } from "../../domain/page-address.js";
import type { Passkey } from "../../domain/passkey.js";
import { passkeyAt } from "../../domain/relying-party.js";
import type { CeremonyAnswer } from "../../ports/passkey-ceremonies.js";

/** The browser's answer as the ceremonies take it. */
export function ceremonyAnswerOf(
  answer: PasskeyRegistration | PasskeyAuthentication,
): CeremonyAnswer {
  return {
    credentialId: answer.id,
    userHandle: "userHandle" in answer.response ? answer.response.userHandle : undefined,
    json: answer,
  };
}

/** A passkey as the account lists it, with where it works told against the page's address. */
export function passkeyMessageOf(passkey: Passkey, page: PageAddress): PasskeyMessage {
  return {
    id: passkey.id,
    name: passkey.name,
    rpId: passkey.rpId,
    ...passkeyAt(passkey.rpId, page),
    createdAt: passkey.createdAt.toISOString(),
    lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
  };
}
