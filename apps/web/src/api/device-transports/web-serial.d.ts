// The parts of Web Serial (https://wicg.github.io/serial/) the serial board's transport uses; the
// DOM library doesn't declare it yet. Absent from `navigator` in a browser without it.

interface SerialPortInfo {
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
}

interface SerialOptions {
  readonly baudRate: number;
  readonly dataBits?: 7 | 8 | 5 | 6;
  readonly stopBits?: 1 | 2;
  readonly parity?: "none" | "even" | "odd";
  readonly bufferSize?: number;
  readonly flowControl?: "none" | "hardware";
}

interface SerialOutputSignals {
  readonly dataTerminalReady?: boolean;
  readonly requestToSend?: boolean;
  readonly break?: boolean;
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: SerialOptions): Promise<void>;
  setSignals(signals: SerialOutputSignals): Promise<void>;
  close(): Promise<void>;
}

interface SerialPortRequestOptions {
  readonly filters?: readonly { readonly usbVendorId?: number; readonly usbProductId?: number }[];
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
}

interface Navigator {
  /** Web Serial; undefined in a browser without it. */
  readonly serial?: Serial;
}
