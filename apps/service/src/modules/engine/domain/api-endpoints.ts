/** A model an API endpoint serves, by its id there, with how many tokens its context holds. */
export interface ApiEndpointModel {
  readonly id: string;
  readonly contextWindow: number;
  /**
   * Whether the model sees images (Sees images in Settings › Engines), which the user tells; off
   * when missing, as a model kept before it was asked lacks it.
   */
  readonly seesImages?: boolean;
}
