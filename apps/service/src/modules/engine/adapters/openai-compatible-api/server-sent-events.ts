/**
 * Splits a server-sent event stream into each event's data, as the HTML standard's event stream
 * reads it: lines end in `\n`, `\r\n` or `\r`, a blank line ends an event, its `data:` lines are
 * joined with `\n`, and comments and the other fields are skipped. Text arrives in pieces cut
 * anywhere, a line ending included, so what follows the last full line waits for the next piece.
 */
export class ServerSentEvents {
  private pending = "";
  private data: string[] = [];
  private pendingCarriageReturn = false;

  /** The data of each event the piece completes. */
  push(piece: string): string[] {
    let text = piece;
    if (this.pendingCarriageReturn && text.startsWith("\n")) text = text.slice(1);
    this.pendingCarriageReturn = text.endsWith("\r");
    const lines = (this.pending + text).split(/\r\n|\r|\n/);
    this.pending = lines.pop() ?? "";
    return lines.flatMap((line) => this.readLine(line));
  }

  /** The data of an event the stream ended without a blank line after. */
  end(): string[] {
    const last = this.pending === "" ? [] : this.readLine(this.pending);
    this.pending = "";
    return [...last, ...this.readLine("")];
  }

  private readLine(line: string): string[] {
    if (line === "") {
      if (this.data.length === 0) return [];
      const event = this.data.join("\n");
      this.data = [];
      return [event];
    }
    if (line.startsWith(":")) return [];
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") return [];
    const value = colon === -1 ? "" : line.slice(colon + 1);
    this.data.push(value.startsWith(" ") ? value.slice(1) : value);
    return [];
  }
}
