# Event Collector

An event collector that forwards events from many producers to one downstream
consumer, guaranteeing the consumer never sees the same event twice within a
recent window.

```
Producer 1 ─┐
Producer 2 ─┼─→  Collector  ─── new ──→  Consumer
Producer 3 ─┘   (seen, 10 min)
                     └────── duplicate ──→  dropped
```

## Running it

```bash
npm install
npm test        # 57 tests
npm run demo    # three producers against one collector
npm run build   # type declarations + JS into dist/
npm start       # HTTP server on PORT (default 3000), after a build
npm run dev     # same, straight from the TypeScript sources
```

Requires Node 18+.

## Using it

```ts
import { createEventCollector, EventId, CollectionOutcome } from './src';

const collector = createEventCollector({
  consumer: { async consume(event) { await publish(event); } },
});

const outcome = await collector.collect({
  id: EventId.of('e7af'),
  payload: { amount: 100 },
});

outcome === CollectionOutcome.Forwarded; // or CollectionOutcome.Dropped
```

`window` (default ten minutes) and `clock` (default the system clock) are
optional overrides.

## HTTP API

Remote producers send events over HTTP. `npm start` runs the server with a
consumer that logs every forwarded event to stdout.

```bash
curl -i -H 'Content-Type: application/json'      -d '{"id":"e7af","payload":{"amount":100}}'      http://localhost:3000/events
```

`POST /events` with body `{ "id": string, "payload": any JSON }`:

| Case | Status | Body |
|---|---|---|
| New event | `201` | `{ "outcome": "forwarded" }` |
| Duplicate within the window | `200` | `{ "outcome": "dropped" }` |
| Malformed JSON, not an object, missing/blank `id`, missing `payload` | `400` | `{ "error": "<reason>" }` |
| `Content-Type` other than `application/json` | `415` | `{ "error": "..." }` |
| Body over 1 MB | `413` | `{ "error": "..." }` |
| Any other method on `/events` | `405`, `Allow: POST` | `{ "error": "..." }` |
| Any other path | `404` | `{ "error": "..." }` |
| Consumer throws | `500` | `{ "error": "Internal server error" }`, details logged |

A duplicate is not an error: a producer retrying a request that already went
through gets a success back. `payload: null` is accepted; only a missing
`payload` key is rejected.

To use a different consumer, build the server yourself:

```ts
import { createEventCollector, createHttpServer } from './src';

const collector = createEventCollector({ consumer: myConsumer });
createHttpServer({ collector }).listen(8080);
```

The server is built on `node:http`, so it adds no runtime dependencies.

## Design

Clean Architecture, three layers, dependencies pointing inwards:

```
domain  ←  application  ←  infrastructure
```

```
src/
├── domain/                      no imports outside itself
│   ├── EventId.ts               branded id, validated at the boundary
│   ├── Event.ts                 { id, payload }
│   ├── Timestamp.ts             epoch millis
│   └── Duration.ts              Duration.minutes(10)
├── application/
│   ├── ports/                   interfaces the use case needs
│   │   ├── Clock.ts
│   │   ├── EventConsumer.ts
│   │   └── DeduplicationWindow.ts
│   ├── CollectionOutcome.ts     'forwarded' | 'dropped'
│   └── CollectEvent.ts          the use case
├── infrastructure/              implementations of the ports, and adapters
│   ├── SystemClock.ts
│   ├── InMemorySlidingWindow.ts
│   ├── LoggingConsumer.ts       stdout consumer for the demo and the server
│   └── http/
│       ├── parseEvent.ts        request body → Event, or a 400
│       └── createHttpServer.ts  POST /events on node:http
├── createEventCollector.ts      composition root
├── server.ts                    HTTP entry point
└── index.ts                     public API
```

Ports are **declared** in `application` and **implemented** in
`infrastructure`: the inner layer states what it needs, the outer layer adapts
to it. The domain imports nothing. The application never touches `Date` or
`Map`. Swapping the in-memory window for Redis means writing one class and
changing one line in the composition root; nothing else moves.

