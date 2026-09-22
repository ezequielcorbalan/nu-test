import type { Clock } from '../application/ports/Clock';
import type { Timestamp } from '../domain/Timestamp';

/**
 * A clock the test drives by hand.
 *
 * Lets window expiry be exercised in microseconds instead of waiting ten real
 * minutes, and makes every timing assertion deterministic.
 */
export class ManualClock implements Clock {
  constructor(private current: Timestamp = 0) {}

  now(): Timestamp {
    return this.current;
  }

  advanceBy(millis: number): void {
    this.current += millis;
  }
}
