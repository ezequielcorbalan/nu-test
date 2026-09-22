/**
 * Raised when a producer supplies something that cannot identify an event.
 *
 * An unusable id is a producer bug, not an event to be deduplicated: silently
 * accepting it would let every malformed event share the same bucket.
 */
export class InvalidEventIdError extends Error {
  override readonly name = 'InvalidEventIdError';
}

/**
 * The unique identifier of an event.
 *
 * Branded so that an arbitrary `string` cannot be passed where an id is
 * expected: values only enter the type through {@link EventId.of}, which is
 * the single place validation lives.
 */
export type EventId = string & { readonly __brand: 'EventId' };

export const EventId = {
  of(value: string): EventId {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new InvalidEventIdError('Event id must be a non-empty string');
    }
    return value as EventId;
  },
} as const;
