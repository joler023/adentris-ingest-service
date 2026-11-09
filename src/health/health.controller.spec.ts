import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseHealthIndicator, TerminusModule } from '@nestjs/terminus';
import request from 'supertest';
import { configureApi } from '../configure-api.js';
import { BrokerService } from '../messaging/broker.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let app: INestApplication;
  const broker = { isConnected: vi.fn() };
  const mongo = { pingCheck: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    const module = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [{ provide: BrokerService, useValue: broker }],
    })
      .overrideProvider(MongooseHealthIndicator)
      .useValue(mongo)
      .compile();
    app = module.createNestApplication();
    configureApi(app);
    await app.init();
  });

  afterEach(() => app.close());

  it('is healthy while MongoDB answers and RabbitMQ is connected', async () => {
    mongo.pingCheck.mockResolvedValue({ mongodb: { status: 'up' } });
    broker.isConnected.mockReturnValue(true);

    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.details).toEqual({
      mongodb: { status: 'up' },
      rabbitmq: { status: 'up' },
    });
  });

  it('answers 503 and names the broken dependency when RabbitMQ is down', async () => {
    mongo.pingCheck.mockResolvedValue({ mongodb: { status: 'up' } });
    broker.isConnected.mockReturnValue(false);

    const res = await request(app.getHttpServer()).get('/health').expect(503);

    expect(res.body.error).toEqual({
      rabbitmq: { status: 'down', message: 'not connected' },
    });
  });

  it('answers 503 when MongoDB is down', async () => {
    mongo.pingCheck.mockResolvedValue({
      mongodb: { status: 'down', message: 'timeout' },
    });
    broker.isConnected.mockReturnValue(true);

    await request(app.getHttpServer()).get('/health').expect(503);
  });

  it('is documented in the OpenAPI document', async () => {
    const { body: doc } = await request(app.getHttpServer()).get(
      '/openapi.json',
    );

    expect(Object.keys(doc.paths['/health'].get.responses)).toEqual([
      '200',
      '503',
    ]);
  });
});
