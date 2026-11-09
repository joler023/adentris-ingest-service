import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { EventMessage } from './event-message.js';
import { EVENT_MODEL, EventDocument, EventStatus } from './event.schema.js';

export type Claim =
  /** This caller owns the event; `attempts` is its fencing token for later writes. */
  | { kind: 'acquired'; attempts: number }
  /** COMPLETED or FAILED: nothing left to do, the message can be dropped. */
  | { kind: 'done' }
  /** Another worker holds a live lease. */
  | { kind: 'busy' };

const DUPLICATE_KEY = 11000;

/**
 * Every state transition of an event. Writes after `claim` are fenced by
 * `attempts`: a worker that lost its lease (and was taken over) can no longer
 * change the document.
 */
@Injectable()
export class EventsRepository implements OnModuleInit {
  constructor(
    @InjectModel(EVENT_MODEL) private readonly model: Model<EventDocument>,
  ) {}

  /** Wait for the unique index: without it the dedup guarantee does not exist yet. */
  async onModuleInit(): Promise<void> {
    await this.model.init();
  }

  findByKey(eventKey: string): Promise<EventDocument | null> {
    return this.model
      .findOne({ eventKey }, { _id: 0 })
      .lean<EventDocument>()
      .exec();
  }

  async claim(event: EventMessage, leaseMs: number): Promise<Claim> {
    const lockedUntil = new Date(Date.now() + leaseMs);

    try {
      await this.model.create({
        eventKey: event.eventKey,
        patientId: event.patientId,
        type: event.type,
        data: event.data,
        ts: new Date(event.ts),
        receivedAt: new Date(event.receivedAt),
        status: EventStatus.PROCESSING,
        attempts: 1,
        lockedUntil,
      });
      return { kind: 'acquired', attempts: 1 };
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
    }

    const takenOver = await this.model
      .findOneAndUpdate(
        {
          eventKey: event.eventKey,
          $or: [
            { status: EventStatus.PENDING },
            {
              status: EventStatus.PROCESSING,
              lockedUntil: { $lte: new Date() },
            },
          ],
        },
        {
          $set: { status: EventStatus.PROCESSING, lockedUntil },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after', projection: { attempts: 1 } },
      )
      .lean()
      .exec();
    if (takenOver) return { kind: 'acquired', attempts: takenOver.attempts };

    const current = await this.model
      .findOne({ eventKey: event.eventKey }, { status: 1 })
      .lean()
      .exec();
    return current?.status === EventStatus.PROCESSING
      ? { kind: 'busy' }
      : { kind: 'done' };
  }

  async complete(
    event: EventMessage,
    attempts: number,
    result: Record<string, unknown>,
  ): Promise<boolean> {
    const outOfOrder = !!(await this.model.exists({
      patientId: event.patientId,
      status: EventStatus.COMPLETED,
      ts: { $gt: new Date(event.ts) },
    }));
    return this.transition(event.eventKey, attempts, {
      $set: {
        status: EventStatus.COMPLETED,
        result,
        outOfOrder,
        completedAt: new Date(),
      },
      $unset: { lockedUntil: 1 },
    });
  }

  scheduleRetry(
    eventKey: string,
    attempts: number,
    error: string,
  ): Promise<boolean> {
    return this.transition(eventKey, attempts, {
      $set: { status: EventStatus.PENDING, lastError: error },
      $unset: { lockedUntil: 1 },
    });
  }

  markFailed(
    eventKey: string,
    attempts: number,
    error: string,
  ): Promise<boolean> {
    return this.transition(eventKey, attempts, {
      $set: { status: EventStatus.FAILED, lastError: error },
      $unset: { lockedUntil: 1 },
    });
  }

  private async transition(
    eventKey: string,
    attempts: number,
    update: Record<string, unknown>,
  ): Promise<boolean> {
    const { modifiedCount } = await this.model.updateOne(
      { eventKey, status: EventStatus.PROCESSING, attempts },
      update,
    );
    return modifiedCount === 1;
  }
}
