/** The Office settings the Context policy reads; Settings edits them. */
export abstract class ConversationsSettings {
  /** In tokens; the default until Settings saves one. */
  abstract sizeThreshold(): Promise<number>;

  abstract changeSizeThreshold(sizeThreshold: number): Promise<void>;
}
