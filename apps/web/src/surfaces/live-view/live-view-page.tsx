import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Alert, Button, Icon, IconButton } from "@the-office/ui";
import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { liveViewQueries } from "../../api/live-view.ts";
import { roleQueries } from "../../api/people.ts";
import { initiativeQueries, taskQueries } from "../../api/work.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { useClock } from "../../shell/use-clock.ts";
import { useNarrowPage } from "../../shell/use-narrow-page.ts";
import { lightAt } from "./light.ts";
import { lookStatesOf, summaryWords } from "./live-states.ts";
import type { OfficePerson, OfficeStage, StageView } from "./live-view-types.ts";
import { Nameplates } from "./nameplate.tsx";
import { officePeopleOf, personNamesOf, recordTitlesOf, shownPeopleOf } from "./office-people.ts";
import { PeopleList } from "./people-list.tsx";
import { directLinkOf } from "./press-words.ts";
import { useNoHover, useReducedMotion } from "./use-reduced-motion.ts";
import { workLinkOptions } from "./work-links.tsx";
import "./live-view.css";

const MINUTE_MS = 60_000;
const NOBODY: readonly OfficePerson[] = [];

/** The Live view (docs/design/live-view.html): who is doing what, drawn as an office. */
export function LiveViewPage(): ReactNode {
  const snapshot = useQuery(liveViewQueries.snapshot());
  const roles = useQuery(roleQueries.list());
  const tasks = useQuery(taskQueries.list());
  const initiatives = useQuery(initiativeQueries.list());
  // Asleep and "New" turn on the minute.
  const now = useClock(MINUTE_MS);
  const narrow = useNarrowPage();
  const noHover = useNoHover();
  const navigate = useNavigate();

  const people = useMemo(
    () => (snapshot.data && roles.data ? officePeopleOf(snapshot.data, roles.data) : NOBODY),
    [snapshot.data, roles.data],
  );
  const titles = useMemo(
    () => recordTitlesOf(tasks.data, initiatives.data),
    [tasks.data, initiatives.data],
  );
  const names = useMemo(() => personNamesOf(people), [people]);
  const light = useMemo(() => lightAt(now), [now]);
  const lookStates = useMemo(() => lookStatesOf(people, now, light), [people, now, light]);
  const shown = useMemo(
    () => shownPeopleOf(people, lookStates, titles),
    [people, lookStates, titles],
  );
  const summary = summaryWords(people, light, now, lookStates);
  usePageHeading({
    title: "Live view",
    crumb: people.length === 1 ? "1 person" : `${people.length} people`,
  });

  const [listOpen, setListOpen] = useState(false);
  const [popoverKey, setPopoverKey] = useState<string | null>(null);

  /** A press on someone: their work straight away, or the popover to choose from (design decision 9). */
  const askToOpen = (roleKey: string, touch: boolean): void => {
    const entry = shown.find(({ person }) => person.roleKey === roleKey);
    if (entry === undefined) return;
    // A screen without hover has shown nothing yet, so a tap shows the words with the links.
    const direct = touch ? null : directLinkOf(entry.person, entry.links);
    if (direct === null) {
      setPopoverKey(roleKey);
      return;
    }
    setPopoverKey(null);
    void navigate(workLinkOptions(direct.target));
  };
  const changePopover = (roleKey: string, open: boolean): void => {
    if (open) askToOpen(roleKey, noHover);
    else setPopoverKey((shownFor) => (shownFor === roleKey ? null : shownFor));
  };
  const canvas = useRef<HTMLCanvasElement>(null);
  const floor = useOfficeStage(
    canvas,
    (roleKey, pointerType) => askToOpen(roleKey, pointerType === "touch" || noHover),
    () => setListOpen(true),
  );
  useEffect(() => {
    floor.stage?.apply(people, now);
  }, [floor.stage, people, now]);

  const showOnFloor = (roleKey: string): void => {
    floor.stage?.frame(roleKey);
    if (narrow) setListOpen(false);
  };
  const error = snapshot.error ?? roles.error;

  return (
    <div className="live-view" data-list={listOpen && !narrow ? "open" : "closed"}>
      <div className="live-floor">
        {error && (
          <div className="live-floor-alert">
            <Alert tone="danger" title={error.message} />
          </div>
        )}
        {floor.failed ? (
          <p className="live-floor-failed">The floor can't be drawn in this browser.</p>
        ) : (
          <Floor
            canvas={canvas}
            floor={floor}
            summary={summary}
            nameplates={
              floor.view && (
                <Nameplates
                  shown={shown}
                  view={floor.view}
                  now={now}
                  titles={titles}
                  names={names}
                  hoveredKey={floor.hoveredKey}
                  popoverKey={popoverKey}
                  onPopoverChange={changePopover}
                />
              )
            }
          />
        )}
        <div className="live-toolbar">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="list" size={14} />}
            aria-expanded={listOpen}
            onClick={() => setListOpen(!listOpen)}
          >
            List
          </Button>
        </div>
      </div>
      {listOpen && (
        <PeopleList
          shown={shown}
          summary={summary}
          asDrawer={narrow}
          onShowOnFloor={showOnFloor}
          onClose={() => setListOpen(false)}
        />
      )}
    </div>
  );
}

