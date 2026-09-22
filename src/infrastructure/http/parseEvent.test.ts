import { InvalidEventBodyError, parseEvent } from './parseEvent';

describe('parseEvent', () => {
  it('turns a JSON body into an event', () => {
    const event = parseEvent('{"id":"e7af","payload":{"amount":100}}');

    expect(event).toEqual({ id: 'e7af', payload: { amount: 100 } });
  });

  it('accepts a null payload', () => {
    expect(parseEvent('{"id":"e7af","payload":null}').payload).toBeNull();
  });

  it.each([
    ['malformed JSON', '{"id":', 'Body must be valid JSON'],
    ['an array', '[]', 'Body must be a JSON object'],
    ['a primitive', '"e7af"', 'Body must be a JSON object'],
    ['null', 'null', 'Body must be a JSON object'],
    ['a missing id', '{"payload":1}', 'Event id must be a non-empty string'],
    ['a numeric id', '{"id":7,"payload":1}', 'Event id must be a non-empty string'],
    ['a blank id', '{"id":"  ","payload":1}', 'Event id must be a non-empty string'],
    ['a missing payload', '{"id":"e7af"}', 'Event payload is required'],
  ])('rejects %s', (_case, raw, message) => {
    expect(() => parseEvent(raw)).toThrow(new InvalidEventBodyError(message));
  });

  it('raises InvalidEventBodyError, not the domain error', () => {
    expect(() => parseEvent('{"id":"","payload":1}')).toThrow(InvalidEventBodyError);
  });
});
