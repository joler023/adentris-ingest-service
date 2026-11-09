/**
 * Load generator: sends events at a steady rate (with duplicates and shuffled
 * timestamps), then waits until every distinct event is terminal and reports.
 *
 *   node scripts/load.ts --rate 1000 --seconds 60 --patients 500 --duplicates 0.1
 *
 * --rate is events per minute. Needs the API (and a worker) running.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    rate: { type: 'string', default: '1000' },
    seconds: { type: 'string', default: '60' },
    patients: { type: 'string', default: '500' },
    duplicates: { type: 'string', default: '0.1' },
  },
});
const url = values.url;
const rate = Number(values.rate);
const seconds = Number(values.seconds);
const patients = Number(values.patients);
const duplicateRatio = Number(values.duplicates);

type Body = { patientId: string; type: string; data: object; ts: string };
const sent: { body: Body; key?: string }[] = [];
const latencies: number[] = [];
let httpAccepted = 0;
let httpRejected = 0;

function nextBody(): Body {
  return {
    patientId: `load-${Math.floor(Math.random() * patients)}`,
    type: 'heart-rate',
    data: { bpm: 50 + Math.floor(Math.random() * 60), nonce: randomUUID() },
    // up to 10 minutes in the past: events arrive out of order
    ts: new Date(Date.now() - Math.random() * 600_000).toISOString(),
  };
}

async function send(entry: { body: Body; key?: string }): Promise<void> {
  const started = performance.now();
  try {
    const response = await fetch(`${url}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry.body),
    });
    latencies.push(performance.now() - started);
    if (response.status === 202) {
      httpAccepted++;
      entry.key = ((await response.json()) as { eventKey: string }).eventKey;
    } else {
      httpRejected++;
    }
  } catch {
    httpRejected++;
  }
}

async function stateOf(key: string): Promise<{ status: string; attempts: number; outOfOrder: boolean } | undefined> {
  const response = await fetch(`${url}/events/${key}`);
  return response.status === 200 ? await response.json() : undefined;
}

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;

console.log(`Sending ${rate} events/min for ${seconds}s (${duplicateRatio * 100}% duplicates) to ${url}`);
const started = Date.now();
const inFlight = new Set<Promise<void>>();
let target = 0;
while (Date.now() - started < seconds * 1000) {
  target = Math.floor(((Date.now() - started) / 60_000) * rate);
  while (sent.length < target) {
    const duplicate = sent.length > 0 && Math.random() < duplicateRatio;
    const entry = { body: duplicate ? sent[Math.floor(Math.random() * sent.length)].body : nextBody() };
    sent.push(entry);
    const request = send(entry).finally(() => inFlight.delete(request));
    inFlight.add(request);
  }
  await sleep(50);
}
await Promise.all(inFlight);

const keys = new Set(sent.flatMap((entry) => (entry.key ? [entry.key] : [])));
console.log(`Sent ${sent.length} requests: ${httpAccepted} accepted (202), ${httpRejected} rejected`);
console.log(`Accept latency: p50 ${percentile(latencies, 0.5).toFixed(0)} ms, p99 ${percentile(latencies, 0.99).toFixed(0)} ms`);
console.log(`Distinct events: ${keys.size}. Waiting for processing...`);

const states = new Map<string, NonNullable<Awaited<ReturnType<typeof stateOf>>>>();
while (states.size < keys.size) {
  const pending = [...keys].filter((key) => !states.has(key));
  for (let i = 0; i < pending.length; i += 50) {
    await Promise.all(
      pending.slice(i, i + 50).map(async (key) => {
        const state = await stateOf(key);
        if (state && (state.status === 'COMPLETED' || state.status === 'FAILED')) states.set(key, state);
      }),
    );
  }
  console.log(`  terminal: ${states.size}/${keys.size}`);
  if (states.size < keys.size) await sleep(5000);
}

const all = [...states.values()];
console.log(`Finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`  COMPLETED ${all.filter((s) => s.status === 'COMPLETED').length}, FAILED ${all.filter((s) => s.status === 'FAILED').length}`);
console.log(`  needed retries: ${all.filter((s) => s.attempts > 1).length}`);
console.log(`  flagged out of order: ${all.filter((s) => s.outOfOrder).length}`);
