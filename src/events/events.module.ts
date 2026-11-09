import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EVENT_MODEL, eventSchema } from './event.schema.js';
import { EventsRepository } from './events.repository.js';

/** Persistence of events, shared by the API (reads) and the worker (state machine). */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: EVENT_MODEL, schema: eventSchema }]),
  ],
  providers: [EventsRepository],
  exports: [EventsRepository],
})
export class EventsModule {}
