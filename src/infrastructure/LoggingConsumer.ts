import type { EventConsumer } from '../application/ports/EventConsumer';
import type { Event } from '../domain/Event';

/**
 * A consumer that writes each event to stdout.
 *
 * Stands in for a real downstream system when running the HTTP server.
 */
export class LoggingConsumer implements EventConsumer {
  async consume(event: Event): Promise<void> {
    console.log(`consumer received ${event.id} (${JSON.stringify(event.payload)})`);
  }
}
