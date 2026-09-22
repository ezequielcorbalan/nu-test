import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { CollectionOutcome } from '../../application/CollectionOutcome';
import type { EventCollector } from '../../application/ports/EventCollector';
import { InvalidEventBodyError, parseEvent } from './parseEvent';

const EVENTS_PATH = '/events';
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** Where the server reports failures it hides from the producer. */
export interface HttpServerLogger {
  error(message: string, error: unknown): void;
}

export interface HttpServerOptions {
  readonly collector: EventCollector;
  /** Defaults to `console`. */
  readonly logger?: HttpServerLogger;
  /** Largest accepted request body. Defaults to 1 MB. */
  readonly maxBodyBytes?: number;
}

/** A failure that maps to a specific status, with a message safe to return. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}

/**
 * Exposes the collector to remote producers as `POST /events`.
 *
 * `201` means the event reached the consumer, `200` that it was a duplicate
 * and was dropped. A duplicate is not an error: a producer retrying a request
 * that already succeeded gets a success back.
 *
 * Returns an unstarted server; calling `listen` is the caller's job.
 */
export function createHttpServer(options: HttpServerOptions): Server {
  const { collector, logger = console, maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = options;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== EVENTS_PATH) {
      throw new HttpError(404, 'Not found');
    }
    if (request.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed', { Allow: 'POST' });
    }
    if (!isJson(request.headers['content-type'])) {
      throw new HttpError(415, 'Content-Type must be application/json');
    }

    const event = parseEvent(await readBody(request, maxBodyBytes));
    const outcome = await collector.collect(event);

    sendJson(response, outcome === CollectionOutcome.Forwarded ? 201 : 200, { outcome });
  }

  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message }, error.headers);
      } else if (error instanceof InvalidEventBodyError) {
        sendJson(response, 400, { error: error.message });
      } else {
        logger.error(`${request.method} ${request.url} failed`, error);
        sendJson(response, 500, { error: 'Internal server error' });
      }
    });
  });
}

function isJson(contentType: string | undefined): boolean {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

/**
 * Reads the whole body as UTF-8, failing with 413 as soon as it grows past the
 * limit, so an oversized request never sits in memory in full.
 */
function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const tooLarge = () => new HttpError(413, `Body exceeds ${maxBytes} bytes`, { Connection: 'close' });

    if (Number(request.headers['content-length']) > maxBytes) {
      request.resume();
      reject(tooLarge());
      return;
    }

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        request.removeAllListeners('data');
        request.resume();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(status, { ...headers, 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
