import type { Clock } from '../application/ports/Clock';
import type { Timestamp } from '../domain/Timestamp';

/** The real clock. The only place the collector touches `Date`. */
export class SystemClock implements Clock {
  now(): Timestamp {
    return Date.now();
  }
}
