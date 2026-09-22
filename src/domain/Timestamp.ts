/**
 * A point in time, as milliseconds since the Unix epoch.
 *
 * The collector only ever subtracts two timestamps to measure elapsed time, so
 * a plain number is enough; the alias exists to say which unit is meant.
 */
export type Timestamp = number;
