import type { Page } from "@playwright/test";

/** What the desktop channel showed, as the recording stand-in for the browser's Notification keeps it. */
export interface DesktopRecord {
  readonly title: string;
  readonly body: string;
  readonly closed: boolean;
}

interface RecordingWindow {
  desktopShown: DesktopRecord[];
  tabFocused: boolean;
}

/**
 * The browser's Notification as a recording, allowed, and the tab's focus as the test sets it: a
 * headless browser shows no desktop Notifications and keeps the page focused.
 */
export async function recordDesktopNotifications(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const recording = window as unknown as RecordingWindow;
    recording.desktopShown = [];
    recording.tabFocused = true;
    document.hasFocus = () => recording.tabFocused;
    class RecordedNotification extends EventTarget {
      static readonly permission = "granted";
      static requestPermission(): Promise<string> {
        return Promise.resolve("granted");
      }
      private readonly record: { title: string; body: string; closed: boolean };
      constructor(title: string, options?: { body?: string }) {
        super();
        this.record = { title, body: options?.body ?? "", closed: false };
        recording.desktopShown.push(this.record);
      }
      close(): void {
        this.record.closed = true;
        this.dispatchEvent(new Event("close"));
      }
    }
    Object.defineProperty(window, "Notification", { value: RecordedNotification });
  });
}

export function desktopShown(page: Page): Promise<DesktopRecord[]> {
  return page.evaluate(() => (window as unknown as RecordingWindow).desktopShown);
}

export function focusTab(page: Page, focused: boolean): Promise<void> {
  return page.evaluate((value) => {
    (window as unknown as RecordingWindow).tabFocused = value;
  }, focused);
}
