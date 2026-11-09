# Contributing

Short guide; the details live in [README.md](README.md),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [AGENTS.md](AGENTS.md) (the
project conventions in full).

## Workflow

1. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before touching delivery,
   ordering or retry behaviour, and the gotchas in [docs/HANDOFF.md](docs/HANDOFF.md).
2. Make the change, with tests (see below).
3. Run `bun run build`, `bun run lint` and the tests before committing.
4. Update the documentation the change affects (see "Conventions").

## Setup

Requires Docker and [Bun](https://bun.sh). Install, start the infrastructure and
run the API and worker as described in the README, "Local development":
[README.md](README.md#local-development).

## Tests

```bash
bun run test        # unit tests, no infrastructure needed
bun run test:e2e    # integration tests against real MongoDB and RabbitMQ
```

`test:e2e` needs `docker compose up -d mongo rabbitmq` and is the only
integration/end-to-end suite: it starts the API and worker modules in-process
and uses its own RabbitMQ vhost and database, so it does not touch development
data. Pure logic gets a unit test next to the file (`*.spec.ts`); anything about
ordering, duplicates, retries, crashes or health against the real infrastructure
belongs in `test/` (`*.e2e-spec.ts`). For a manual run at volume see
`bun run load` in the README.

## Conventions

The full list is in [AGENTS.md](AGENTS.md). The ones that matter most:

- **Delivery is at-least-once, so processing must stay idempotent.** State
  changes go through `EventsRepository`; ack a message only after its outcome is
  durable; retries use the TTL retry queues, never `nack(requeue)`.
- **The HTTP request never processes events or calls the external system.** The
  API validates, publishes with confirm and answers 202.
- **Request/response shapes are Zod schemas.** When an endpoint, field or status
  code changes, update the decorators, the schemas, the OpenAPI assertion in
  `events.controller.spec.ts` and the README endpoint table.
- **Config comes from `src/config/env.ts`** through `ConfigService`; do not read
  `process.env` elsewhere.
- **ESM:** relative imports end in `.js`; tests use Vitest (`vi.fn()`).
- **Keep it small:** controllers stay thin, no new abstraction without a second
  use, comments explain why rather than what.
- **Style:** Prettier (`bun run format`) and oxlint (`bun run lint`).
- **Docs:** keep `docs/HANDOFF.md` (state, gotchas) up to date, and
  `docs/ARCHITECTURE.md` when behaviour or a trade-off changes.

## Commits and pull requests

Commit messages are `<type>: <imperative summary>`:

- type is one of `feat`, `fix`, `refactor`, `chore`, `test`, `docs`, `style`;
- English, under 72 characters, one logical change per commit;
- no co-author or tool attribution lines.

For example: `feat: add worker with claim, retry and dead-letter handling`,
`fix: make consumer requeue best effort and share API setup`.

Keep pull requests focused on one change, and include tests for any behavioural
change.

## Security and privacy

Never commit real patient data or PHI: use made-up identifiers and values in
tests, examples and fixtures. Do not log sensitive event data either: no
`patientId`, event `data`, results, connection URLs or raw error objects in log
lines (identify events by `eventKey`, use `reasonOf(error)` for error text). See
"Health and logging" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
