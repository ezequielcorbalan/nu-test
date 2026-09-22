export { createEventCollector } from './createEventCollector';
export type { EventCollector, EventCollectorOptions } from './createEventCollector';

export { CollectEvent } from './application/CollectEvent';
export { CollectionOutcome } from './application/CollectionOutcome';

export type { Clock } from './application/ports/Clock';
export type { DeduplicationWindow } from './application/ports/DeduplicationWindow';
export type { EventConsumer } from './application/ports/EventConsumer';

export { Duration, InvalidDurationError } from './domain/Duration';
export { EventId, InvalidEventIdError } from './domain/EventId';
export type { Event } from './domain/Event';
export type { Timestamp } from './domain/Timestamp';

export { InMemorySlidingWindow } from './infrastructure/InMemorySlidingWindow';
export { SystemClock } from './infrastructure/SystemClock';
