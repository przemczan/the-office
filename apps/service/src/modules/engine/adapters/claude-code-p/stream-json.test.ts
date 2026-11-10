import { describe, expect, it } from "vitest";
import { StreamJson } from "./stream-json.js";
import { FakeEngine, all } from "./stream-json.fixtures.js";

describe("StreamJson", () => {
  it("reads the stream's messages, leaving out the protocol's own lines", async () => {
    const engine = new FakeEngine();
    const stream = new StreamJson(engine.asChild);

    engine.writes(
      { type: "system", subtype: "init" },
      { type: "keep_alive" },
      { type: "control_cancel_request", request_id: "r1" },
      { type: "assistant", message: { id: "m1", content: [] } },
    );
    engine.stdout.write("not JSON\n\n");
    engine.exits(0);

    expect(await all(stream.messages)).toEqual([
      { type: "system", subtype: "init" },
      { type: "keep_alive" },
      { type: "assistant", message: { id: "m1", content: [] } },
    ]);
  });

  it("answers a request of the engine's with an error, so the session never hangs on it", async () => {
    const engine = new FakeEngine();
    const stream = new StreamJson(engine.asChild);

    engine.writes({
      type: "control_request",
      request_id: "e1",
      request: { subtype: "can_use_tool" },
    });

    expect(await engine.input()).toEqual([
      {
        type: "control_response",
        response: {
          subtype: "error",
          request_id: "e1",
          error: "The Office answers no such request.",
        },
      },
    ]);
    expect(stream.messages.isOpen).toBe(true);
  });
});
