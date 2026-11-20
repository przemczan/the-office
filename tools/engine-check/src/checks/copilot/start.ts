import type { Check } from "../../check.ts";
import { eventKinds, eventsOfType } from "../../copilot-cli/events.ts";
import { COPILOT_CHECK_MODEL } from "../../copilot-cli/options.ts";
import { pinnedCopilot } from "../../copilot-cli/pinned-copilot.ts";
import { answerHolds } from "./helpers.ts";

/**
 * The route: the pinned SDK starts its bundled runtime over stdio on the check's folder, signed in
 * with the token, and a session on the check model streams a turn's events.
 */
export const copilotStartCheck: Check = {
  id: "copilot.start",
  title:
    "the pinned SDK starts its bundled runtime, signed in with the token, and a session streams a turn",
  async run({ sandbox, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    const session = await startCopilotSession({ repository });
    const status = await session.client.getStatus();
    const auth = await session.client.getAuthStatus();
    const models = await session.client.listModels();
    const events = await session.turn("Reply with the single word READY and nothing else.");
    const start = eventsOfType(session.events, "session.start")[0];
    return {
      runtimeMatchesPin: status.version === pinnedCopilot().runtime,
      startEventNamesRuntime: start?.data.copilotVersion === pinnedCopilot().runtime,
      authenticated: auth.isAuthenticated,
      authType: auth.authType ?? "none",
      checkModelListed: models.some((model) => model.id === COPILOT_CHECK_MODEL),
      sessionIdIsUuid: /^[0-9a-f-]{36}$/u.test(session.sessionId),
      usageModel: eventsOfType(events, "assistant.usage")[0]?.data.model ?? "none",
      streamedDeltas: events.some((event) => event.type === "assistant.message_delta"),
      answered: answerHolds(events, "READY"),
      eventKinds: eventKinds(session.events),
    };
  },
};