The whole use case:

```ts
async execute(event: Event): Promise<CollectionOutcome> {
  const isNew = this.window.registerIfAbsent(event.id, this.clock.now());
  if (!isNew) {
    return CollectionOutcome.Dropped;
  }

  await this.consumer.consume(event);
  return CollectionOutcome.Forwarded;
}
```

### Three decisions worth explaining

**1. The window port is one atomic test-and-set, not `has` + `remember`.**

Splitting the check from the write would put a check-then-act gap in the
*contract*. Any caller that awaited between the two would let two concurrent
producers both pass the check and both forward the same id — precisely the
duplicate this collector exists to prevent. With `registerIfAbsent` there is
no gap to fall into, and every future implementation of the port inherits the
guarantee.

**2. The id is claimed before the event is forwarded, not after.**

Claiming it after a successful `consume()` would be friendlier to retries, but
it reopens the race above across the `await`. Since the stated requirement is
that *the consumer never sees the same event twice*, correctness of the
guarantee wins. The cost is stated plainly under Limitations.

**3. Memory is bounded by a FIFO queue, not just a map.**

A `Map` with lazy per-key expiry is shorter, but it never releases ids that are
never repeated: a high-volume producer grows it until the heap is gone. So the
window keeps two structures in step — a `Map` for O(1) lookup and a queue of
sightings in insertion order. Since sightings are appended in non-decreasing
time order, everything expired sits in a prefix of the queue; dropping that
prefix is O(1) amortised, as each sighting is enqueued and discarded exactly
once. No background timer, no configuration, no unbounded growth.

Two details in that code: the window is half-open, so an id seen at `t` is
forgotten the instant `t + 10min` arrives; and before forgetting an id, the
window checks the queue entry is still the one on record, so a clock that
jumped backwards cannot expire a fresh sighting through a stale entry.

### Complexity

| | |
|---|---|
| `collect()` | O(1) amortised |
| Memory | O(distinct ids seen within the window) |

## Tests

```
npm test
```

Every test injects a manual clock, so expiry is exercised by advancing time
rather than waiting for it: the suite is deterministic and runs in
milliseconds. Assertions are made against a recording consumer — real behaviour
that reached the downstream side — rather than against mock call counts.

Covered: forward on first sight, drop on repeat, consumer untouched when
dropping, re-forward after the window, both sides of the exact window boundary,
payload passed through unchanged, consumer errors propagating unwrapped, two
concurrent `collect()` calls with the same id yielding exactly one forward, and
the window's internal size returning to zero once entries expire — the
regression test for the memory leak.

The HTTP tests start a real server on port 0 and call it with Node's built-in
`fetch`. They cover every row of the status table above (including oversized
bodies sent both with a `Content-Length` and chunked), two concurrent POSTs
with the same id reaching the consumer exactly once, and an id being accepted
again after the window.

## Limitations

Deliberately out of scope, and what each would take:

- **Consumer failures lose the event.** The id is already claimed, and there is
  no retry. Production would need the id recorded after success plus an
  in-flight set, or an outbox with retries. Over HTTP this means a producer
  that retries after a `500` gets `200 dropped`, and the event is gone.
- **State is per-process.** Two collector instances deduplicate independently.
  A shared store behind the same `DeduplicationWindow` port, or consistent
  routing by hash of `id`, would fix it.
- **State is not durable.** A restart empties the window and duplicates can get
  through. Same port, a persistent implementation behind it.

## A note on dependencies

The problem statement asks for no external libraries. **The production code has
zero runtime dependencies** — `dependencies` in `package.json` is empty, and
nothing under `src/` outside the test files imports anything but Node and
itself.

Jest and ts-jest are present as `devDependencies`, used only by `*.test.ts`
files, at the explicit request of the project owner. Removing them and porting
the suite to the built-in `node:test` runner would not touch a line of
production code.
