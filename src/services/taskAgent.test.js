import { describe, expect, it } from "vitest";
import { drainSseEvents } from "./taskAgent.js";

const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

describe("drainSseEvents", () => {
  it("parses a complete frame", () => {
    const { events, rest } = drainSseEvents(frame({ type: "log", message: "hi" }));
    expect(events).toEqual([{ type: "log", message: "hi" }]);
    expect(rest).toBe("");
  });

  it("holds back an incomplete frame instead of dropping it", () => {
    // This is the bug the buffering exists for: the transport splits wherever
    // it likes, so half a frame routinely arrives on its own.
    const whole = frame({ type: "result", tasks: [{ title: "Book car" }] });
    const half = Math.floor(whole.length / 2);

    const first = drainSseEvents(whole.slice(0, half));
    expect(first.events).toEqual([]);
    expect(first.rest).toBe(whole.slice(0, half));

    const second = drainSseEvents(first.rest + whole.slice(half));
    expect(second.events).toEqual([{ type: "result", tasks: [{ title: "Book car" }] }]);
    expect(second.rest).toBe("");
  });

  it("survives a frame arriving one character at a time", () => {
    const whole = frame({ type: "result", tasks: [1, 2, 3] });
    const seen = [];
    let buffer = "";
    for (const ch of whole) {
      buffer += ch;
      const { events, rest } = drainSseEvents(buffer);
      buffer = rest;
      seen.push(...events);
    }
    expect(seen).toEqual([{ type: "result", tasks: [1, 2, 3] }]);
  });

  it("emits every frame when several arrive in one chunk", () => {
    const buffer =
      frame({ type: "log", message: "one" }) +
      frame({ type: "log", message: "two" }) +
      frame({ type: "result", tasks: [] });
    const { events } = drainSseEvents(buffer);
    expect(events.map((e) => e.type)).toEqual(["log", "log", "result"]);
  });

  it("skips [DONE] and blank frames", () => {
    const { events, rest } = drainSseEvents("data: [DONE]\n\n\n\n");
    expect(events).toEqual([]);
    expect(rest).toBe("");
  });

  it("does not abandon the stream on an unparseable frame", () => {
    const buffer = "data: {not json\n\n" + frame({ type: "result", tasks: [{ title: "x" }] });
    const { events } = drainSseEvents(buffer);
    expect(events).toEqual([{ type: "result", tasks: [{ title: "x" }] }]);
  });

  it("reads the first data: line of a multi-line frame", () => {
    const { events } = drainSseEvents(`: comment\ndata: ${JSON.stringify({ type: "log", message: "m" })}\n\n`);
    expect(events).toEqual([{ type: "log", message: "m" }]);
  });

  it("returns everything as the remainder when there is no boundary at all", () => {
    const partial = "data: {\"type\":\"log\"";
    const { events, rest } = drainSseEvents(partial);
    expect(events).toEqual([]);
    expect(rest).toBe(partial);
  });

  // Google's SSE arrives with CRLF. A CRLF stream is "...\r\n\r\n..." which
  // does not contain the substring "\n\n" - a boundary search on the raw text
  // finds nothing and throws the entire response away, silently.
  it("parses a CRLF stream", () => {
    const crlf = frame({ type: "result", tasks: [{ title: "Book car" }] }).replace(/\n/g, "\r\n");
    const { events, rest } = drainSseEvents(crlf);
    expect(events).toEqual([{ type: "result", tasks: [{ title: "Book car" }] }]);
    expect(rest).toBe("");
  });

  it("parses a mixed CRLF/LF stream", () => {
    const mixed =
      frame({ type: "log", message: "a" }).replace(/\n/g, "\r\n") +
      frame({ type: "log", message: "b" }) +
      frame({ type: "result", tasks: [] }).replace(/\n/g, "\r\n");
    const { events } = drainSseEvents(mixed);
    expect(events.map((e) => e.type)).toEqual(["log", "log", "result"]);
  });

  it("normalises a CRLF stream delivered one character at a time", () => {
    // A chunk boundary can land between the \r and the \n.
    const crlf = frame({ type: "result", tasks: [{ title: "x" }] }).replace(/\n/g, "\r\n");
    const seen = [];
    let buffer = "";
    for (const ch of crlf) {
      buffer += ch;
      const { events, rest } = drainSseEvents(buffer);
      buffer = rest;
      seen.push(...events);
    }
    expect(seen).toEqual([{ type: "result", tasks: [{ title: "x" }] }]);
  });

  it("leaves a lone CR alone until its LF arrives", () => {
    const { events, rest } = drainSseEvents('data: {"type":"log","message":"m"}\r');
    expect(events).toEqual([]);
    expect(rest.endsWith("\r")).toBe(true);

    const second = drainSseEvents(rest + "\n\r\n");
    expect(second.events).toEqual([{ type: "log", message: "m" }]);
  });
});