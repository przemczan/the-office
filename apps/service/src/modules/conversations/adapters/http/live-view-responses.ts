import type {
  LiveAgent as LiveAgentResponse,
  LiveConsulting as LiveConsultingResponse,
  LivePerson as LivePersonResponse,
  LiveView as LiveViewResponse,
  LiveWaitingOnYou as LiveWaitingOnYouResponse,
} from "@the-office/contracts";
import type {
  LiveAgent,
  LiveConsulting,
  LivePerson,
  LiveView,
  LiveWaitingOnYou,
} from "../../domain/live-view.js";

export function toLiveViewResponse({ people }: LiveView): LiveViewResponse {
  return { people: people.map(toLivePersonResponse) };
}

function toLivePersonResponse(person: LivePerson): LivePersonResponse {
  return {
    roleKey: person.roleKey,
    name: person.name,
    title: person.title,
    state: person.state,
    agents: person.agents.map(toLiveAgentResponse),
    consulting: person.consulting.map(toLiveConsultingResponse),
    waitingOnYou: person.waitingOnYou.map(toLiveWaitingOnYouResponse),
    idleSince: person.idleSince?.toISOString() ?? null,
  };
}

function toLiveAgentResponse({
  threadId,
  home,
  kind,
  consultation,
  engine,
}: LiveAgent): LiveAgentResponse {
  return {
    threadId,
    home,
    kind,
    consultation: consultation
      ? { decisionId: consultation.decisionId, askerRoleKey: consultation.askerRoleKey ?? null }
      : null,
    engine: engine
      ? {
          engineId: engine.engineId,
          engineName: engine.engineName,
          standInFor: engine.standInFor
            ? {
                engineId: engine.standInFor.engineId,
                engineName: engine.standInFor.engineName,
                reason: engine.standInFor.reason,
              }
            : null,
        }
      : null,
  };
}

function toLiveConsultingResponse(consulting: LiveConsulting): LiveConsultingResponse {
  return { ...consulting, since: consulting.since.toISOString() };
}

function toLiveWaitingOnYouResponse(waiting: LiveWaitingOnYou): LiveWaitingOnYouResponse {
  return { ...waiting, since: waiting.since.toISOString() };
}
