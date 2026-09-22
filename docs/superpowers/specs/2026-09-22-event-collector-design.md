# Event Collector con deduplicación por ventana deslizante — Diseño

**Fecha:** 2026-09-22
**Estado:** aprobado, pendiente de implementación

## 1. El problema

Diseñar un *event collector* que recibe eventos de varios productores y los reenvía a un
consumer, garantizando que el consumer **nunca vea el mismo evento dos veces dentro de una
ventana reciente de N minutos** (ej. 10).

Cada evento tiene un `id` único y un `payload`. Si el collector ya vio un evento con ese `id`
dentro de la ventana, lo descarta. Si no, lo reenvía.

Restricciones del enunciado: sin librerías externas, 30 s de tiempo de ejecución, 4 GB de memoria.

## 2. Alcance

**Dentro:** deduplicación por ventana deslizante, memoria acotada por la ventana, reloj
inyectable, puertos para consumer y almacenamiento, Clean Architecture, tests con Jest.

**Fuera (YAGNI, decisión explícita):** barrido en background, límite de capacidad máximo,
métricas/observabilidad, backpressure, batching, reintentos, persistencia, sharding,
filtros probabilísticos, deduplicación distribuida.

**Desvío del enunciado:** los tests usan Jest + ts-jest como `devDependency`, por pedido
explícito del usuario. El código de producción mantiene **cero dependencias de runtime**.
Queda anotado en el README del entregable.

## 3. Decisiones de diseño

### 3.1 Se marca el id como visto ANTES de reenviar

`collect()` es asíncrono. El id se registra en la ventana *antes* del `await consumer.consume()`.

**Por qué:** es lo que cumple literalmente la propiedad que pide el enunciado. Si se registrara
después del éxito, dos productores concurrentes con el mismo id podrían atravesar ambos la
comprobación durante el `await` y el consumer vería el duplicado.

**Trade-off aceptado:** si el consumer falla, el evento se pierde y su id queda deduplicado
igual. El collector no reintenta. Va documentado en el README como limitación conocida.

### 3.2 El puerto de la ventana expone un test-and-set atómico

En vez de `has(id)` + `remember(id)`, el puerto expone una sola operación:

```ts
registerIfAbsent(id: EventId, now: Timestamp): boolean
```

**Por qué:** elimina la carrera check-then-act del propio contrato. No existe un hueco entre
consultar y registrar donde se pueda intercalar un `await`. El caso de uso queda sin estado y
trivialmente correcto, y cualquier implementación futura del puerto hereda la garantía.

### 3.3 La ventana es un `Map` + una cola FIFO

La alternativa —sólo un `Map` con expiración perezosa por clave— es más corta pero nunca libera
las entradas de ids que no se repiten: con productores de alto volumen el `Map` crece hasta
agotar los 4 GB. La cola cierra la fuga sin timers ni configuración adicional.

- `Map<EventId, Timestamp>` para lookup O(1).
- Cola FIFO de `{ id, recordedAt }` en orden de inserción, con índice de cabeza.

En cada `registerIfAbsent` se descarta primero el prefijo vencido de la cola y después se
consulta el `Map`. Amortizado O(1): cada entrada se inserta y se descarta exactamente una vez.
La cola se compacta cuando el índice de cabeza supera la mitad de su longitud, para que el
array no crezca indefinidamente con huecos.

### 3.4 Borde de la ventana: intervalo semiabierto

Una entrada está vencida cuando `now - recordedAt >= windowMs`.

"Visto en los últimos 10 minutos" se interpreta como `[recordedAt, recordedAt + 10min)`. A los
10:00.000 exactos el evento **ya no** se considera visto y se reenvía. Queda cubierto por tests
en ambos lados del borde.

### 3.5 El reloj puede no ser monótono

El orden de la cola asume que `now()` no retrocede. Un ajuste del reloj del sistema podría
romper ese orden y hacer que se descarte una entrada fresca.

**Mitigación:** al descartar una entrada de la cola, se verifica que siga siendo la vigente en el
`Map` (`map.get(id) === entry.recordedAt`) antes de borrarla. Una línea, y el peor caso pasa de
"se pierde una deduplicación válida" a "una entrada vencida sobrevive un poco más".

## 4. Arquitectura

Clean Architecture con tres capas y la regla de dependencia apuntando hacia adentro:

```
domain  <-  application  <-  infrastructure
```

```
src/
├── domain/                        cero imports hacia afuera
│   ├── EventId.ts                 branded type + factoría con validación
│   ├── Event.ts                   { id, payload }
│   ├── Timestamp.ts               alias de epoch millis
│   └── Duration.ts                Duration.minutes(10)
├── application/
│   ├── ports/
│   │   ├── Clock.ts
│   │   ├── EventConsumer.ts
│   │   └── DeduplicationWindow.ts
│   ├── CollectionOutcome.ts
│   └── CollectEvent.ts            el caso de uso
├── infrastructure/
│   ├── SystemClock.ts
│   └── InMemorySlidingWindow.ts
├── createEventCollector.ts        composition root
└── index.ts                       API pública del paquete
```

Los puertos se **declaran** en `application` y se **implementan** en `infrastructure`: la capa
interna define la interfaz que necesita y la externa se adapta a ella. El dominio no importa
nada. La aplicación no conoce `Date` ni `Map`.

### 4.1 Contratos

