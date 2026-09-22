import { Duration } from '../domain/Duration';
import type { Event } from '../domain/Event';
import { EventId } from '../domain/EventId';
import { InMemorySlidingWindow } from '../infrastructure/InMemorySlidingWindow';
import { ManualClock } from '../testing/ManualClock';
import { RecordingConsumer } from '../testing/RecordingConsumer';
import { CollectEvent } from './CollectEvent';
import { CollectionOutcome } from './CollectionOutcome';

const WINDOW = Duration.minutes(10);

const eventWith = (id: string, payload: unknown = 'payload'): Event => ({
  id: EventId.of(id),
  payload,
});

describe('CollectEvent', () => {
  let clock: ManualClock;
  let consumer: RecordingConsumer;
  let collect: CollectEvent;

  beforeEach(() => {
    clock = new ManualClock();
    consumer = new RecordingConsumer();
    collect = new CollectEvent(new InMemorySlidingWindow(WINDOW), consumer, clock);
  });

  it('forwards an event the collector has never seen', async () => {
    const outcome = await collect.execute(eventWith('e7af'));

    expect(outcome).toBe(CollectionOutcome.Forwarded);
    expect(consumer.receivedIds).toEqual(['e7af']);
  });

  it('drops a repeated id without troubling the consumer', async () => {
    await collect.execute(eventWith('e7af'));

    const outcome = await collect.execute(eventWith('e7af'));

    expect(outcome).toBe(CollectionOutcome.Dropped);
    expect(consumer.receivedIds).toEqual(['e7af']);
  });

  it('forwards distinct ids even when their payloads are identical', async () => {
    await collect.execute(eventWith('e7af', 'same'));
    await collect.execute(eventWith('1c93', 'same'));

    expect(consumer.receivedIds).toEqual(['e7af', '1c93']);
  });

  it('forwards the same id again once the window has passed', async () => {
    await collect.execute(eventWith('e7af'));
    clock.advanceBy(WINDOW.inMillis);

    const outcome = await collect.execute(eventWith('e7af'));

    expect(outcome).toBe(CollectionOutcome.Forwarded);
    expect(consumer.receivedIds).toEqual(['e7af', 'e7af']);
  });

  it('still drops the id one millisecond before the window closes', async () => {
    await collect.execute(eventWith('e7af'));
    clock.advanceBy(WINDOW.inMillis - 1);

    expect(await collect.execute(eventWith('e7af'))).toBe(CollectionOutcome.Dropped);
  });

  it('forwards the payload untouched', async () => {
    const payload = { amount: 100, currency: 'BRL' };

    await collect.execute(eventWith('e7af', payload));

    expect(consumer.received[0]?.payload).toBe(payload);
  });

  it('lets a consumer failure reach the producer unchanged', async () => {
    const failure = new Error('downstream unavailable');
    const failing = {
      consume: () => Promise.reject(failure),
    };
    collect = new CollectEvent(new InMemorySlidingWindow(WINDOW), failing, clock);

    await expect(collect.execute(eventWith('e7af'))).rejects.toBe(failure);
  });

  it('forwards exactly once when two producers race with the same id', async () => {
    const event = eventWith('e7af');

    const outcomes = await Promise.all([collect.execute(event), collect.execute(event)]);

    expect(consumer.receivedIds).toEqual(['e7af']);
    expect(outcomes.filter((outcome) => outcome === CollectionOutcome.Forwarded)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === CollectionOutcome.Dropped)).toHaveLength(1);
  });
});
