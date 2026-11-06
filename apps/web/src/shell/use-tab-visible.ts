import { useSyncExternalStore } from "react";

/** Whether the browser tab is showing, so what is in it can count as seen. */
export function useTabVisible(): boolean {
  return useSyncExternalStore(subscribeToVisibility, tabIsVisible);
}

function subscribeToVisibility(changed: () => void): () => void {
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
}

function tabIsVisible(): boolean {
  return document.visibilityState === "visible";
}
