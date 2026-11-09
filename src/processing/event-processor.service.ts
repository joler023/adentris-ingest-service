import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { EventMessage } from '../events/event-message.js';
import { EventsRepository } from '../events/events.repository.js';
import { ExternalSystemClient } from './external-system.client.js';

/** What the consumer must do with the RabbitMQ message once the event was handled. */
export type Outcome = 'ack' | 'retry' | 'dead-letter';

/**
 * The idempotent core: claim -> call the external system -> record the result.
 * Safe to run any number of times for the same event, on any worker.
 */
@Injectable()
export class EventProcessor {
  private readonly logger = new Logger(EventProcessor.name);
  private readonly leaseMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly events: EventsRepository,
    private readonly external: ExternalSystemClient,
    config: ConfigService<Env, true>,
  ) {
    this.leaseMs = config.get('LEASE_MS', { infer: true });
    this.maxAttempts =
      config.get('RETRY_DELAYS_MS', { infer: true }).length + 1;
  }

  async process(event: EventMessage): Promise<Outcome> {
    const claim = await this.events.claim(event, this.leaseMs);
    if (claim.kind === 'done') return 'ack';
    if (claim.kind === 'busy') return 'retry';

    const { attempts } = claim;
    // Attempts also grow when a worker dies mid-processing (lease takeover): a
    // poison event that keeps killing workers must end up in the DLQ.
    if (attempts > this.maxAttempts) {
      return this.fail(
        event,
        attempts,
        'Gave up: previous attempts never finished',
      );
    }

    let result: Record<string, unknown>;
    try {
      result = await this.external.process(event);
    } catch (error) {
      return this.fail(
        event,
        attempts,
        error instanceof Error ? error.message : String(error),
      );
    }

    return this.record(
      event,
      await this.events.complete(event, attempts, result),
      'complete',
    );
  }

  private async fail(
    event: EventMessage,
    attempts: number,
    error: string,
  ): Promise<Outcome> {
    if (attempts >= this.maxAttempts) {
      this.logger.error(
        `Event ${event.eventKey} failed ${attempts} times, dead-lettering: ${error}`,
      );
      const applied = await this.events.markFailed(
        event.eventKey,
        attempts,
        error,
      );
      return this.record(event, applied, 'mark failed', 'dead-letter');
    }
    this.logger.warn(
      `Event ${event.eventKey} attempt ${attempts}/${this.maxAttempts} failed: ${error}`,
    );
    const applied = await this.events.scheduleRetry(
      event.eventKey,
      attempts,
      error,
    );
    return this.record(event, applied, 'schedule retry', 'retry');
  }

  /** A write that matched nothing means the lease was lost: the new owner is responsible now. */
  private record(
    event: EventMessage,
    applied: boolean,
    action: string,
    outcome: Outcome = 'ack',
  ): Outcome {
    if (applied) return outcome;
    this.logger.warn(
      `Event ${event.eventKey}: could not ${action}, lease was lost to another worker`,
    );
    return 'ack';
  }
}
