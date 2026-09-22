import type { EventConsumer } from '../application/ports/EventConsumer';
import type { Event } from '../domain/Event';

/**
 * A consumer that remembers everything it received.
 *
 * Tests assert on what actually reached the downstream side, rather than on
 * how the collector was called.
 */
export class RecordingConsumer implements EventConsumer {
  readonly received: Event[] = [];

  async consume(event: Event): Promise<void> {
    this.received.push(event);
  }

  get receivedIds(): string[] {
    return this.received.map((event) => event.id);
  }
}
