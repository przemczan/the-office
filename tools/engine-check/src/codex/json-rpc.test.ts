import assert from "node:assert/strict";
import { test } from "node:test";
import { errorLine, notificationLine, readMessage, requestLine, resultLine } from "./json-rpc.ts";

test("a line with an id and a result is a response", () => {
  assert.deepEqual(readMessage('{"id":1,"result":{"ok":true}}'), {
    kind: "response",
    id: 1,
    result: { ok: true },
  });
});

test("a line with an id and an error is an error response", () => {
  assert.deepEqual(readMessage('{"id":"a","error":{"code":-32600,"message":"bad"}}'), {
    kind: "error",
    id: "a",
    error: { code: -32600, message: "bad" },
  });
});

test("a line with a method and an id is a server request, with a method only a notification", () => {
  assert.deepEqual(
    readMessage('{"id":7,"method":"item/fileChange/requestApproval","params":{"itemId":"i"}}'),
    { kind: "request", id: 7, method: "item/fileChange/requestApproval", params: { itemId: "i" } },
  );
  assert.deepEqual(readMessage('{"method":"turn/started","params":{}}'), {
    kind: "notification",
    method: "turn/started",
    params: {},
  });
});

test("a line with neither a method nor an id is refused", () => {
  assert.throws(() => readMessage('{"result":1}'), /neither a method nor an id/);
});

test("outgoing messages are one JSON object per line, without a jsonrpc member", () => {
  assert.equal(
    requestLine(1, "account/read", {}),
    '{"id":1,"method":"account/read","params":{}}\n',
  );
  assert.equal(notificationLine("initialized"), '{"method":"initialized"}\n');
  assert.equal(resultLine(7, { decision: "accept" }), '{"id":7,"result":{"decision":"accept"}}\n');
  assert.equal(
    errorLine(8, { code: -32601, message: "no" }),
    '{"id":8,"error":{"code":-32601,"message":"no"}}\n',
  );
});
