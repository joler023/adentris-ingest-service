import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Env } from './config/env.js';
import { createLogger } from './logger.js';
import { WorkerModule } from './worker.module.js';

// An HTTP server only for /health: a worker has no other reason to listen.
const app = await NestFactory.create(WorkerModule, { logger: createLogger() });
app.enableShutdownHooks();
const port = app
  .get<ConfigService<Env, true>>(ConfigService)
  .get('WORKER_PORT', { infer: true });
await app.listen(port);
new Logger('Worker').log('Worker started', { port });