interface OfficeFloor {
  /** Changes when the stage must be made again, so a fresh canvas takes it. */
  readonly canvasKey: string;
  readonly stage: OfficeStage | null;
  readonly view: StageView | null;
  readonly hoveredKey: string | null;
  readonly failed: boolean;
}

/**
 * The PixiJS stage, loaded on its own so the page's first paint doesn't wait for it and a test's
 * DOM never loads it; made again when reduced motion changes, as the still office has no ticker.
 */
function useOfficeStage(
  canvas: RefObject<HTMLCanvasElement | null>,
  onPress: (roleKey: string, pointerType: string) => void,
  onFailed: () => void,
): OfficeFloor {
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState<OfficeStage | null>(null);
  const [view, setView] = useState<StageView | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const failedToStart = useEffectEvent(onFailed);
  const pressed = useEffectEvent(onPress);

  useEffect(() => {
    const drawnOn = canvas.current;
    if (drawnOn === null) return;
    let left = false;
    let made: OfficeStage | undefined;
    const start = async (): Promise<void> => {
      try {
        const { createOfficeStage } = await import("./office-stage.ts");
        const started = await createOfficeStage(drawnOn, {
          reducedMotion,
          onView: setView,
          onHover: setHoveredKey,
          onPress: (roleKey, pointerType) => pressed(roleKey, pointerType),
        });
        if (left) {
          started.destroy();
          return;
        }
        made = started;
        setStage(started);
      } catch {
        if (left) return;
        setFailed(true);
        failedToStart();
      }
    };
    void start();
    return () => {
      left = true;
      made?.destroy();
      setStage(null);
      setView(null);
      setHoveredKey(null);
    };
  }, [canvas, reducedMotion]);

  return {
    canvasKey: reducedMotion ? "still" : "moving",
    stage,
    view,
    hoveredKey,
    failed,
  };
}

function Floor({
  canvas,
  floor,
  summary,
  nameplates,
}: {
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  readonly floor: OfficeFloor;
  readonly summary: string;
  readonly nameplates: ReactNode;
}): ReactNode {
  const keysId = useId();
  return (
    <>
      <canvas
        key={floor.canvasKey}
        ref={canvas}
        className={floor.hoveredKey === null ? "live-canvas" : "live-canvas over-figure"}
        role="img"
        tabIndex={0}
        aria-label={summary}
        aria-describedby={keysId}
      />
      <p id={keysId} className="visually-hidden">
        Drag or use the arrow keys to move round the office; the wheel, + and − zoom; 0 shows the
        whole office.
      </p>
      {nameplates}
      {floor.stage && floor.view && <ZoomControls stage={floor.stage} view={floor.view} />}
    </>
  );
}

function ZoomControls({
  stage,
  view,
}: {
  readonly stage: OfficeStage;
  readonly view: StageView;
}): ReactNode {
  return (
    <div className="live-zoom" role="group" aria-label="Zoom">
      <IconButton
        variant="ghost"
        size="sm"
        icon={<Icon name="minus" size={16} />}
        label="Zoom out"
        disabled={!view.canZoomOut}
        onClick={() => stage.zoomStep(-1)}
      />
      <output className="live-zoom-percent">{view.zoomPercent}%</output>
      <IconButton
        variant="ghost"
        size="sm"
        icon={<Icon name="plus" size={16} />}
        label="Zoom in"
        disabled={!view.canZoomIn}
        onClick={() => stage.zoomStep(1)}
      />
      <span className="live-zoom-separator" aria-hidden="true" />
      <IconButton
        variant="ghost"
        size="sm"
        icon={<Icon name="maximize" size={16} />}
        label="Fit the whole office"
        onClick={() => stage.fit()}
      />
    </div>
  );
}
