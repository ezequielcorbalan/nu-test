/** Raised when a duration cannot describe a usable time span. */
export class InvalidDurationError extends Error {
  override readonly name = 'InvalidDurationError';
}

const MILLIS_PER_MINUTE = 60_000;

/**
 * A positive, finite span of time.
 *
 * Exists so that windows are configured as `Duration.minutes(10)` rather than
 * as a bare `600000`, which reads as a magic number and silently accepts the
 * wrong unit.
 */
export class Duration {
  private constructor(readonly inMillis: number) {}

  static millis(value: number): Duration {
    return new Duration(assertPositiveFinite(value, 'milliseconds'));
  }

  static minutes(value: number): Duration {
    return new Duration(assertPositiveFinite(value, 'minutes') * MILLIS_PER_MINUTE);
  }
}

function assertPositiveFinite(value: number, unit: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidDurationError(`Duration must be a finite positive number of ${unit}, got ${value}`);
  }
  return value;
}
