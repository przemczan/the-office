import { useState } from "react";

/** Whether the flow canvas shows its Overview is this browser's choice, never sent to the service. */
export const OVERVIEW_STORAGE_KEY = "the-office.flow-overview";

/** Shown unless hidden; the choice is kept in local storage, or for this page where that's blocked. */
export function useOverviewChoice(): readonly [boolean, (shown: boolean) => void] {
  const [shown, setShown] = useState(storedChoice);
  const choose = (next: boolean): void => {
    try {
      localStorage.setItem(OVERVIEW_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage is blocked: the choice lasts until the page is closed.
    }
    setShown(next);
  };
  return [shown, choose];
}

function storedChoice(): boolean {
  try {
    return localStorage.getItem(OVERVIEW_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}
