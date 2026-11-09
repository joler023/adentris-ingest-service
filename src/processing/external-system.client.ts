import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { EventMessage } from '../events/event-message.js';

/**
 * Stand-in for the slow external system. Only the timing is real: it takes
 * EXTERNAL_PROCESSING_MS, may fail with probability EXTERNAL_FAILURE_RATE, and
 * is bounded by EXTERNAL_TIMEOUT_MS like any real call must be.
 */
@Injectable()
export class ExternalSystemClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async process(_event: EventMessage): Promise<Record<string, unknown>> {
    const signal = AbortSignal.timeout(
      this.config.get('EXTERNAL_TIMEOUT_MS', { infer: true }),
    );
    await sleep(
      this.config.get('EXTERNAL_PROCESSING_MS', { infer: true }),
      undefined,
      { signal },
    );

    if (
      Math.random() < this.config.get('EXTERNAL_FAILURE_RATE', { infer: true })
    ) {
      throw new Error('External system unavailable');
    }
    return { externalRef: randomUUID(), processedAt: new Date().toISOString() };
  }
}
