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
import { nowQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { initiativeQueries, useEveryTask } from "../../api/work.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { useClock } from "../../shell/use-clock.ts";
import { useNarrowPage } from "../../shell/use-narrow-page.ts";
import { browserZone, lightAt } from "./light.ts";
import { lookStatesOf, pickedDoingOf, summaryWords, workLinksOf } from "./live-states.ts";
import type { OfficePerson, OfficeStage, StageView } from "./live-view-types.ts";
import { Nameplates, placeNameplate } from "./nameplate.tsx";
import { officePeopleOf, personNamesOf, recordTitlesOf, shownPeopleOf } from "./office-people.ts";
import { PeopleList } from "./people-list.tsx";
import { directLinkOf } from "./press-words.ts";
import { TimeChip } from "./time-chip.tsx";
import { useNoHover, useReducedMotion } from "./use-reduced-motion.ts";
import { workLinkOptions } from "./work-links.tsx";
import "./live-view.css";

const MINUTE_MS = 60_000;
const NOBODY: readonly OfficePerson[] = [];

/** The Live view (docs/design/live-view.html): who is doing what, drawn as an office. */
export function LiveViewPage(): ReactNode {
  const snapshot = useQuery(liveViewQueries.snapshot());
  const roles = useQuery(roleQueries.list());
  const tasks = useEveryTask();
  const initiatives = useQuery(initiativeQueries.list());
  // While the fire alarm is on, the floor is empty, but for those still at work under a softer way;
  // kept fresh by its sounded and all clear events.
  const alarm = useQuery(nowQueries.now()).data?.fireAlarm ?? null;
  const alarmOn = alarm !== null;
  const workGoesOn = alarm !== null && alarm.way !== "asap";
  // Asleep, "New" and the light turn on the minute.
  const now = useClock(MINUTE_MS);
  const narrow = useNarrowPage();
  const noHover = useNoHover();
  const navigate = useNavigate();
  // The browser's time zone, read once per page open: where the sun is worked out for.
  const [zone] = useState(browserZone);

  // Null until the snapshot and the Roles have both loaded, which is not the same as nobody in the
  // office: the floor is first laid out only once they have, with everyone in place.
  const loaded = useMemo(
    () => (snapshot.data && roles.data ? officePeopleOf(snapshot.data, roles.data) : null),
    [snapshot.data, roles.data],
  );
  const people = loaded ?? NOBODY;
  const titles = useMemo(
    () => recordTitlesOf(tasks.data, initiatives.data),
    [tasks.data, initiatives.data],
  );
  const names = useMemo(() => personNamesOf(people), [people]);
  const light = useMemo(() => lightAt(now, zone), [now, zone]);
  const lookStates = useMemo(() => lookStatesOf(people, now, light), [people, now, light]);
  const summary = summaryWords(people, light, lookStates, alarmOn, workGoesOn);
  usePageHeading({
    title: "Live view",
    crumb: people.length === 1 ? "1 person" : `${people.length} people`,
  });

  const [listOpen, setListOpen] = useState(false);
  const [popoverKey, setPopoverKey] = useState<string | null>(null);

  /** A press on someone: their work straight away, or the popover to choose from (design decision 9). */
  const askToOpen = (roleKey: string, touch: boolean): void => {
    const person = people.find((candidate) => candidate.roleKey === roleKey);
    if (person === undefined) return;
    // A screen without hover has shown nothing yet, so a tap shows the words with the links.
    const direct = touch ? null : directLinkOf(person, workLinksOf(person, titles, names));
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
  // Each nameplate's element by Role key: one Map for the page's life, which the stage writes through.
  const [plates] = useState(() => new Map<string, HTMLElement>());
  const floor = useOfficeStage(
    canvas,
    plates,
    (roleKey, pointerType) => askToOpen(roleKey, pointerType === "touch" || noHover),
    () => setListOpen(true),
  );
  // Before `apply`, so the stage has its light before it first draws anyone.
  useEffect(() => {
    floor.stage?.setLight(light, now);
  }, [floor.stage, light, now]);
  // The stage's first `apply` lays out the floor, so it waits for the people: applied before they
  // load, everyone would walk in as a hire once they do.
  useEffect(() => {
    if (loaded) floor.stage?.apply(loaded, now, alarmOn, workGoesOn);
  }, [floor.stage, loaded, now, alarmOn, workGoesOn]);
  // What each idle person is doing: where the floor put them, or before it has, what they picked.
  const doings = floor.view?.doings;
  const shown = useMemo(
    () =>
      shownPeopleOf(
        people,
        lookStates,
        titles,
        (person) => doings?.get(person.roleKey) ?? pickedDoingOf(person, now, light),
      ),
    [people, lookStates, titles, doings, now, light],
  );

  const showOnFloor = (roleKey: string): void => {
    floor.stage?.frame(roleKey);
    if (narrow) setListOpen(false);
  };
  const error = snapshot.error ?? roles.error;

  return (
    <div className="live-view" data-list={listOpen && !narrow ? "open" : "closed"}>
      <div className="live-floor">
        {!floor.failed && <TimeChip light={light} zone={zone} />}
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
                  plates={plates}
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
 * DOM never loads it; made again when reduced motion changes, as the still office has no ticker, so
 * turning it on mid-walk puts everyone in place at once.
 */
function useOfficeStage(
  canvas: RefObject<HTMLCanvasElement | null>,
  plates: ReadonlyMap<string, HTMLElement>,
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
          onFigureMove: (roleKey, x, bottom, outside) => {
            const plate = plates.get(roleKey);
            if (plate) placeNameplate(plate, x, bottom, outside);
          },
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
  }, [canvas, plates, reducedMotion]);

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
