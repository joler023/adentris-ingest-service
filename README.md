# Ingest Service

Accepts patient events over HTTP, answers immediately, and processes them
asynchronously (a ~5 s call to a slow external system) with MongoDB as the
source of truth. Built to survive duplicates, retries, out-of-order delivery and
processes dying at any moment.

NestJS 12 · MongoDB · RabbitMQ · two processes (API, worker) from one codebase.

- Design, reasoning and trade-offs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- State of the project and how to continue: [docs/HANDOFF.md](docs/HANDOFF.md)

## Run it

Requires Docker (and [Bun](https://bun.sh) only for local development).

```bash
docker compose up --build
```

This starts MongoDB, RabbitMQ, the API on <http://localhost:3000> and one worker.
RabbitMQ's management UI is on <http://localhost:15672> (guest / guest).

```bash
curl -i -X POST localhost:3000/events -H 'content-type: application/json' \
  -d '{"patientId":"patient-42","type":"heart-rate","data":{"bpm":72},"ts":"2026-11-08T10:15:30Z"}'
# HTTP/1.1 202 Accepted   {"eventKey":"<sha256>"}

curl localhost:3000/events/<eventKey>
# a few seconds later: "status":"COMPLETED", "attempts":1, "result":{...}
```

### API documentation

| URL | What |
|---|---|
| <http://localhost:3000/docs> | Interactive reference, rendered by [Scalar](https://scalar.com) (its script is loaded from a CDN, so the page needs internet access) |
| <http://localhost:3000/openapi.json> | The raw OpenAPI 3 document, generated from the controllers and Zod schemas |

| Endpoint | Success | Errors |
|---|---|---|
| `POST /events` | `202` `{eventKey}`, after the broker confirmed the event | `400` invalid body, `503` broker did not confirm (nothing accepted, retry) |
| `GET /events/:eventKey` | `200` state, attempts, result | `400` malformed key, `404` not picked up yet |
| `GET /health` | `200` MongoDB and RabbitMQ reachable | `503` a dependency is down or the process is shutting down |

### Health and logs

`GET /health` on the API (port 3000) and on the worker (port 3001) checks MongoDB
and RabbitMQ; Docker Compose uses it as the container healthcheck
(`docker compose ps` shows `healthy`). Logs are JSON, one object per line on
stdout (`docker compose logs -f api worker`); filter with `NEST_LOG_LEVEL`, e.g.
`NEST_LOG_LEVEL=">=log"` hides the `debug` lines. Patient identifiers and event
data are never logged. Details: ARCHITECTURE.md, "Health and logging".

### Local development

```bash
bun install
docker compose up -d mongo rabbitmq   # infrastructure only
cp .env.example .env                  # optional, defaults already match
bun run start:dev                     # API   (terminal 1)
bun run start:worker:dev              # worker (terminal 2)
```

Production build: `bun run build`, then `bun run start:prod` and `bun run start:worker:prod`.

### Watch it hold up

```bash
bun run load -- --rate 1000 --seconds 60 --patients 500 --duplicates 0.1
```

Sends 1000 events/min for a minute (10 % of them duplicates, timestamps shuffled
over 10 minutes), then waits until every distinct event is terminal and prints
accept latency, completed/failed counts, retries and out-of-order events. For a
retry/dead-letter demo run the worker with `EXTERNAL_FAILURE_RATE=0.1`. Try
`docker compose kill worker` mid-run and start it again: nothing is lost.
With `docker compose up --scale worker=2` the second worker is a hot standby
(see ARCHITECTURE.md, "Scaling").

## Tests

```bash
bun run test        # unit tests, no infrastructure needed
bun run test:e2e    # integration tests: needs `docker compose up -d mongo rabbitmq`
bun run lint
```

The integration tests use real MongoDB and RabbitMQ in an isolated vhost and
database (recreated on every run) and cover: 202 returned while processing is
still running, an accepted event waiting in the broker until a worker exists,
duplicates processed once, redelivery of a completed event, parallelism across
patients, no overlap within a patient (even with two workers), retries, the
dead-letter queue, malformed messages, out-of-order flagging, and a worker dying
mid-processing.

## Configuration

Environment variables (see [.env.example](.env.example)); invalid values stop the process at startup.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | API port |
| `WORKER_PORT` | `3001` | Worker port, serves only `GET /health` |
| `NEST_LOG_LEVEL` | all | Log filter, e.g. `warn` or `>=log` |
| `MONGODB_URI` / `RABBITMQ_URL` | localhost | Connections |
| `PARTITIONS` | `256` | Per-patient queues. Same value in API and worker; see ARCHITECTURE.md before changing it |
| `RETRY_DELAYS_MS` | `5000,30000,120000` | Backoff between attempts; max attempts = delays + 1 |
| `EXTERNAL_PROCESSING_MS` | `5000` | Simulated external call duration |
| `EXTERNAL_FAILURE_RATE` | `0` | Probability (0-1) that the simulated call fails |
| `EXTERNAL_TIMEOUT_MS` | `20000` | Upper bound of the external call |
| `LEASE_MS` | `30000` | How long a worker owns an event; must exceed the timeout. Also the worst-case crash recovery time |
