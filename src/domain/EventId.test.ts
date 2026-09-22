import { EventId, InvalidEventIdError } from './EventId';

describe('EventId', () => {
  it('carries the value it was created from', () => {
    expect(EventId.of('e7af')).toBe('e7af');
  });

  it('rejects an empty id', () => {
    expect(() => EventId.of('')).toThrow(InvalidEventIdError);
  });

  it('rejects an id made only of whitespace', () => {
    expect(() => EventId.of('   ')).toThrow(InvalidEventIdError);
  });

  it('explains what was wrong in the error message', () => {
    expect(() => EventId.of('')).toThrow('Event id must be a non-empty string');
  });
});
