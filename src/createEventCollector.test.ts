import { CollectionOutcome } from './application/CollectionOutcome';
import { createEventCollector } from './createEventCollector';
import { Duration } from './domain/Duration';
import { EventId } from './domain/EventId';
import { ManualClock } from './testing/ManualClock';
import { RecordingConsumer } from './testing/RecordingConsumer';

const TEN_MINUTES = 600_000;
const event = { id: EventId.of('e7af'), payload: 'payload' };

describe('createEventCollector', () => {
  it('deduplicates with only a consumer supplied', async () => {
    const consumer = new RecordingConsumer();
    const collector = createEventCollector({ consumer });

    await collector.collect(event);
    const outcome = await collector.collect(event);

    expect(outcome).toBe(CollectionOutcome.Dropped);
    expect(consumer.receivedIds).toEqual(['e7af']);
  });

  it('defaults the window to ten minutes', async () => {
    const consumer = new RecordingConsumer();
    const clock = new ManualClock();
    const collector = createEventCollector({ consumer, clock });

    await collector.collect(event);
    clock.advanceBy(TEN_MINUTES - 1);
    const justInside = await collector.collect(event);
    clock.advanceBy(1);
    const justOutside = await collector.collect(event);

    expect(justInside).toBe(CollectionOutcome.Dropped);
    expect(justOutside).toBe(CollectionOutcome.Forwarded);
  });

  it('honours a custom window', async () => {
    const consumer = new RecordingConsumer();
    const clock = new ManualClock();
    const collector = createEventCollector({
      consumer,
      clock,
      window: Duration.millis(50),
    });

    await collector.collect(event);
    clock.advanceBy(50);

    expect(await collector.collect(event)).toBe(CollectionOutcome.Forwarded);
  });
});
