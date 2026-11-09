import { Schema } from 'mongoose';

export const EVENT_MODEL = 'Event';

export enum EventStatus {
  /** Waiting for a (re)delivery: a retry has been scheduled. */
  PENDING = 'PENDING',
  /** Claimed by a worker; `lockedUntil` is the lease. */
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  /** Attempts exhausted, parked in the dead-letter queue. */
  FAILED = 'FAILED',
}

export interface EventDocument {
  eventKey: string;
  patientId: string;
  type: string;
  data: Record<string, unknown>;
  ts: Date;
  receivedAt: Date;
  status: EventStatus;
  attempts: number;
  lockedUntil?: Date;
  lastError?: string;
  result?: Record<string, unknown>;
  /** A newer event of the same patient had already completed when this one did. */
  outOfOrder: boolean;
  completedAt?: Date;
}

export const eventSchema = new Schema<EventDocument>(
  {
    eventKey: { type: String, required: true },
    patientId: { type: String, required: true },
    type: { type: String, required: true },
    data: { type: Schema.Types.Mixed, required: true },
    ts: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    status: { type: String, enum: Object.values(EventStatus), required: true },
    attempts: { type: Number, required: true, default: 0 },
    lockedUntil: Date,
    lastError: String,
    result: Schema.Types.Mixed,
    outOfOrder: { type: Boolean, required: true, default: false },
    completedAt: Date,
  },
  { timestamps: true, minimize: false, versionKey: false },
);

// The idempotency guarantee: one document per logical event, enforced by the database.
eventSchema.index({ eventKey: 1 }, { unique: true });
// Serves the out-of-order check ("has a newer event of this patient completed?").
eventSchema.index({ patientId: 1, ts: -1 });
