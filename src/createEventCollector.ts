import { CollectEvent } from './application/CollectEvent';
import type { CollectionOutcome } from './application/CollectionOutcome';
import type { Clock } from './application/ports/Clock';
import type { EventConsumer } from './application/ports/EventConsumer';
import { Duration } from './domain/Duration';
import type { Event } from './domain/Event';
import { InMemorySlidingWindow } from './infrastructure/InMemorySlidingWindow';
import { SystemClock } from './infrastructure/SystemClock';

const DEFAULT_WINDOW = Duration.minutes(10);

/** The collector as producers see it: hand it an event, learn what happened. */
export interface EventCollector {
  collect(event: Event): Promise<CollectionOutcome>;
}

export interface EventCollectorOptions {
  /** Where surviving events are forwarded. */
  readonly consumer: EventConsumer;
  /** How long an id stays deduplicated. Defaults to ten minutes. */
  readonly window?: Duration;
  /** Source of time. Defaults to the system clock. */
  readonly clock?: Clock;
}

/**
 * Composition root: wires the use case to its adapters.
 *
 * This is the only place that names concrete implementations, which is what
 * keeps `application` and `domain` free of infrastructure imports.
 */
export function createEventCollector(options: EventCollectorOptions): EventCollector {
  const { consumer, window = DEFAULT_WINDOW, clock = new SystemClock() } = options;

  const collectEvent = new CollectEvent(new InMemorySlidingWindow(window), consumer, clock);

  return {
    collect: (event) => collectEvent.execute(event),
  };
}
