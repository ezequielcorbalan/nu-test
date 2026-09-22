import type { Event } from '../../domain/Event';
import type { CollectionOutcome } from '../CollectionOutcome';

/**
 * The collector as producers see it: hand it an event, learn what happened.
 *
 * The inbound port. Delivery adapters such as the HTTP server depend on this,
 * never on how the collector is assembled.
 */
export interface EventCollector {
  collect(event: Event): Promise<CollectionOutcome>;
}
