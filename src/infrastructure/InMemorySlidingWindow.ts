import type { DeduplicationWindow } from '../application/ports/DeduplicationWindow';
import type { Duration } from '../domain/Duration';
import type { EventId } from '../domain/EventId';
import type { Timestamp } from '../domain/Timestamp';

interface Sighting {
  readonly id: EventId;
  readonly recordedAt: Timestamp;
}

/**
 * Compact the sighting queue once its consumed prefix outgrows its live tail,
 * so the backing array cannot grow without bound as entries are discarded.
 */
const COMPACTION_RATIO = 2;

/**
 * Keeps recently seen event ids in process memory.
 *
 * Two structures are maintained in step:
 *
 * - a `Map` from id to the time it was last seen, for O(1) lookup;
 * - a queue of sightings in insertion order, for O(1) expiry.
 *
 * The queue is what bounds memory. A map alone would never release the ids
 * that are never repeated, so a high-volume producer would grow it until the
 * process ran out of heap. Because sightings are appended in non-decreasing
 * time order, every expired entry sits in a prefix of the queue, and dropping
 * that prefix costs O(1) amortised: each sighting is enqueued and discarded
 * exactly once.
 */
export class InMemorySlidingWindow implements DeduplicationWindow {
  private readonly lastSeenAt = new Map<EventId, Timestamp>();
  private readonly sightings: Sighting[] = [];
  private oldestIndex = 0;
  private readonly windowMillis: number;

  constructor(window: Duration) {
    this.windowMillis = window.inMillis;
  }

  registerIfAbsent(id: EventId, now: Timestamp): boolean {
    this.discardExpired(now);

    if (this.lastSeenAt.has(id)) {
      return false;
    }

    this.lastSeenAt.set(id, now);
    this.sightings.push({ id, recordedAt: now });
    return true;
  }

  /** Number of ids currently held. Exposed to prove expiry releases memory. */
  get size(): number {
    return this.lastSeenAt.size;
  }

  private discardExpired(now: Timestamp): void {
    while (this.oldestIndex < this.sightings.length) {
      const oldest = this.sightings[this.oldestIndex]!;
      if (!this.hasExpired(oldest.recordedAt, now)) {
        break;
      }

      // Only forget the id if this sighting is still the one on record. A
      // clock that jumped backwards could otherwise expire a fresh sighting
      // through a stale queue entry.
      if (this.lastSeenAt.get(oldest.id) === oldest.recordedAt) {
        this.lastSeenAt.delete(oldest.id);
      }
      this.oldestIndex += 1;
    }

    this.compactIfMostlyConsumed();
  }

  /**
   * The window is half-open: an id seen at `recordedAt` counts as seen for
   * `windowMillis`, and is forgotten the instant that span elapses.
   */
  private hasExpired(recordedAt: Timestamp, now: Timestamp): boolean {
    return now - recordedAt >= this.windowMillis;
  }

  private compactIfMostlyConsumed(): void {
    if (this.oldestIndex > 0 && this.oldestIndex * COMPACTION_RATIO >= this.sightings.length) {
      this.sightings.splice(0, this.oldestIndex);
      this.oldestIndex = 0;
    }
  }
}
