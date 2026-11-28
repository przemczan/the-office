import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ServerMessage, WebEvent } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  EventStreamProvider,
  useConnectedEventStream,
  useOfficeEvent,
  type EventCacheUpdates,
  type EventInvalidations,
} from "./event-stream-provider.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A WebSocket the test opens and feeds as the service would. */
class FakeWebSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;

  send(): void {}

  close(): void {}

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  receive(message: ServerMessage): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }
}

const LAMP_LIT: WebEvent = { type: "lamp.lit", occurredAt: "2026-11-28T09:00:00.000Z" };

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
});

function Connected({ onLampLit }: { readonly onLampLit: (event: WebEvent) => void }): ReactNode {
  useConnectedEventStream(true);
  useOfficeEvent("lamp.lit", onLampLit);
  return null;
}

it("lets every part take an event though another fails on it", () => {
  const queryClient = new QueryClient();
  const invalidated = vi.spyOn(queryClient, "invalidateQueries");
  const failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const heard = vi.fn<(event: WebEvent) => void>();
  const sockets: FakeWebSocket[] = [];
  const cacheUpdates: EventCacheUpdates = {
    "lamp.lit": () => {
      throw new Error("An older page reads the lamp's room differently.");
    },
  };
  const invalidations: EventInvalidations = { "lamp.lit": () => [["lamps"]] };
  act(() => {
    root = createRoot(document.createElement("div"));
    root.render(
      <QueryClientProvider client={queryClient}>
        <EventStreamProvider
          invalidations={invalidations}
          cacheUpdates={cacheUpdates}
          onSignedOut={() => undefined}
          openWebSocket={() => {
            const socket = new FakeWebSocket();
            sockets.push(socket);
            return socket as unknown as WebSocket;
          }}
        >
          <Connected onLampLit={heard} />
        </EventStreamProvider>
      </QueryClientProvider>,
    );
  });
  const [socket] = sockets;
  act(() => socket?.open());
  invalidated.mockClear();

  act(() => socket?.receive({ type: "event", event: LAMP_LIT }));

  expect(invalidated).toHaveBeenCalledWith({ queryKey: ["lamps"] });
  expect(heard).toHaveBeenCalledWith(LAMP_LIT);
  expect(
    failed.mock.calls.filter(([words]) => words === "Handling the event lamp.lit failed."),
  ).toEqual([
    [
      "Handling the event lamp.lit failed.",
      new Error("An older page reads the lamp's room differently."),
    ],
  ]);
});
