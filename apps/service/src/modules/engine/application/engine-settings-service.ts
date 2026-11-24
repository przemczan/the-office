import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineAdded, EngineRemoved, WindowStartSettingsChanged } from "../domain/engine-events.js";
import {
  engineRemovalAmong,
  movedStandInList,
  type EngineRemoval,
  type MovedEngineReference,
} from "../domain/engine-removal.js";
import {
  changedEngineSettings,
  settingsWithoutEngine,
  type EngineSettings,
  type EngineSettingsEdit,
} from "../domain/engine-settings.js";
import { EngineSettingsRefused } from "../domain/engine-settings-refused.js";
import {
  hasUsageWindows,
  listsItsModels,
  offeredModels,
  type Engine,
  type EngineId,
} from "../domain/engines.js";
import {
  NO_WINDOW_START,
  sortedWindowStartTimes,
  windowStartTimeProblems,
  type WindowStartSettings,
} from "../domain/window-starts.js";
import { EngineSettingsRepository } from "../ports/engine-settings-repository.js";
import { WindowStartRepository, type KeptWindowStart } from "../ports/window-start-repository.js";
import { EngineModels } from "./engine-models.js";
import { EngineReferenceLock } from "./engine-reference-lock.js";
import { EngineReferenceMoves } from "./engine-reference-moves.js";
import { engineCascadeSettingsOf, EngineSettingsChecks } from "./engine-settings-checks.js";
import { NextWindowStarts } from "./next-window-starts.js";
import { StaleModelLists } from "./stale-model-lists.js";

/**
 * Settings › Engines: the engines, the Office default and the search endpoint, Office-wide.
 * Each session reads them as it starts, so a change applies to the next one.
 */
@Injectable()
export class EngineSettingsService {
  constructor(
    private readonly repository: EngineSettingsRepository,
    private readonly events: EventBus,
    private readonly checks: EngineSettingsChecks,
    private readonly referenceMoves: EngineReferenceMoves,
    private readonly lock: EngineReferenceLock,
    private readonly windowStarts: WindowStartRepository,
    private readonly models: EngineModels,
    private readonly nextStarts: NextWindowStarts,
    private readonly staleModelLists: StaleModelLists,
  ) {}

  /**
   * The settings, each engine offering the models its account last listed; the lists grown stale
   * are asked for again in the background, never waited for.
   */
  async current(): Promise<EngineSettings> {
    const settings = await this.stored();
    this.staleModelLists.refreshInBackground();
    return settings;
  }

  /**
   * The models each engine but an API endpoint offers now (spec §5.4.5, "Models an engine
   * lists"), in the engines' order: those its account listed when last asked, else its type's.
   */
  modelListsOf(settings: EngineSettings): EngineModelChoices[] {
    return this.models
      .listed(settings.engines)
      .filter(({ kind }) => kind !== "openai-compatible-api")
      .map((engine) => ({
        engineId: engine.id,
        models: offeredModels(engine),
        listsItsModels: listsItsModels(engine.kind),
        listedAt: this.models.modelsListedAt(engine.id),
      }));
  }

  /** The stored settings, each engine carrying the models its account last listed. */
  private async stored(): Promise<EngineSettings> {
    const stored = await this.repository.read();
    return { ...stored, engines: this.models.listed(stored.engines) };
  }

