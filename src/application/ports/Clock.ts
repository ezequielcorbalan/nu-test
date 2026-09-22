import type { Timestamp } from '../../domain/Timestamp';

/**
 * Source of the current time.
 *
 * A port rather than a direct `Date.now()` call so that window expiry can be
 * tested by advancing time instead of waiting for it.
 */
export interface Clock {
  now(): Timestamp;
}
