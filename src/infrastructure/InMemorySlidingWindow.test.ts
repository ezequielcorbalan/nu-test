import { Duration } from '../domain/Duration';
import { EventId } from '../domain/EventId';
import { InMemorySlidingWindow } from './InMemorySlidingWindow';

const WINDOW = Duration.minutes(10);
const WINDOW_MS = WINDOW.inMillis;

const id = (value: string) => EventId.of(value);

describe('InMemorySlidingWindow', () => {
  let window: InMemorySlidingWindow;

  beforeEach(() => {
    window = new InMemorySlidingWindow(WINDOW);
  });

  it('records an id it has never seen', () => {
    expect(window.registerIfAbsent(id('e7af'), 0)).toBe(true);
  });

  it('refuses to record an id already seen inside the window', () => {
    window.registerIfAbsent(id('e7af'), 0);

    expect(window.registerIfAbsent(id('e7af'), 1_000)).toBe(false);
  });

  it('keeps distinct ids independent', () => {
    window.registerIfAbsent(id('e7af'), 0);

    expect(window.registerIfAbsent(id('1c93'), 0)).toBe(true);
  });

  it('still considers an id seen one millisecond before the window closes', () => {
    window.registerIfAbsent(id('e7af'), 0);

    expect(window.registerIfAbsent(id('e7af'), WINDOW_MS - 1)).toBe(false);
  });

  it('forgets an id exactly when the window closes', () => {
    window.registerIfAbsent(id('e7af'), 0);

    expect(window.registerIfAbsent(id('e7af'), WINDOW_MS)).toBe(true);
  });

  it('measures the window from the last sighting, not the first', () => {
    window.registerIfAbsent(id('e7af'), 0);
    window.registerIfAbsent(id('e7af'), WINDOW_MS); // re-recorded here

    expect(window.registerIfAbsent(id('e7af'), WINDOW_MS + 1)).toBe(false);
  });

  it('releases expired entries instead of growing forever', () => {
    window.registerIfAbsent(id('e7af'), 0);
    window.registerIfAbsent(id('1c93'), 0);
    window.registerIfAbsent(id('42b0'), 0);

    window.registerIfAbsent(id('f55d'), WINDOW_MS);

    expect(window.size).toBe(1);
  });

  it('does not accumulate stale bookkeeping when an id is re-recorded after expiry', () => {
    window.registerIfAbsent(id('e7af'), 0);
    window.registerIfAbsent(id('e7af'), WINDOW_MS);
    window.registerIfAbsent(id('e7af'), WINDOW_MS * 2);

    expect(window.size).toBe(1);
  });

  it('holds only unexpired entries when sightings are spread over time', () => {
    window.registerIfAbsent(id('old'), 0);
    window.registerIfAbsent(id('recent'), WINDOW_MS - 1);

    window.registerIfAbsent(id('newest'), WINDOW_MS);

    // 'old' has expired; 'recent' and 'newest' are still inside the window.
    expect(window.size).toBe(2);
  });
});
