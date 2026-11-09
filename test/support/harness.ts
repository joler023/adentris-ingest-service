import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../../src/api.module.js';
import { configureApi } from '../../src/configure-api.js';
import type { CreateEventDto } from '../../src/events/create-event.schema.js';
import type { EventMessage } from '../../src/events/event-message.js';
import { partitionOf } from '../../src/messaging/topology.js';
import { ExternalSystemClient } from '../../src/processing/external-system.client.js';
import { WorkerModule } from '../../src/worker.module.js';

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface Call {
  eventKey: string;
  patientId: string;
  start: number;
  end?: number;
}

/** Replaces the slow external system: records every call and lets the test decide what it does. */
export class FakeExternal {
  readonly calls: Call[] = [];

  constructor(
    private readonly behavior: (
      event: EventMessage,
      callNumber: number,
    ) => Promise<void> = async () => {},
  ) {}

  async process(event: EventMessage): Promise<Record<string, unknown>> {
    const call: Call = {
      eventKey: event.eventKey,
      patientId: event.patientId,
      start: Date.now(),
    };
    this.calls.push(call);
    try {
      await this.behavior(
        event,
        this.calls.filter((c) => c.eventKey === event.eventKey).length,
      );
      return { fake: true };
    } finally {
      call.end = Date.now();
    }
  }
}

/** Highest number of calls that were running at the same time. */
export function maxConcurrency(calls: Call[]): number {
  const points = calls.flatMap((call) => [
    { at: call.start, delta: 1 },
    { at: call.end ?? Date.now(), delta: -1 },
  ]);
  points.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let running = 0;
  let max = 0;
  for (const point of points) {
    running += point.delta;
    max = Math.max(max, running);
  }
  return max;
}

export async function startWorker(
  external: FakeExternal,
): Promise<TestingModule> {
  const module = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(ExternalSystemClient)
    .useValue(external)
    .compile();
  return module.init();
}

export async function startApi(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [ApiModule],
  }).compile();
  const app = module.createNestApplication();
  configureApi(app);
  return app.init();
}

export const uniquePatient = () => `patient-${randomUUID()}`;

export function eventOf(
  patientId: string,
  overrides: Partial<CreateEventDto> = {},
): CreateEventDto {
  return {
    patientId,
    type: 'heart-rate',
    data: { bpm: 60 + Math.floor(Math.random() * 40), nonce: randomUUID() },
    ts: new Date().toISOString(),
    ...overrides,
  };
}

export async function post(
  api: INestApplication,
  event: CreateEventDto,
): Promise<string> {
  const response = await request(api.getHttpServer())
    .post('/events')
    .send(event)
    .expect(202);
  return response.body.eventKey;
}

export async function stateOf(api: INestApplication, eventKey: string) {
  const response = await request(api.getHttpServer()).get(
    `/events/${eventKey}`,
  );
  return response.status === 200 ? response.body : undefined;
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(50);
  }
  throw new Error('Timed out waiting for condition');
}

export function waitForStatus(
  api: INestApplication,
  eventKey: string,
  status: string,
) {
  return waitFor(async () => {
    const state = await stateOf(api, eventKey);
    return state?.status === status && state;
  });
}

/** Patients guaranteed to live on different partitions (so nothing but the design can serialise them). */
export function patientsOnDistinctPartitions(count: number): string[] {
  const partitions = Number(process.env.PARTITIONS);
  const chosen = new Map<number, string>();
  while (chosen.size < count) {
    const patientId = uniquePatient();
    chosen.set(partitionOf(patientId, partitions), patientId);
  }
  return [...chosen.values()];
}
