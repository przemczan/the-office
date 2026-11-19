/** The browser tabs following The Office's event stream; the composition root binds it. */
export abstract class BrowserConnections {
  /** How many are open now, from every signed-in device. */
  abstract openConnections(): number;
}
