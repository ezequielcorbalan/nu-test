import type { EventId } from '../../domain/EventId';
import type { Timestamp } from '../../domain/Timestamp';

/**
 * Remembers which event ids were seen recently.
 *
 * Deliberately a single test-and-set operation rather than a `has` plus a
 * `remember` pair: splitting the two would open a check-then-act gap in the
 * contract itself, and any caller that awaited between them could let two
 * concurrent producers forward the same id. One operation, no gap.
 */
export interface DeduplicationWindow {
  /**
   * Records `id` as seen at `now`, unless it was already seen inside the window.
   *
   * @returns `true` when the id was newly recorded, i.e. the event is new and
   * should be forwarded; `false` when it is a duplicate and should be dropped.
   */
  registerIfAbsent(id: EventId, now: Timestamp): boolean;
}
