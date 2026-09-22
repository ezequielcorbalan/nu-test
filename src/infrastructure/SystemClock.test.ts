import { SystemClock } from './SystemClock';

describe('SystemClock', () => {
  it('reports the current wall-clock time', () => {
    const before = Date.now();

    const reported = new SystemClock().now();

    expect(reported).toBeGreaterThanOrEqual(before);
    expect(reported).toBeLessThanOrEqual(Date.now());
  });
});
