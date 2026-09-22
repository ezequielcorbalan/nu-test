import { Duration, InvalidDurationError } from './Duration';

describe('Duration', () => {
  it('converts minutes to milliseconds', () => {
    expect(Duration.minutes(10).inMillis).toBe(600_000);
  });

  it('builds from milliseconds directly', () => {
    expect(Duration.millis(1_500).inMillis).toBe(1_500);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %p minutes, which cannot describe a window',
    (invalid) => {
      expect(() => Duration.minutes(invalid)).toThrow(InvalidDurationError);
    },
  );

  it('rejects non-positive milliseconds', () => {
    expect(() => Duration.millis(0)).toThrow(InvalidDurationError);
  });
});
