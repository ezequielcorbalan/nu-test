import type { Event } from '../../domain/Event';

/**
 * The downstream destination for events that survive deduplication.
 *
 * Asynchronous because any realistic consumer crosses a boundary: an HTTP
 * call, a queue publish, a database write.
 */
export interface EventConsumer {
  consume(event: Event): Promise<void>;
}
