/**
 * The test-instance proxy's listeners (spec §5.1, "The test instance proxy"): one per Proxy port
 * given out, on `OFFICE_HOST`, each answering for whichever instance holds its port.
 */
export abstract class ProxyListeners {
  /** Listens on the Proxy port; nothing when it listens already. */
  abstract open(port: number): Promise<void>;

  /** Stops listening on it and ends every connection it holds; nothing when it doesn't listen. */
  abstract close(port: number): Promise<void>;

  /** Closes every one, as The Office shuts down. */
  abstract closeAll(): Promise<void>;

  /** The ports it listens on now. */
  abstract listening(): readonly number[];
}
