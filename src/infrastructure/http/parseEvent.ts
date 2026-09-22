import type { Event } from '../../domain/Event';
import { EventId, InvalidEventIdError } from '../../domain/EventId';

/**
 * Raised when a request body cannot become an event.
 *
 * The message is written for the producer: the HTTP layer returns it as-is in
 * a 400 response.
 */
export class InvalidEventBodyError extends Error {
  override readonly name = 'InvalidEventBodyError';
}

/**
 * Parses a request body of the form `{ "id": string, "payload": any }`.
 *
 * `payload` may be any JSON value, `null` included; only its absence is
 * rejected. Id validation is delegated to {@link EventId.of} so the rule lives
 * in one place.
 */
export function parseEvent(raw: string): Event {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new InvalidEventBodyError('Body must be valid JSON');
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidEventBodyError('Body must be a JSON object');
  }

  const { id, payload } = body as { id?: unknown; payload?: unknown };

  let eventId: EventId;
  try {
    eventId = EventId.of(id as string);
  } catch (error) {
    if (error instanceof InvalidEventIdError) {
      throw new InvalidEventBodyError(error.message);
    }
    throw error;
  }

  if (!('payload' in body)) {
    throw new InvalidEventBodyError('Event payload is required');
  }

  return { id: eventId, payload };
}