```ts
// domain
type Timestamp = number;                    // epoch millis
type EventId = string & { readonly __brand: 'EventId' };
interface Event<TPayload = unknown> { readonly id: EventId; readonly payload: TPayload }
class Duration { static minutes(n: number): Duration; get inMillis(): number }

// application/ports
interface Clock { now(): Timestamp }
interface EventConsumer { consume(event: Event): Promise<void> }
interface DeduplicationWindow { registerIfAbsent(id: EventId, now: Timestamp): boolean }

// application
const CollectionOutcome = { Forwarded: 'forwarded', Dropped: 'dropped' } as const;
type CollectionOutcome = (typeof CollectionOutcome)[keyof typeof CollectionOutcome];

class CollectEvent {
  constructor(window: DeduplicationWindow, consumer: EventConsumer, clock: Clock);
  execute(event: Event): Promise<CollectionOutcome>;
}

// infrastructure
class SystemClock implements Clock {}
class InMemorySlidingWindow implements DeduplicationWindow {
  constructor(window: Duration);
  get size(): number;                       // sólo para tests de no-fuga
}
```

### 4.1.1 API pública

Lo único que un consumidor del paquete necesita tocar. El composition root arma el grafo de
dependencias y devuelve un objeto con un solo método:

```ts
interface EventCollector {
  collect(event: Event): Promise<CollectionOutcome>;
}

function createEventCollector(options: {
  consumer: EventConsumer;
  window?: Duration;                        // por defecto Duration.minutes(10)
  clock?: Clock;                            // por defecto SystemClock
}): EventCollector;
```

`window` y `clock` son opcionales con valores por defecto sensatos: el caso común es
`createEventCollector({ consumer })`, y los tests inyectan un reloj falso por el mismo hueco.
`index.ts` reexporta `createEventCollector`, los tipos del dominio y los puertos; nada de
`infrastructure` se filtra salvo las implementaciones por defecto.

### 4.2 Flujo de datos

1. El productor llama a `collector.collect(event)`.
2. `CollectEvent` pide la hora al `Clock`.
3. Llama a `window.registerIfAbsent(event.id, now)`.
   - `false` → devuelve `Dropped`. **El consumer no se toca.**
   - `true` → `await consumer.consume(event)` y devuelve `Forwarded`.

## 5. Manejo de errores

| Situación | Comportamiento |
|---|---|
| `EventId.of('')` o sólo espacios | Lanza `InvalidEventIdError`. Un id vacío es un bug del productor, no un evento a deduplicar. |
| `Duration.minutes(n)` con `n <= 0` o no finito | Lanza `InvalidDurationError`. |
| El consumer lanza | El error **se propaga** al productor sin envolverlo. Sin reintentos, sin excepciones tragadas. El id ya quedó registrado (ver 3.1). |

Los errores de dominio son clases propias que extienden `Error`, con `name` explícito, para que
se puedan distinguir en un `catch` sin comparar strings.

## 6. Estrategia de tests

Jest + ts-jest. Reloj falso inyectado en todos los tests: **ningún test usa `setTimeout` ni
depende del tiempo real**, así que la suite corre en milisegundos y es determinista.

**Caso de uso (`CollectEvent`)**
- Reenvía un evento nunca visto y devuelve `Forwarded`.
- Descarta un id repetido dentro de la ventana y devuelve `Dropped`.
- No invoca al consumer cuando descarta.
- Vuelve a reenviar el mismo id una vez pasada la ventana.
- Ids distintos con el mismo payload se reenvían los dos.
- Propaga el error del consumer sin transformarlo.
- Dos `collect()` concurrentes con el mismo id producen exactamente **un** `consume`.

**Ventana (`InMemorySlidingWindow`)**
- `registerIfAbsent` devuelve `true` la primera vez y `false` la segunda.
- Borde: descarta en `windowMs - 1`, reenvía en `windowMs`.
- El tamaño interno vuelve a cero cuando todas las entradas vencen (prueba de no-fuga).
- Un id re-registrado tras vencer no deja entradas duplicadas en la cola.

**Dominio**
- `EventId.of` valida vacío, espacios y no-string.
- `Duration.minutes` valida cero, negativos y `NaN`.

## 7. Entregable

- `package.json` — `typescript`, `jest`, `ts-jest`, `@types/jest`, `@types/node`, todas en
  `devDependencies`. Scripts: `build`, `test`, `test:watch`, `demo`.
- `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`,
  `exactOptionalPropertyTypes: true`, target ES2022.
- `src/demo.ts` — script ejecutable que reproduce el diagrama del enunciado: tres productores
  emitiendo eventos con ids solapados contra un consumer que loguea, mostrando forwards y drops.
- `README.md` — problema, arquitectura, decisiones, trade-offs conocidos, cómo correrlo.

El código y el README van **en inglés** (es un entregable de entrevista); esta spec y la
conversación quedan en español.

## 8. Fuera de alcance, y qué haría falta para cada cosa

Anotado en el README para mostrar que la línea se trazó a conciencia:

- **Durabilidad:** hoy un reinicio vacía la ventana y se pueden reenviar duplicados. Haría falta
  un store persistente detrás del mismo puerto `DeduplicationWindow`.
- **Múltiples instancias:** la deduplicación es por proceso. Haría falta un store compartido o
  routing consistente por hash de `id`.
- **Fallo del consumer:** el evento se pierde. Haría falta registrar el id después del éxito más
  un set de in-flight, o una outbox con reintentos.
