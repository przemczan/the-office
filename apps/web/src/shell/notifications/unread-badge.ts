import { useEffect } from "react";
import { titleWithUnread } from "./notification-words.ts";

const SIZE = 64;

/**
 * The in-app channel's count, where a tab in the background shows it: in the tab's title, and as a
 * badge on the favicon.
 */
export function useUnreadBadge(unread: number): void {
  useEffect(() => {
    document.title = titleWithUnread(unread);
    let current = true;
    const link = iconLink();
    const showBadge = async (): Promise<void> => {
      const href = await faviconWith(link.dataset["favicon"] ?? link.href, unread);
      if (current) link.href = href;
    };
    void showBadge();
    return () => {
      current = false;
    };
  }, [unread]);
}

/**
 * The favicon the design system's Vite plugin links, keeping its own address beside the one shown,
 * so each badge is drawn over the plain favicon.
 */
function iconLink(): HTMLLinkElement {
  const link =
    document.querySelector<HTMLLinkElement>("link[rel='icon']") ?? document.createElement("link");
  if (!link.isConnected) {
    link.rel = "icon";
    document.head.append(link);
  }
  link.dataset["favicon"] ??= link.href;
  return link;
}

/** The favicon itself while nothing is unread; drawn with the count in a dot otherwise. */
async function faviconWith(favicon: string, unread: number): Promise<string> {
  if (unread === 0) return favicon;
  const image = new Image();
  image.src = favicon;
  // A favicon that can't be drawn stays as it is; the title still counts.
  const decoded = await image.decode().then(
    () => true,
    () => false,
  );
  if (!decoded) return favicon;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return favicon;
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
