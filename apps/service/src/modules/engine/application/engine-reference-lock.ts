import { Injectable } from "@nestjs/common";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";

const ENGINES = "engines";

/**
 * One at a time within this process: removing an engine and every save that reads the engines and
 * writes a reference to one (Settings › Engines, a Role override, a Project's levels), each held
 * over its whole read, check and write. So a save never names an engine removed meanwhile: one
 * that started first is written before the removal moves it, one that comes after reads the
 * engine gone and is refused. One service process is assumed.
 *
 * Taken again inside work that holds it, it runs at once, along the whole async chain. Anything
 * started inside without being awaited (a timer, an event handler's background work) inherits the
 * hold and would later pass straight through, so publish events whose handlers start such work
 * after `holding` returns.
 */
@Injectable()
export class EngineReferenceLock {
  private readonly locks = new KeyedLocks();

  holding<Result>(work: () => Promise<Result>): Promise<Result> {
    return this.locks.run(ENGINES, work);
  }
}
