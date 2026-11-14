/**
 * The people hired now, which the People module keeps; the composition root binds it. Read at each
 * Notification, so a hire or a let-go speaks from the next one on.
 */
export abstract class KnownPeople {
  /** The key of the hired Role holding the duty keyed `duty`; undefined while nobody does. */
  abstract holderOf(duty: string): Promise<string | undefined>;
}
