import type { AddressInfo } from 'node:net';
import { request as httpRequest, type Server } from 'node:http';

import type { EventConsumer } from '../../application/ports/EventConsumer';
import { createEventCollector } from '../../createEventCollector';
import { Duration } from '../../domain/Duration';
import { ManualClock } from '../../testing/ManualClock';
import { RecordingConsumer } from '../../testing/RecordingConsumer';
import { createHttpServer, type HttpServerLogger } from './createHttpServer';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

class RecordingLogger implements HttpServerLogger {
  readonly errors: unknown[] = [];

  error(_message: string, error: unknown): void {
    this.errors.push(error);
  }
}

describe('createHttpServer', () => {
  let server: Server;
  let baseUrl: string;
  let consumer: RecordingConsumer;
  let clock: ManualClock;
  let logger: RecordingLogger;

  async function start(options: { consumer?: EventConsumer; maxBodyBytes?: number } = {}) {
    const collector = createEventCollector({
      consumer: options.consumer ?? consumer,
      clock,
      window: Duration.minutes(10),
    });
    server = createHttpServer({
      collector,
      logger,
      ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  function postEvent(body: string, headers: Record<string, string> = JSON_HEADERS) {
    return fetch(`${baseUrl}/events`, { method: 'POST', headers, body });
  }

  beforeEach(() => {
    consumer = new RecordingConsumer();
    clock = new ManualClock();
    logger = new RecordingLogger();
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  describe('POST /events', () => {
    beforeEach(() => start());

    it('forwards a new event with 201', async () => {
      const response = await postEvent('{"id":"e7af","payload":{"amount":100}}');

      expect(response.status).toBe(201);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(await response.json()).toEqual({ outcome: 'forwarded' });
      expect(consumer.received).toEqual([{ id: 'e7af', payload: { amount: 100 } }]);
    });

    it('drops a duplicate with 200 and leaves the consumer alone', async () => {
      await postEvent('{"id":"e7af","payload":1}');
      const response = await postEvent('{"id":"e7af","payload":2}');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome: 'dropped' });
      expect(consumer.receivedIds).toEqual(['e7af']);
    });

    it('forwards the id again once the window has passed', async () => {
      await postEvent('{"id":"e7af","payload":1}');
      clock.advanceBy(Duration.minutes(10).inMillis);

      const response = await postEvent('{"id":"e7af","payload":1}');

      expect(response.status).toBe(201);
      expect(consumer.receivedIds).toEqual(['e7af', 'e7af']);
    });

    it('forwards exactly once when two producers race with the same id', async () => {
      const responses = await Promise.all([
        postEvent('{"id":"42b0","payload":"producer-1"}'),
        postEvent('{"id":"42b0","payload":"producer-3"}'),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(consumer.receivedIds).toEqual(['42b0']);
    });

    it('accepts a charset parameter on the content type', async () => {
      const response = await postEvent('{"id":"e7af","payload":1}', {
        'Content-Type': 'application/json; charset=utf-8',
      });

      expect(response.status).toBe(201);
    });

    it('ignores the query string when routing', async () => {
      const response = await fetch(`${baseUrl}/events?source=test`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{"id":"e7af","payload":1}',
      });

      expect(response.status).toBe(201);
    });

    it('rejects an invalid body with 400 and the reason', async () => {
      const response = await postEvent('{"id":"","payload":1}');

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Event id must be a non-empty string' });
      expect(consumer.received).toEqual([]);
    });

    it('rejects malformed JSON with 400', async () => {
      const response = await postEvent('{"id":');

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Body must be valid JSON' });
    });

    it('rejects a non-JSON content type with 415', async () => {
      const response = await postEvent('id=e7af', { 'Content-Type': 'text/plain' });

      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: 'Content-Type must be application/json' });
      expect(consumer.received).toEqual([]);
    });

    it('rejects other methods with 405 and an Allow header', async () => {
      const response = await fetch(`${baseUrl}/events`, { method: 'GET' });

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expect(await response.json()).toEqual({ error: 'Method not allowed' });
    });
  });

  it('answers 404 for unknown paths', async () => {
    await start();

    const response = await fetch(`${baseUrl}/nope`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('rejects a body over the size limit with 413', async () => {
    await start({ maxBodyBytes: 16 });

    const response = await postEvent('{"id":"e7af","payload":"far too long for the limit"}');

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Body exceeds 16 bytes' });
    expect(consumer.received).toEqual([]);
  });

  it('rejects an oversized chunked body with no Content-Length', async () => {
    await start({ maxBodyBytes: 16 });

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${baseUrl}/events`, { method: 'POST', headers: JSON_HEADERS }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
      request.write('{"id":"e7af",');
      request.end('"payload":"far too long for the limit"}');
    });

    expect(status).toBe(413);
    expect(consumer.received).toEqual([]);
  });

  it('answers 500 without leaking details when the consumer fails', async () => {
    const failure = new Error('downstream exploded: secret-host:5432');
    await start({
      consumer: {
        consume: async () => {
          throw failure;
        },
      },
    });

    const response = await postEvent('{"id":"e7af","payload":1}');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(logger.errors).toEqual([failure]);
  });
});
