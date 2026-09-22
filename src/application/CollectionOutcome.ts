/** What the collector decided to do with an event. */
export const CollectionOutcome = {
  /** The event was new and reached the consumer. */
  Forwarded: 'forwarded',
  /** The id was already seen inside the window; the consumer was not called. */
  Dropped: 'dropped',
} as const;

export type CollectionOutcome = (typeof CollectionOutcome)[keyof typeof CollectionOutcome];
