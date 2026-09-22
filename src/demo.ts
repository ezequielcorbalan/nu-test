/**
 * Runnable version of the diagram in the problem statement: three producers
 * feed one collector, which forwards new events and drops repeats.
 *
 * Run with `npm run demo`.
 */
import { CollectionOutcome } from './application/CollectionOutcome';
import { createEventCollector } from './createEventCollector';
import { Duration } from './domain/Duration';
import type { Event } from './domain/Event';
import { EventId } from './domain/EventId';
import { LoggingConsumer } from './infrastructure/LoggingConsumer';

/** Producers 1 and 3 both report 42b0, and producer 2 reports e7af twice. */
const TRAFFIC: ReadonlyArray<{ producer: number; id: string }> = [
  { producer: 1, id: 'e7af' },
  { producer: 2, id: '1c93' },
  { producer: 3, id: '42b0' },
  { producer: 1, id: 'f55d' },
  { producer: 2, id: 'e7af' },
  { producer: 3, id: '42b0' },
  { producer: 2, id: '9b21' },
];

async function main(): Promise<void> {
  const collector = createEventCollector({
    consumer: new LoggingConsumer(),
    window: Duration.minutes(10),
  });

  let forwarded = 0;
  let dropped = 0;

  for (const { producer, id } of TRAFFIC) {
    const event: Event = { id: EventId.of(id), payload: { from: `producer-${producer}` } };
    const outcome = await collector.collect(event);

    if (outcome === CollectionOutcome.Forwarded) {
      forwarded += 1;
      console.log(`producer ${producer} -> ${id}: forwarded`);
    } else {
      dropped += 1;
      console.log(`producer ${producer} -> ${id}: dropped (duplicate)`);
    }
  }

  console.log(`\n${TRAFFIC.length} events in, ${forwarded} forwarded, ${dropped} dropped.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
