import type { Engine } from "../domain/engines.js";
import type { AgentEngine } from "../ports/agent-engine.js";

/** An adapter per engine a Role may pick (spec §5.4); the module binds one to each id. */
export class AgentEngines {
  constructor(private readonly engines: Readonly<Record<Engine, AgentEngine>>) {}

  of(engine: Engine): AgentEngine {
    return this.engines[engine];
  }
}
