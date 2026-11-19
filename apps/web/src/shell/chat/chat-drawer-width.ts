import { createSidePanelWidthStore, type SidePanelWidths } from "@the-office/ui";
import { useSyncExternalStore } from "react";

/** The drawer's width is this browser's choice, never sent to the service. */
export const CHAT_DRAWER_WIDTH_STORAGE_KEY = "the-office.chat-drawer-width";

export const CHAT_DRAWER_WIDTHS: SidePanelWidths = { least: 360, standard: 420, most: 720 };

/** Pushing, the page keeps room to lay itself out. */
const PAGE_LEAST_BESIDE = 480;
/** Over it, enough stays in view for the page and the conversation drawer's handle. */
const PAGE_LEAST_UNDER = 240;

const OVER_WINDOW_WIDTH = 900;
const FILLS_WINDOW_WIDTH = 600;
/** The windows the drawer lies over the page in, which a test matches to stand in a narrow one. */
export const OVER_QUERY = `(max-width: ${OVER_WINDOW_WIDTH}px)`;
const FILLS_QUERY = `(max-width: ${FILLS_WINDOW_WIDTH}px)`;

/** Beside the page, pushing it aside; lying over it with no backdrop; or filling the window. */
export type ChatDrawerPlace = "beside" | "over" | "fills";

/** Where the drawer sits and how wide it is now. */
export interface ChatDrawerLayout {
  readonly place: ChatDrawerPlace;
  /** Its width: the remembered one, as far as the room allows. */
  readonly width: number;
  /** The widest it can go now. */
  readonly most: number;
}

const widthStore = createSidePanelWidthStore(CHAT_DRAWER_WIDTH_STORAGE_KEY, CHAT_DRAWER_WIDTHS);

export const showChatDrawerWidth = widthStore.show;
export const rememberChatDrawerWidth = widthStore.remember;

/** `room` is the window's width less the rail. */
export function chatDrawerLayout(
  place: ChatDrawerPlace,
  room: number,
  remembered: number,
): ChatDrawerLayout {
  const { least, most: widest } = CHAT_DRAWER_WIDTHS;
  const pageKeeps = place === "beside" ? PAGE_LEAST_BESIDE : PAGE_LEAST_UNDER;
  const most = Math.max(least, Math.min(widest, room - pageKeeps));
  return { place, width: Math.min(Math.max(remembered, least), most), most };
}

export function useChatDrawerLayout(): ChatDrawerLayout {
  const place = useSyncExternalStore(subscribeToPlace, drawerPlace);
  const room = useSyncExternalStore(subscribeToRoom, roomBesideRail);
  const remembered = useSyncExternalStore(widthStore.subscribe, widthStore.width);
  return chatDrawerLayout(place, room, remembered);
}

function subscribeToPlace(changed: () => void): () => void {
  const queries = [window.matchMedia(OVER_QUERY), window.matchMedia(FILLS_QUERY)];
  for (const query of queries) query.addEventListener("change", changed);
  return () => {
    for (const query of queries) query.removeEventListener("change", changed);
  };
}

function drawerPlace(): ChatDrawerPlace {
  if (window.matchMedia(FILLS_QUERY).matches) return "fills";
  return window.matchMedia(OVER_QUERY).matches ? "over" : "beside";
}

function railElement(): HTMLElement | null {
  return document.querySelector(".shell-rail");
}

function subscribeToRoom(changed: () => void): () => void {
  window.addEventListener("resize", changed);
  const rail = railElement();
  const resizing = new ResizeObserver(changed);
  if (rail) resizing.observe(rail);
  return () => {
    window.removeEventListener("resize", changed);
    resizing.disconnect();
  };
}

function roomBesideRail(): number {
  return window.innerWidth - (railElement()?.offsetWidth ?? 0);
}
