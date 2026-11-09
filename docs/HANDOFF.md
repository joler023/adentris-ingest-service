# Handoff

## Status

Planning done, implementation in progress. See the checklist at the bottom.

## Problem (from the assignment)

`POST /events` receives patient events from unreliable third parties (retries,
duplicates, out of order). Processing takes ~5 s. 1000 events/min sustained and
growing. Events must never be lost nor counted twice, same-patient events must
not run concurrently, the service must survive being killed at any moment, and
the sender gets an immediate answer.

## Decisions (short form, rationale in `ARCHITECTURE.md`)

| Concern | Decision |
|---|---|
| Intake durability | API publishes to RabbitMQ (persistent, publisher confirms) and answers 202 only after the broker confirmed. No DB write on the request path. |
| Identity | No provider ID exists, so `eventKey = sha256(canonical(patientId, type, ts, data))`. Unique index in Mongo. |
| Delivery | At-least-once (manual ack). Idempotency comes from the unique `eventKey` + an atomic claim in Mongo. |
| Per-patient serialisation | `hash(patientId) % PARTITIONS` -> one durable queue per partition, `x-single-active-consumer`, prefetch 1. Different partitions run in parallel. |
| Crash recovery | Mongo lease (`lockedUntil`) on PROCESSING. Unacked message is redelivered and takes the claim over once the lease expired. `attempts` doubles as a fencing token. |
| Retries | TTL "retry" queues (one per backoff step) dead-lettering back into the partition queue. After `max attempts` -> `FAILED` + dead-letter queue. |
| Ordering | Serialised per patient in arrival order. Final state is resolved by event `ts`; a late event is processed and flagged `outOfOrder` (never dropped). Absolute ordering is impossible without a sequence from the sender. |
| Stack | NestJS 12 (ESM), Mongoose, `amqp-connection-manager` (reconnect + confirm channel), Zod (Standard Schema), Vitest. |

## Layout

- `src/main.ts` API process, `src/worker.ts` worker process, same codebase.
- `src/events/` intake (controller, schema, fingerprint) and persistence (Mongo schema + repository).
- `src/messaging/` RabbitMQ topology, connection, publishing.
- `src/processing/` worker side: consumer, processor, simulated external system.

## Progress

- [x] Repository inspected, plan written
- [ ] Infra (docker compose, Dockerfile, env)
- [ ] Config + messaging
- [ ] API intake
- [ ] Worker (claim, process, retry, DLQ)
- [ ] Tests (unit + integration)
- [ ] Load script
- [ ] README + ARCHITECTURE
- [ ] Final validation
