import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import {
  EngineAccountChanged,
  EngineAdded,
  EngineModelsListed,
  EngineRemoved,
} from "../domain/engine-events.js";
import { EngineRefused } from "../domain/engine-refused.js";
import { listsItsModels, type Engine, type EngineId } from "../domain/engines.js";
import {
  MODEL_LIST_ASK_GAP_MS,
  modelListIsStale,
  type EngineModelList,
} from "../domain/model-lists.js";
import { ModelListRepository } from "../ports/model-list-repository.js";
import { AgentEngines } from "./agent-engines.js";
import { EngineModels } from "./engine-models.js";
import { StaleModelLists } from "./stale-model-lists.js";

/**
 * How long after a session refused for its model the engine's list isn't asked for again on the
 * next refusal: the sessions of one Stage or Thread retrying are one burst, one ask answers them.
 */
export const MODEL_REFUSAL_REFRESH_GAP_MS = 5 * 60 * 1000;

/** What asking an engine's account for its models came to. */
export type ModelListRefresh =
  /** It listed them, and they are kept. */
  | { readonly outcome: "listed"; readonly models: readonly string[] }
  /** It answered none, so the list kept before, or the type's fixed one, stands. */
  | { readonly outcome: "none-listed" }
  /** Asking failed or timed out, in the error's words; the list kept before stands. */
  | { readonly outcome: "failed"; readonly engine: Engine; readonly error: string }
  /** Settings › Engines lists no engine by that id. */
  | { readonly outcome: "not-listed" }
  /** The engine's type offers a list of its own and isn't asked (`listsItsModels`). */
  | { readonly outcome: "lists-none"; readonly engine: Engine };

/**
 * The models each engine's account offers (spec §5.4.5, "Models an engine lists"): asked of the
 * account with no session and no model call, kept per engine (`ModelListRepository`) and made the
 * engine's `offeredModels` (`EngineModels.recordModelList`). The kept lists are read as the service
 * starts; each grown stale is then asked for again in the background, one engine at a time, and
 * whenever the models are shown (`refreshStale`). An engine added, or whose account changed, is
 * asked at once; a removed one's list is forgotten. A failed or empty answer keeps the list kept,
 * so the choices never empty. Asking never holds up showing the list. A test instance of The
 * Office (`OFFICE_TEST_INSTANCE`) asks nothing, and a refresh asked of it is refused with
 * EngineRefused.
 */
