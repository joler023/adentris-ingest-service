import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { DEAD_LETTER } from '../src/messaging/topology.js';
import { BrokerService } from '../src/messaging/broker.service.js';
import { IngestService } from '../src/ingest/ingest.service.js';
import {
  eventOf,
  FakeExternal,
  maxConcurrency,
  patientsOnDistinctPartitions,
  post,
  sleep,
  startApi,
  startWorker,
  uniquePatient,
  waitFor,
  waitForStatus,
} from './support/harness.js';

describe('event processing (real MongoDB + RabbitMQ)', () => {
  let api: INestApplication;
  const workers: TestingModule[] = [];

  const spawnWorker = async (external: FakeExternal) => {
    const worker = await startWorker(external);
    workers.push(worker);
    return worker;
  };

  beforeAll(async () => {
    api = await startApi();
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
  });

  afterAll(() => api.close());

  describe('idempotency', () => {
    it('processes an event delivered many times only once', async () => {
      const external = new FakeExternal(() => sleep(200));
      await spawnWorker(external);
      const event = eventOf(uniquePatient());

      const keys = await Promise.all([
        post(api, event),
        post(api, { ...event, data: { ...event.data } }),
        post(api, {
          ...event,
          ts: new Date(event.ts).toISOString().replace('Z', '+00:00'),
        }),
        post(api, event),
        post(api, event),
      ]);
      expect(new Set(keys).size).toBe(1);

      const done = await waitForStatus(api, keys[0], 'COMPLETED');
      await sleep(500);
      expect(external.calls).toHaveLength(1);
      expect(done.attempts).toBe(1);
    });

    it('ignores a COMPLETED event that RabbitMQ delivers again', async () => {
      const external = new FakeExternal();
      await spawnWorker(external);
      const patientId = uniquePatient();
      const event = eventOf(patientId);
      const eventKey = await post(api, event);
      await waitForStatus(api, eventKey, 'COMPLETED');

      await api.get(IngestService).accept(event);
      const sentinel = await post(api, eventOf(patientId));
      await waitForStatus(api, sentinel, 'COMPLETED');

      expect(
        external.calls.filter((call) => call.eventKey === eventKey),
      ).toHaveLength(1);
      expect((await waitForStatus(api, eventKey, 'COMPLETED')).attempts).toBe(
        1,
      );
    });
  });

  describe('concurrency and ordering', () => {
    it('processes different patients at the same time', async () => {
      const external = new FakeExternal(() => sleep(400));
      await spawnWorker(external);
      const patients = patientsOnDistinctPartitions(4);

      const keys = await Promise.all(
        patients.map((patientId) => post(api, eventOf(patientId))),
      );
      await Promise.all(
        keys.map((key) => waitForStatus(api, key, 'COMPLETED')),
      );

      expect(maxConcurrency(external.calls)).toBe(4);
    });

    it('never processes two events of one patient at the same time, even with two workers', async () => {
      const first = new FakeExternal(() => sleep(120));
      const second = new FakeExternal(() => sleep(120));
      await spawnWorker(first);
      await spawnWorker(second);
      const patientId = uniquePatient();

      const keys: string[] = [];
      for (let i = 0; i < 6; i++) {
        keys.push(
          await post(
            api,
            eventOf(patientId, {
              ts: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
            }),
          ),
        );
      }
      await Promise.all(
        keys.map((key) => waitForStatus(api, key, 'COMPLETED')),
      );

      const calls = [...first.calls, ...second.calls];
      expect(calls).toHaveLength(6);
      expect(maxConcurrency(calls)).toBe(1);
    });

    it('flags an event that completes after a newer event of the same patient', async () => {
      await spawnWorker(new FakeExternal());
      const patientId = uniquePatient();

      const newer = await post(
        api,
        eventOf(patientId, { ts: '2026-02-01T00:00:00Z' }),
      );
      await waitForStatus(api, newer, 'COMPLETED');
      const older = await post(
        api,
        eventOf(patientId, { ts: '2026-01-01T00:00:00Z' }),
      );

      expect((await waitForStatus(api, older, 'COMPLETED')).outOfOrder).toBe(
        true,
      );
      expect((await waitForStatus(api, newer, 'COMPLETED')).outOfOrder).toBe(
        false,
      );
    });
  });

  describe('failures', () => {
    it('retries a failing event until it succeeds', async () => {
      const external = new FakeExternal(async (_event, callNumber) => {
        if (callNumber < 3) throw new Error('external system down');
      });
      await spawnWorker(external);

      const eventKey = await post(api, eventOf(uniquePatient()));
      const done = await waitForStatus(api, eventKey, 'COMPLETED');

      expect(done.attempts).toBe(3);
      expect(external.calls).toHaveLength(3);
    });

    it('gives up after the last retry: FAILED in MongoDB and a copy in the dead-letter queue', async () => {
      const external = new FakeExternal(async () => {
        throw new Error('external system down');
      });
      const worker = await spawnWorker(external);

      const eventKey = await post(api, eventOf(uniquePatient()));
      const failed = await waitForStatus(api, eventKey, 'FAILED');

      expect(failed.attempts).toBe(3);
      expect(failed.lastError).toBe('external system down');
      const parked = await waitFor(async () => {
        const message = await worker
          .get(BrokerService)
          .channel.get(DEAD_LETTER, { noAck: true });
        return message && JSON.parse(message.content.toString());
      });
      expect(parked.eventKey).toBe(eventKey);
    });

    it('moves a malformed message to the dead-letter queue instead of looping on it', async () => {
      const worker = await spawnWorker(new FakeExternal());
      const broker = worker.get(BrokerService);

      await broker.channel.publish(
        'events',
        'events.p0',
        Buffer.from('not json'),
        { persistent: true },
      );

      const parked = await waitFor(async () => {
        const message = await broker.channel.get(DEAD_LETTER, { noAck: true });
        return message && message.content.toString();
      });
      expect(parked).toBe('not json');
    });
  });

  describe('crash recovery', () => {
    it('lets another worker finish an event whose worker died mid-processing, exactly once', async () => {
      let release!: () => void;
      const hang = new Promise<void>((resolve) => (release = resolve));
      const doomed = new FakeExternal(() => hang);
      const doomedWorker = await spawnWorker(doomed);

      const eventKey = await post(api, eventOf(uniquePatient()));
      await waitFor(async () => doomed.calls.length === 1);

      // The process dies: the broker gets the unacked message back, MongoDB still says PROCESSING.
      await doomedWorker.get(BrokerService).channel.close();
      const survivor = new FakeExternal();
      await spawnWorker(survivor);

      const done = await waitForStatus(api, eventKey, 'COMPLETED');
      expect(done.attempts).toBe(2);
      expect(survivor.calls).toHaveLength(1);

      // The "dead" worker wakes up late: its stale result must not overwrite anything.
      release();
      await sleep(300);
      expect((await waitForStatus(api, eventKey, 'COMPLETED')).attempts).toBe(
        2,
      );
    });
  });
});
