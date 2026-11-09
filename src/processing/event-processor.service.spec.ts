import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { EventMessage } from '../events/event-message.js';
import type { Claim, EventsRepository } from '../events/events.repository.js';
import { EventProcessor } from './event-processor.service.js';
import type { ExternalSystemClient } from './external-system.client.js';

const event: EventMessage = {
  eventKey: 'k1',
  patientId: 'p1',
  type: 'heart-rate',
  data: {},
  ts: '2026-01-01T00:00:00.000Z',
  receivedAt: '2026-01-01T00:00:01.000Z',
};

/** Two retry delays -> 3 attempts at most. */
const config = {
  get: (key: keyof Env) => ({ LEASE_MS: 30_000, RETRY_DELAYS_MS: [1, 2] })[key],
} as unknown as ConfigService<Env, true>;

function setup(claim: Claim) {
  const events = {
    claim: vi.fn().mockResolvedValue(claim),
    complete: vi.fn().mockResolvedValue(true),
    scheduleRetry: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
  };
  const external = { process: vi.fn().mockResolvedValue({ ok: true }) };
  const processor = new EventProcessor(
    events as unknown as EventsRepository,
    external as unknown as ExternalSystemClient,
    config,
  );
  return { processor, events, external };
}

describe('EventProcessor', () => {
  it('processes a claimed event and records the result', async () => {
    const { processor, events, external } = setup({
      kind: 'acquired',
      attempts: 1,
    });

    await expect(processor.process(event)).resolves.toBe('ack');

    expect(external.process).toHaveBeenCalledOnce();
    expect(events.complete).toHaveBeenCalledWith(event, 1, { ok: true });
  });

  it('does not process an event that is already COMPLETED or FAILED', async () => {
    const { processor, external, events } = setup({ kind: 'done' });

    await expect(processor.process(event)).resolves.toBe('ack');

    expect(external.process).not.toHaveBeenCalled();
    expect(events.complete).not.toHaveBeenCalled();
  });

  it('defers an event another worker is processing', async () => {
    const { processor, external } = setup({ kind: 'busy' });

    await expect(processor.process(event)).resolves.toBe('retry');
    expect(external.process).not.toHaveBeenCalled();
  });

  it('schedules a retry when the external system fails', async () => {
    const { processor, events, external } = setup({
      kind: 'acquired',
      attempts: 1,
    });
    external.process.mockRejectedValue(new Error('boom'));

    await expect(processor.process(event)).resolves.toBe('retry');

    expect(events.scheduleRetry).toHaveBeenCalledWith('k1', 1, 'boom');
    expect(events.complete).not.toHaveBeenCalled();
  });

  it('dead-letters the event once the attempts are exhausted', async () => {
    const { processor, events, external } = setup({
      kind: 'acquired',
      attempts: 3,
    });
    external.process.mockRejectedValue(new Error('boom'));

    await expect(processor.process(event)).resolves.toBe('dead-letter');

    expect(events.markFailed).toHaveBeenCalledWith('k1', 3, 'boom');
    expect(events.scheduleRetry).not.toHaveBeenCalled();
  });

  it('dead-letters without running an event whose previous attempts kept crashing workers', async () => {
    const { processor, events, external } = setup({
      kind: 'acquired',
      attempts: 4,
    });

    await expect(processor.process(event)).resolves.toBe('dead-letter');

    expect(external.process).not.toHaveBeenCalled();
    expect(events.markFailed).toHaveBeenCalledOnce();
  });

  it('acks without side effects when the lease was lost during processing', async () => {
    const { processor, events } = setup({ kind: 'acquired', attempts: 1 });
    events.complete.mockResolvedValue(false);

    await expect(processor.process(event)).resolves.toBe('ack');
  });
});
