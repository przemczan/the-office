import { useEffect } from "react";
import { titleWithUnread } from "./notification-words.ts";

/** The favicon as index.html links it, which the badge is drawn over. */
const FAVICON = "/favicon.svg";
const SIZE = 64;

/**
 * The in-app channel's count, where a tab in the background shows it: in the tab's title, and as a
 * badge on the favicon.
 */
export function useUnreadBadge(unread: number): void {
  useEffect(() => {
    document.title = titleWithUnread(unread);
    let current = true;
    const showBadge = async (): Promise<void> => {
      const href = await faviconWith(unread);
      if (current) iconLink().href = href;
    };
    void showBadge();
    return () => {
      current = false;
    };
  }, [unread]);
}

function iconLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (existing) return existing;
  const link = document.createElement("link");
  link.rel = "icon";
  document.head.append(link);
  return link;
}

/** The favicon itself while nothing is unread; drawn with the count in a dot otherwise. */
async function faviconWith(unread: number): Promise<string> {
  if (unread === 0) return FAVICON;
  const image = new Image();
  image.src = FAVICON;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return FAVICON;
  context.drawImage(image, 0, 0, SIZE, SIZE);
  const radius = SIZE * 0.3;
  context.beginPath();
  context.arc(SIZE - radius, radius, radius, 0, Math.PI * 2);
  context.fillStyle = token("--danger");
  context.fill();
  context.fillStyle = token("--fg-on-accent");
  context.font = `bold ${Math.round(radius * 1.3)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(unread > 9 ? "9+" : String(unread), SIZE - radius, radius + 1);
  return canvas.toDataURL("image/png");
}

/** A colour token's value as the page resolves it: a canvas takes no CSS variables. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
