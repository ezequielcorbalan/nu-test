/**
 * Runs the collector as an HTTP service producers can POST events to.
 *
 * Run with `npm start` (after `npm run build`) or `npm run dev`. Listens on
 * `PORT`, defaulting to 3000.
 */
import { createEventCollector } from './createEventCollector';
import { Duration } from './domain/Duration';
import { createHttpServer } from './infrastructure/http/createHttpServer';
import { LoggingConsumer } from './infrastructure/LoggingConsumer';

const port = Number(process.env['PORT'] ?? 3000);

const collector = createEventCollector({
  consumer: new LoggingConsumer(),
  window: Duration.minutes(10),
});
const server = createHttpServer({ collector });

server.listen(port, () => {
  console.log(`Event collector listening on http://localhost:${port}/events`);
});

/** Stop taking connections and let requests already in progress finish. */
function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
  server.closeIdleConnections();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
