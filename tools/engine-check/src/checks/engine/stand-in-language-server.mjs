// A language server the check starts through the engine: it answers a definition with a fixed
// place and logs what it gets, so the check needs nothing installed. Its log file is its argument.
import { appendFileSync } from "node:fs";

const [, , logFile] = process.argv;
const note = (entry) => appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
const send = (message) => {
  const text = JSON.stringify({ jsonrpc: "2.0", ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
};

function answer({ id, method, params }) {
  note({ method, rootUri: params?.rootUri });
  if (method === "initialize") {
    send({ id, result: { capabilities: { textDocumentSync: 1, definitionProvider: true } } });
  } else if (method === "textDocument/definition") {
    const range = { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } };
    send({ id, result: { uri: params.textDocument.uri, range } });
  } else if (method === "exit") {
    process.exit(0);
  } else if (id !== undefined) {
    send({ id, result: null });
  }
}

let received = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  received = Buffer.concat([received, chunk]);
  for (;;) {
    const headerEnd = received.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const length = Number(
      /Content-Length: (\d+)/i.exec(received.toString("utf8", 0, headerEnd))[1],
    );
    const end = headerEnd + 4 + length;
    if (received.length < end) return;
    answer(JSON.parse(received.toString("utf8", headerEnd + 4, end)));
    received = received.subarray(end);
  }
});
