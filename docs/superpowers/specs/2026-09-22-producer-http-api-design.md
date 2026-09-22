# API HTTP para productores — Diseño

**Fecha:** 2026-09-22
**Estado:** aprobado

## 1. Objetivo

Hoy un productor sólo puede entregar eventos llamando a `collector.collect(event)` dentro del
mismo proceso. Esta extensión expone el collector por HTTP para que productores remotos envíen
eventos por red, conservando intacta la garantía de deduplicación.

**Éxito:** un productor hace `POST /events` con `{ id, payload }` y sabe, por el código de estado,
si el evento se reenvió al consumer o se descartó por duplicado.

## 2. Alcance

**Dentro:** un endpoint `POST /events`, validación del cuerpo, límite de tamaño, códigos de
error explícitos, entry point ejecutable (`npm start`) con consumer que loguea a stdout,
apagado ordenado con SIGINT/SIGTERM.

**Fuera (YAGNI):** autenticación, endpoint batch, health check, rate limiting, CORS, cliente
SDK, consumer webhook.

## 3. Decisiones

### 3.1 `node:http`, sin framework

El enunciado pide cero librerías externas. Express o Fastify ahorrarían ~40 líneas de ruteo y
parseo para un único endpoint; no compensan romper la regla. El código de producción sigue sin
dependencias de runtime.

### 3.2 HTTP es un adaptador más de `infrastructure`

El servidor depende de la interfaz `EventCollector` que ya exporta `createEventCollector`.
`domain` y `application` no cambian. El consumer sigue siendo inyectable: el servidor recibe un
`EventCollector` ya armado, y el entry point decide con qué consumer armarlo.

### 3.3 El estado indica el resultado

`201` para reenviado, `200` para descartado. Un duplicado no es un error: el productor que
reintenta obtiene una respuesta exitosa, como con una idempotency key. El cuerpo repite el
resultado (`{ "outcome": "forwarded" | "dropped" }`) para clientes que no miren el estado.

## 4. Contrato

`POST /events`, `Content-Type: application/json`, cuerpo `{ "id": string, "payload": any JSON }`.

| Caso | Estado | Cuerpo |
|---|---|---|
| Evento nuevo | `201` | `{ "outcome": "forwarded" }` |
| Duplicado dentro de la ventana | `200` | `{ "outcome": "dropped" }` |
| JSON inválido, cuerpo que no es objeto, `id` ausente/no string/vacío, `payload` ausente | `400` | `{ "error": "<motivo>" }` |
| `Content-Type` distinto de `application/json` (se aceptan parámetros como `charset`) | `415` | `{ "error": "..." }` |
| Cuerpo mayor a 1 MB | `413` | `{ "error": "..." }` |
| Otro método sobre `/events` | `405` + `Allow: POST` | `{ "error": "..." }` |
| Cualquier otra ruta | `404` | `{ "error": "..." }` |
| El consumer lanza | `500` | `{ "error": "Internal server error" }`; el detalle va al log |

`payload: null` es válido; sólo se rechaza la ausencia de la clave. Se ignora la query string al
rutear.

**Consecuencia del 500:** el id se marca como visto antes de reenviar (decisión del núcleo), así
que un reintento tras un `500` recibe `200 dropped` y el evento se pierde. Se documenta en el
README junto a la limitación existente, sin cambiar el núcleo.

## 5. Componentes

```
src/
├── infrastructure/
│   ├── http/
│   │   ├── parseEvent.ts         texto del cuerpo → Event, o InvalidEventBodyError
│   │   └── createHttpServer.ts   http.Server que rutea a collector.collect()
│   └── LoggingConsumer.ts        extraído de demo.ts; lo comparten demo y server
└── server.ts                     entry point: PORT (default 3000), ventana de 10 min
```

- **`parseEvent(raw: string): Event`** — función pura. Valida forma y delega el id a
  `EventId.of`. Lanza `InvalidEventBodyError` con un mensaje apto para devolver al cliente.
- **`createHttpServer({ collector, logger?, maxBodyBytes? }): http.Server`** — lee el cuerpo
  cortando al superar el límite, mapea errores a estados, nunca deja una request sin respuesta.
  No llama a `listen`: eso es del entry point y de los tests.
- **`server.ts`** — arma collector + servidor, escucha en `PORT`, cierra ordenadamente con
  SIGINT/SIGTERM. A diferencia de `demo.ts`, es parte del entregable ejecutable y se compila a
  `dist/server.js`; `npm start` lo corre desde ahí tras `npm run build`, y `npm run dev` con
  ts-node.

## 6. Tests (Jest)

- `parseEvent.test.ts`: casos válidos (incluye `payload: null`) y cada motivo de `400`.
- `createHttpServer.test.ts`: servidor real en puerto 0, `fetch` nativo, `ManualClock` y
  `RecordingConsumer`. Cubre cada fila de la tabla, dos POST concurrentes con el mismo id
  (exactamente un reenvío) y reaceptación del id tras expirar la ventana.