  /**
   * What Settings › Engines shows beside `settings`: the Window start of each engine with usage
   * windows, in the engines' order, the defaults for one never set, and the service's time zone,
   * which the set times follow (spec §5.4.6).
   */
  async windowStartsOf(settings: EngineSettings): Promise<EngineWindowStarts> {
    const kept = await this.windowStarts.all();
    const windowStarts = this.models
      .listed(settings.engines)
      .filter(hasUsageWindows)
      .map(({ id }): EngineWindowStart => {
        const { startAtTimes, startAfterReset, last } = kept.find(
          ({ engineId }) => engineId === id,
        ) ?? { ...NO_WINDOW_START, last: undefined };
        return {
          engineId: id,
          startAtTimes,
          startAfterReset,
          last,
          nextStartAt: this.nextStarts.of(id)?.at,
        };
      });
    return { windowStarts, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  /**
   * Keeps the settings `edit` makes, refusing with every reason when they break a rule or a
   * registered check refuses them, and announces each engine added. Held under the
   * `EngineReferenceLock` from the read through the write, so a removal can't come in between.
   */
  async change(edit: EngineSettingsChange): Promise<EngineSettings> {
    const { stored, changed, windowStartsChanged } = await this.lock.holding(() => this.kept(edit));
    for (const { id, kind } of enginesMissingFrom(changed.engines, stored.engines)) {
      await this.events.publish(new EngineAdded(id, kind));
    }
    for (const engineId of windowStartsChanged) {
      await this.events.publish(new WindowStartSettingsChanged(engineId));
    }
    return changed;
  }

  private async kept(edit: EngineSettingsChange): Promise<{
    readonly stored: EngineSettings;
    readonly changed: EngineSettings;
    readonly windowStartsChanged: readonly EngineId[];
  }> {
    // Listed, so a default model is weighed against the models the account offers now.
    const stored = await this.stored();
    const windowStartProblems = this.windowStartProblems(stored, edit.windowStarts ?? []);
    let changed: EngineSettings;
    try {
      changed = changedEngineSettings(stored, edit);
    } catch (error) {
      if (!(error instanceof EngineSettingsRefused)) throw error;
      throw new EngineSettingsRefused([...error.reasons, ...windowStartProblems]);
    }
    const problems = [
      ...(await this.checks.problemsOf({
        before: engineCascadeSettingsOf(stored),
        after: engineCascadeSettingsOf(changed),
      })),
      ...windowStartProblems,
    ];
    if (problems.length > 0) throw new EngineSettingsRefused(problems);
    await this.repository.replace(changed);
    const windowStartsChanged = await this.savedWindowStarts(edit.windowStarts ?? []);
    return { stored, changed, windowStartsChanged };
  }

  /**
   * Why the Window starts of an edit are refused: one on an engine not saved yet or without usage
   * windows, or set times that are malformed, given twice or too many, each named by its engine.
   */
  private windowStartProblems(
    stored: EngineSettings,
    edits: readonly EngineWindowStartEdit[],
  ): string[] {
    const engines = this.models.listed(stored.engines);
    return edits.flatMap(({ engineId, startAtTimes }) => {
      const engine = engines.find(({ id }) => id === engineId);
      if (engine === undefined) {
        return [`There is no saved engine "${engineId}" to start a 5-hour window on.`];
      }
      if (!hasUsageWindows(engine)) {
        return [`${engine.name} has no usage windows, so it can't start its 5-hour window.`];
      }
      return windowStartTimeProblems(startAtTimes).map((problem) => `${engine.name}: ${problem}`);
    });
  }

  /** Keeps each Window start given, its times unique and sorted; the engines whose one changed. */
  private async savedWindowStarts(edits: readonly EngineWindowStartEdit[]): Promise<EngineId[]> {
    const changed: EngineId[] = [];
    for (const { engineId, startAtTimes, startAfterReset } of edits) {
      const settings = { startAtTimes: sortedWindowStartTimes(startAtTimes), startAfterReset };
      const kept = (await this.windowStarts.of(engineId)) ?? NO_WINDOW_START;
      if (sameWindowStart(kept, settings)) continue;
      await this.windowStarts.saveSettings(engineId, settings);
      changed.push(engineId);
    }
    return changed;
  }

  /**
   * Removes the engine `engineId`, moving everything naming it to `replacementId`, or to none when
   * it is the only engine (spec §5.4), and announces it. Refused with every reason, before anything
   * moves, when the removal or the moved levels break a rule or a registered check. The other
   * modules' references move first and the engine goes after: a move failing part way leaves the
   * engine listed and every moved reference on the replacement, also listed, so nothing names an
   * engine that is gone, and removing it again moves the rest. Held under the
   * `EngineReferenceLock` from the read through the engine's removal, so no reference is saved to
   * it meanwhile; announced after, since `EngineAccounts` waits on it in the background.
   */
  async remove(engineId: EngineId, replacementId: EngineId | null): Promise<EngineSettings> {
    const { removed, changed } = await this.lock.holding(() =>
      this.removedWithReferencesMoved(engineId, replacementId),
    );
    if (removed) await this.events.publish(new EngineRemoved(removed.id, removed.kind));
    return changed;
  }

  /**
   * What removing the engine `engineId` with `replacementId` taking over would do, doing nothing:
   * each reference it would move, and the reasons it would be refused, if any. Refused in words
   * like the removal when the engine or the replacement isn't listed.
   */
  async removalPreview(
    engineId: EngineId,
    replacementId: EngineId | null,
  ): Promise<EngineRemovalPreview> {
    const { stored, removal, changed, problems } = await this.plannedRemoval(
      engineId,
      replacementId,
    );
    // Where `settingsWithoutEngine` puts the Office default, as `remove` keeps it.
    const officeDefault: MovedEngineReference[] =
      stored.officeDefault?.engineId === engineId
        ? [
            {
              project: null,
              work: null,
              from: engineId,
              to: changed.officeDefault?.engineId ?? null,
            },
          ]
        : [];
    const officeStandIns = movedStandInList(stored.standInEngines, removal, null);
    return {
      moves: [...officeDefault, ...officeStandIns, ...(await this.referenceMoves.movesOf(removal))],
      problems,
    };
  }

  private async removedWithReferencesMoved(
    engineId: EngineId,
    replacementId: EngineId | null,
  ): Promise<{ readonly removed: Engine | undefined; readonly changed: EngineSettings }> {
    const { stored, removal, changed, problems } = await this.plannedRemoval(
      engineId,
      replacementId,
    );
    if (problems.length > 0) throw new EngineSettingsRefused(problems);
    await this.referenceMoves.moveEach(removal);
    await this.repository.replace(changed);
    return { removed: stored.engines.find(({ id }) => id === engineId), changed };
  }

  /** The removal weighed against the stored settings, shared by `remove` and `removalPreview`. */
  private async plannedRemoval(
    engineId: EngineId,
    replacementId: EngineId | null,
  ): Promise<{
    readonly stored: EngineSettings;
    readonly removal: EngineRemoval;
    readonly changed: EngineSettings;
    readonly problems: readonly string[];
  }> {
    const stored = await this.stored();
    const removal = engineRemovalAmong(stored.engines, engineId, replacementId);
    const changed = settingsWithoutEngine(stored, removal);
    const problems = await this.checks.problemsOf({
      before: engineCascadeSettingsOf(stored),
      after: engineCascadeSettingsOf(changed),
      removal,
    });
    return { stored, removal, changed, problems };
  }
}

/** What a removal would move, and why it would be refused; no reasons when it would go through. */
export interface EngineRemovalPreview {
  readonly moves: readonly MovedEngineReference[];
  readonly problems: readonly string[];
}

/** An engine's Window start settings as a Save of Settings › Engines gives them. */
export interface EngineWindowStartEdit extends WindowStartSettings {
  readonly engineId: EngineId;
}

/** What a Save of Settings › Engines changes; Window starts left out keep the stored ones. */
export interface EngineSettingsChange extends EngineSettingsEdit {
  readonly windowStarts?: readonly EngineWindowStartEdit[];
}

/** The models an engine offers, as Settings › Engines and the Role card pick among them. */
export interface EngineModelChoices {
  readonly engineId: EngineId;
  readonly models: readonly string[];
  /** Whether its account is asked for them (`listsItsModels`). */
  readonly listsItsModels: boolean;
  /** When its account last listed them; undefined while its type's fixed list stands in. */
  readonly listedAt: Date | undefined;
}

/** An engine's Window start as Settings › Engines shows it. */
export interface EngineWindowStart extends KeptWindowStart {
  /** Undefined when neither setting starts one, or no scheduler plans it. */
  readonly nextStartAt: Date | undefined;
}

export interface EngineWindowStarts {
  readonly windowStarts: readonly EngineWindowStart[];
  /** The service's IANA time zone, which the set times follow. */
  readonly timeZone: string;
}

function sameWindowStart(kept: WindowStartSettings, settings: WindowStartSettings): boolean {
  return (
    kept.startAfterReset === settings.startAfterReset &&
    kept.startAtTimes.join(",") === settings.startAtTimes.join(",")
  );
}

/** The engines of `engines` that `others` doesn't list. */
function enginesMissingFrom(engines: readonly Engine[], others: readonly Engine[]): Engine[] {
  const otherIds = new Set(others.map(({ id }) => id));
  return engines.filter(({ id }) => !otherIds.has(id));
}
