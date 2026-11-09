import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import {
  eventOf,
  FakeExternal,
  post,
  sleep,
  startApi,
  startWorker,
  stateOf,
  uniquePatient,
  waitForStatus,
} from './support/harness.js';

describe('ingest API (real MongoDB + RabbitMQ)', () => {
  let api: INestApplication;
  const workers: TestingModule[] = [];

  beforeAll(async () => {
    api = await startApi();
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
  });

  afterAll(() => api.close());

  it('answers 202 long before the slow processing finishes', async () => {
    const external = new FakeExternal(() => sleep(1500));
    workers.push(await startWorker(external));
    const event = eventOf(uniquePatient());

    const started = Date.now();
    const eventKey = await post(api, event);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(500);
    const stateAtResponse = await stateOf(api, eventKey);
    expect(stateAtResponse?.status).not.toBe('COMPLETED');

    const done = await waitForStatus(api, eventKey, 'COMPLETED');
    expect(done.attempts).toBe(1);
    expect(done.result).toEqual({ fake: true });
  });

  it('keeps an accepted event in the broker until a worker exists, then processes it once', async () => {
    const eventKey = await post(api, eventOf(uniquePatient()));
    await sleep(300);
    expect(await stateOf(api, eventKey)).toBeUndefined();

    const external = new FakeExternal();
    workers.push(await startWorker(external));

    await waitForStatus(api, eventKey, 'COMPLETED');
    expect(external.calls).toHaveLength(1);
  });

  it('rejects an invalid event with 400 and answers 404 for an unknown key', async () => {
    await request(api.getHttpServer())
      .post('/events')
      .send({ patientId: 'p' })
      .expect(400);
    await request(api.getHttpServer())
      .get(`/events/${'0'.repeat(64)}`)
      .expect(404);
  });
});
