interface Reader<T> {
  readonly resolve: (result: IteratorResult<T>) => void;
  readonly reject: (error: unknown) => void;
}

type Ending = { readonly kind: "closed" } | { readonly kind: "failed"; readonly error: unknown };

/**
 * A push-driven async iterable for one reader: what one side pushes, the other reads in order.
 * It finishes once closed and its buffer is read, or throws once failed.
 */
export class AsyncChannel<T> implements AsyncIterable<T> {
  private readonly buffered: T[] = [];
  private waiting: Reader<T> | undefined;
  private ending: Ending | undefined;

  get isOpen(): boolean {
    return this.ending === undefined;
  }

  push(item: T): void {
    if (!this.isOpen) throw new Error("The channel is closed.");
    const reader = this.takeReader();
    if (reader === undefined) {
      this.buffered.push(item);
    } else {
      reader.resolve({ value: item, done: false });
    }
  }

  /** Lets the reader finish after what is buffered; ending twice keeps the first ending. */
  close(): void {
    this.end({ kind: "closed" });
  }

  /** Lets the reader throw `error` after what is buffered. */
  fail(error: unknown): void {
    this.end({ kind: "failed", error });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () =>
        new Promise<IteratorResult<T>>((resolve, reject) => {
          const reader = { resolve, reject };
          if (this.buffered.length > 0) {
            resolve({ value: this.buffered.shift() as T, done: false });
          } else if (this.ending === undefined) {
            this.waiting = reader;
          } else {
            settle(reader, this.ending);
          }
        }),
    };
  }

  private end(ending: Ending): void {
    if (!this.isOpen) return;
    this.ending = ending;
    const reader = this.takeReader();
    if (reader !== undefined) settle(reader, ending);
  }

  private takeReader(): Reader<T> | undefined {
    const reader = this.waiting;
    this.waiting = undefined;
    return reader;
  }
}

function settle<T>(reader: Reader<T>, ending: Ending): void {
  if (ending.kind === "closed") {
    reader.resolve({ value: undefined, done: true });
  } else {
    reader.reject(ending.error);
  }
}
