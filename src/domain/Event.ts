import type { EventId } from './EventId';

/**
 * Something that happened, as reported by a producer.
 *
 * The collector routes events by `id` alone and never inspects `payload`, so
 * the payload type stays a parameter the caller chooses.
 */
export interface Event<TPayload = unknown> {
  readonly id: EventId;
  readonly payload: TPayload;
}
