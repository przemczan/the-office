/**
 * The people hired now, which the People module keeps; the composition root binds it. Read at each
 * Notification, so a hire or a let-go speaks from the next one on.
 */
export abstract class KnownPeople {
  /** The keys of the Roles someone fills now. */
  abstract hiredKeys(): Promise<ReadonlySet<string>>;
}
