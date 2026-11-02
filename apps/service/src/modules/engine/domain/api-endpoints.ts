/** A model an API endpoint serves, by its id there, with how many tokens its context holds. */
export interface ApiEndpointModel {
  readonly id: string;
  readonly contextWindow: number;
}
