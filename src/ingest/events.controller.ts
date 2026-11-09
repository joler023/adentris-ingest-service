import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CreateEventDto,
  createEventSchema,
} from '../events/create-event.schema.js';
import { EventsRepository } from '../events/events.repository.js';
import {
  acceptedSchema,
  errorSchema,
  eventKeyParam,
  eventStateSchema,
  openApiSchema,
} from './ingest.docs.js';
import { IngestService } from './ingest.service.js';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly ingest: IngestService,
    private readonly events: EventsRepository,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit an event for asynchronous processing',
    description:
      'Answers 202 as soon as the broker durably accepted the event; the (slow) processing happens later. ' +
      'Submitting the same event again is safe: it is processed once.',
  })
  @ApiAcceptedResponse({
    description: 'Accepted for processing.',
    schema: openApiSchema(acceptedSchema),
  })
  @ApiBadRequestResponse({
    description: 'The body does not match the schema.',
    schema: openApiSchema(errorSchema),
  })
  @ApiServiceUnavailableResponse({
    description:
      'The broker did not confirm the event. Nothing was accepted: retry.',
    schema: openApiSchema(errorSchema),
  })
  async accept(@Body({ schema: createEventSchema }) dto: CreateEventDto) {
    const { eventKey } = await this.ingest.accept(dto);
    return { eventKey };
  }

  @Get(':eventKey')
  @ApiOperation({
    summary: 'Get the processing state of an event',
    description:
      'Unknown until a worker picks the event up, so a just-accepted event may answer 404 briefly.',
  })
  @ApiParam({
    name: 'eventKey',
    description: 'The key returned by POST /events.',
  })
  @ApiOkResponse({
    description: 'Current state and result.',
    schema: openApiSchema(eventStateSchema),
  })
  @ApiBadRequestResponse({
    description: 'Malformed eventKey.',
    schema: openApiSchema(errorSchema),
  })
  @ApiNotFoundResponse({
    description: 'No worker has started this event yet.',
    schema: openApiSchema(errorSchema),
  })
  async find(@Param('eventKey', { schema: eventKeyParam }) eventKey: string) {
    const event = await this.events.findByKey(eventKey);
    if (!event) throw new NotFoundException(`Event ${eventKey} not found`);
    return event;
  }
}