@Injectable()
export class EngineModelLists implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EngineModelLists.name);
  /** Ends an ask under way as the service stops. */
  private readonly stopping = new AbortController();
  /** Each engine's kept list, as `recordModelList` was given it. */
  private readonly kept = new Map<EngineId, EngineModelList>();
  /** The ask under way of each engine, which a second refresh shares. */
  private readonly asking = new Map<EngineId, Promise<ModelListRefresh>>();
  /** The work started in the background, which `settled` waits for. */
  private readonly background = new Set<Promise<void>>();
  /** The stale lists' refresh under way, so a second one is not started meanwhile. */
  private sweeping: Promise<void> | undefined;
  /** When each engine was last asked again for a session refused for its model. */
  private readonly refusalAskedAt = new Map<EngineId, number>();
  /** When each engine was last asked, whatever it answered, which `refreshStale` leaves be a while. */
  private readonly askedAt = new Map<EngineId, number>();

  constructor(
    private readonly engines: AgentEngines,
    private readonly engineModels: EngineModels,
    private readonly repository: ModelListRepository,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
    private readonly staleLists: StaleModelLists,
    @Optional() private readonly testInstance: OfficeTestInstance = OfficeTestInstance.OFF,
  ) {}

  onModuleInit(): void {
    this.staleLists.registerRefresh(() => this.refreshStale());
    // In the background: the bus waits for its handlers, and the Save for nothing.
    this.events.subscribe(EngineAdded, ({ engineId }) => this.refreshInBackground(engineId));
    this.events.subscribe(EngineAccountChanged, ({ engineId }) =>
      // The account decides the list: an ask begun before the change answers for the one before.
      this.inBackground(`Listing the models of the engine ${engineId} failed.`, async () => {
        await this.asking.get(engineId);
        await this.askUnlessTestInstance(engineId);
      }),
    );
    this.events.subscribe(EngineRemoved, ({ engineId }) => this.forget(engineId));
  }

  /** After every module is up, so whoever listens to a list hears the first. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      for (const list of await this.repository.all()) this.record(list);
    } catch (error) {
      this.logger.warn(`Reading the kept model lists failed: ${messageOf(error)}`);
    }
    this.refreshStale();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping.abort(new Error("The service is stopping."));
    await this.settled();
  }

  /**
   * Asks the engine listed as `engineId` for its models and keeps them, sharing an ask already
   * under way; what it came to, never throwing for the engine's failure.
   */
  refresh(engineId: EngineId): Promise<ModelListRefresh> {
    if (this.testInstance.on) return Promise.reject(new EngineRefused());
    const underWay = this.asking.get(engineId);
    if (underWay !== undefined) return underWay;
    const ask = this.ask(engineId).finally(() => this.asking.delete(engineId));
    this.asking.set(engineId, ask);
    return ask;
  }

  /**
   * Starts asking, in the background and one engine at a time, each listed engine whose list is
   * missing or older than `MODEL_LIST_REFRESH_AGE_MS`, but one asked within `MODEL_LIST_ASK_GAP_MS`;
   * never waits for them, and never throws.
   */
  refreshStale(): void {
    if (this.testInstance.on || this.stopping.signal.aborted || this.sweeping) return;
    this.sweeping = this.inBackground("Listing the engines' stale models failed.", async () => {
      try {
        for (const engine of await this.engineModels.engines()) {
          if (this.stopping.signal.aborted) return;
          if (!listsItsModels(engine.kind)) continue;
          if (!modelListIsStale(this.kept.get(engine.id), this.schedule.now())) continue;
          if (this.askedWithinGap(engine.id)) continue;
          await this.refresh(engine.id);
        }
      } finally {
        this.sweeping = undefined;
      }
    });
  }

  /**
   * A session on the engine listed as `engineId` was refused for its model, which the kept list
   * may still offer though the account no longer does: asks for the list again in the background,
   * once for a burst of refusals (`MODEL_REFUSAL_REFRESH_GAP_MS`).
   */
  modelRefused(engineId: EngineId): void {
    if (this.testInstance.on || this.stopping.signal.aborted) return;
    const now = this.schedule.now().getTime();
    const askedAt = this.refusalAskedAt.get(engineId);
    if (askedAt !== undefined && now - askedAt < MODEL_REFUSAL_REFRESH_GAP_MS) return;
    this.refusalAskedAt.set(engineId, now);
    this.refreshInBackground(engineId);
  }

  /** Waits for the asks going on in the background, for a test and as the service stops. */
  async settled(): Promise<void> {
    while (this.background.size > 0) await Promise.all(this.background);
  }

  private refreshInBackground(engineId: EngineId): void {
    this.inBackground(`Listing the models of the engine ${engineId} failed.`, () =>
      this.askUnlessTestInstance(engineId),
    );
  }

  private async askUnlessTestInstance(engineId: EngineId): Promise<void> {
    if (this.testInstance.on || this.stopping.signal.aborted) return;
    await this.refresh(engineId);
  }

  private async ask(engineId: EngineId): Promise<ModelListRefresh> {
    const engine = await this.listed(engineId);
    if (engine === undefined) return { outcome: "not-listed" };
    if (!listsItsModels(engine.kind)) return { outcome: "lists-none", engine };
    this.askedAt.set(engineId, this.schedule.now().getTime());
    let models: readonly string[] | undefined;
    try {
      models = await this.engines.of(engine).listModels(engine, this.stopping.signal);
    } catch (error) {
      this.logger.warn(`Listing the models of the engine ${engine.id} failed: ${messageOf(error)}`);
      return { outcome: "failed", engine, error: messageOf(error) };
    }
    const listedModels = [...new Set(models ?? [])];
    if (listedModels.length === 0) return { outcome: "none-listed" };
    // Removed while it was asked: nothing is kept of it.
    if ((await this.listed(engineId)) === undefined) return { outcome: "not-listed" };
    const list: EngineModelList = { engineId, models: listedModels, listedAt: this.schedule.now() };
    try {
      await this.repository.save(list);
    } catch (error) {
      this.logger.warn(`Keeping the models of the engine ${engine.id} failed: ${messageOf(error)}`);
      return { outcome: "failed", engine, error: messageOf(error) };
    }
    this.record(list);
    await this.events.publish(new EngineModelsListed(engineId));
    return { outcome: "listed", models: listedModels };
  }

  private async listed(engineId: EngineId): Promise<Engine | undefined> {
    return (await this.engineModels.engines()).find(({ id }) => id === engineId);
  }

  private askedWithinGap(engineId: EngineId): boolean {
    const askedAt = this.askedAt.get(engineId);
    return askedAt !== undefined && this.schedule.now().getTime() - askedAt < MODEL_LIST_ASK_GAP_MS;
  }

  private record(list: EngineModelList): void {
    this.kept.set(list.engineId, list);
    this.engineModels.recordModelList(list.engineId, list.models, list.listedAt);
  }

  private async forget(engineId: EngineId): Promise<void> {
    this.kept.delete(engineId);
    this.refusalAskedAt.delete(engineId);
    this.askedAt.delete(engineId);
    this.engineModels.recordModelList(engineId, undefined);
    await this.repository.remove(engineId);
  }

  /** Runs `work` in the background, logging `failure` should it throw. */
  private inBackground(failure: string, work: () => Promise<void>): Promise<void> {
    const running = work()
      .catch((error: unknown) => this.logger.warn(`${failure} ${messageOf(error)}`))
      .finally(() => this.background.delete(running));
    this.background.add(running);
    return running;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
