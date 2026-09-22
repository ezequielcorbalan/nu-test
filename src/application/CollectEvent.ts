import type { Event } from '../domain/Event';
import { CollectionOutcome } from './CollectionOutcome';
import type { Clock } from './ports/Clock';
import type { DeduplicationWindow } from './ports/DeduplicationWindow';
import type { EventConsumer } from './ports/EventConsumer';

/**
 * Forwards an event downstream unless its id was already seen recently.
 *
 * The id is claimed *before* the event is handed to the consumer. Claiming it
 * afterwards would leave a gap across the `await` in which two producers
 * racing with the same id could both pass the check, which is exactly the
 * duplicate the collector exists to prevent.
 *
 * The cost of that ordering: when the consumer fails, the event is lost and
 * its id stays claimed for the rest of the window. This collector does not
 * retry.
 */
export class CollectEvent {
  constructor(
    private readonly window: DeduplicationWindow,
    private readonly consumer: EventConsumer,
    private readonly clock: Clock,
  ) {}

  async execute(event: Event): Promise<CollectionOutcome> {
    const isNew = this.window.registerIfAbsent(event.id, this.clock.now());
    if (!isNew) {
      return CollectionOutcome.Dropped;
    }

    await this.consumer.consume(event);
    return CollectionOutcome.Forwarded;
  }
}
