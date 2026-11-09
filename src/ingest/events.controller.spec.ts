import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApi } from '../configure-api.js';
import { EventsRepository } from '../events/events.repository.js';
import { BrokerService } from '../messaging/broker.service.js';
import { EventsController } from './events.controller.js';
import { IngestService } from './ingest.service.js';

const body = {
  patientId: 'p1',
  type: 'heart-rate',
  data: { bpm: 70 },
  ts: '2026-01-01T00:00:00Z',
};

describe('EventsController', () => {
  let app: INestApplication;
  const broker = { publishEvent: vi.fn() };
  const events = { findByKey: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    const module = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        IngestService,
        { provide: BrokerService, useValue: broker },
        { provide: EventsRepository, useValue: events },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApi(app);
    await app.init();
  });

  afterEach(() => app.close());

  it('answers 202 with the event key once the broker confirmed, without any processing', async () => {
    broker.publishEvent.mockResolvedValue(undefined);

    const res = await request(app.getHttpServer())
      .post('/events')
      .send(body)
      .expect(202);

    expect(res.body.eventKey).toMatch(/^[0-9a-f]{64}$/);
    expect(broker.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: res.body.eventKey, patientId: 'p1' }),
    );
  });

  it('gives the same key to a resubmitted event', async () => {
    broker.publishEvent.mockResolvedValue(undefined);

    const first = await request(app.getHttpServer()).post('/events').send(body);
    const second = await request(app.getHttpServer())
      .post('/events')
      .send({ ...body, data: { bpm: 70 } });

    expect(second.body.eventKey).toBe(first.body.eventKey);
  });

  it('answers 503 and accepts nothing when the broker does not confirm', async () => {
    broker.publishEvent.mockRejectedValue(new Error('no confirm'));

    await request(app.getHttpServer()).post('/events').send(body).expect(503);
  });

  it.each([
    ['missing fields', {}],
    ['empty patientId', { ...body, patientId: '' }],
    ['non ISO ts', { ...body, ts: 'yesterday' }],
    ['non-object data', { ...body, data: 'x' }],
  ])('answers 400 for %s and publishes nothing', async (_name, invalid) => {
    await request(app.getHttpServer())
      .post('/events')
      .send(invalid)
      .expect(400);
    expect(broker.publishEvent).not.toHaveBeenCalled();
  });

  it('returns the stored state of an event, 404 when unknown, 400 for a malformed key', async () => {
    const key = 'a'.repeat(64);
    events.findByKey
      .mockResolvedValueOnce({ eventKey: key, status: 'COMPLETED' })
      .mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .get(`/events/${key}`)
      .expect(200, { eventKey: key, status: 'COMPLETED' });
    await request(app.getHttpServer()).get(`/events/${key}`).expect(404);
    await request(app.getHttpServer()).get('/events/not-a-key').expect(400);
  });

  it('documents every endpoint and status code in the OpenAPI document served at /openapi.json', async () => {
    const { body: doc } = await request(app.getHttpServer())
      .get('/openapi.json')
      .expect(200);

    expect(Object.keys(doc.paths['/events'].post.responses)).toEqual([
      '202',
      '400',
      '503',
    ]);
    expect(Object.keys(doc.paths['/events/{eventKey}'].get.responses)).toEqual([
      '200',
      '400',
      '404',
    ]);
    expect(doc.components.schemas.CreateEvent.required).toEqual([
      'patientId',
      'type',
      'data',
      'ts',
    ]);
    await request(app.getHttpServer())
      .get('/docs')
      .expect(200)
      .expect('content-type', /html/);
  });
});
