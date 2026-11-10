import { describe, expect, it } from "vitest";
import { ServerSentEvents } from "./server-sent-events.js";

describe("ServerSentEvents", () => {
  it("answers each event's data once its blank line comes", () => {
    const events = new ServerSentEvents();

    expect(events.push('data: {"a":1}\n')).toEqual([]);
    expect(events.push('\ndata: {"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("joins an event cut anywhere, a line ending included", () => {
    const events = new ServerSentEvents();
    const stream = "data: first\r\n\r\ndata: second\r\n\r\n";

    const data = [...stream].flatMap((character) => events.push(character));

    expect(data).toEqual(["first", "second"]);
  });

  it("reads lines ending in a carriage return alone", () => {
    expect(new ServerSentEvents().push("data: one\r\rdata: two\r\r")).toEqual(["one", "two"]);
  });

  it("joins an event's data lines and skips comments and the other fields", () => {
    const events = new ServerSentEvents();

    const data = events.push(
      ": keep-alive\n\nevent: chunk\nid: 7\nretry: 10\ndata: line one\ndata:line two\n\n",
    );

    expect(data).toEqual(["line one\nline two"]);
  });

  it("answers the last event when the stream ends without its blank line", () => {
    const events = new ServerSentEvents();

    expect(events.push("data: [DONE]")).toEqual([]);
    expect(events.end()).toEqual(["[DONE]"]);
  });
});
