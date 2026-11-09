import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { z } from 'zod';
import { openApiSchema } from '../ingest/ingest.docs.js';
import { BrokerService } from '../messaging/broker.service.js';

const indicators = z.record(z.string(), z.record(z.string(), z.unknown()));
const healthSchema = z
  .object({
    status: z.enum(['ok', 'error', 'shutting_down']),
    info: indicators.optional(),
    error: indicators.optional(),
    details: indicators,
  })
  .meta({
    id: 'Health',
    example: {
      status: 'ok',
      info: { mongodb: { status: 'up' }, rabbitmq: { status: 'up' } },
      error: {},
      details: { mongodb: { status: 'up' }, rabbitmq: { status: 'up' } },
    },
  });

/** Served by both processes: orchestrators restart or stop routing to one whose dependencies are gone. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongo: MongooseHealthIndicator,
    private readonly indicator: HealthIndicatorService,
    private readonly broker: BrokerService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Health of the process and its dependencies',
    description: 'Checks the MongoDB and RabbitMQ connections.',
  })
  @ApiOkResponse({
    description: 'MongoDB and RabbitMQ are reachable.',
    schema: openApiSchema(healthSchema),
  })
  @ApiServiceUnavailableResponse({
    description: 'A dependency is down or the process is shutting down.',
    schema: openApiSchema(healthSchema),
  })
  check() {
    return this.health.check([
      () => this.mongo.pingCheck('mongodb'),
      () => {
        const rabbitmq = this.indicator.check('rabbitmq');
        return this.broker.isConnected()
          ? rabbitmq.up()
          : rabbitmq.down('not connected');
      },
    ]);
  }
}
