import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module.js';
import { configureApi } from './configure-api.js';
import type { Env } from './config/env.js';
import { createLogger } from './logger.js';

const app = await NestFactory.create(ApiModule, { logger: createLogger() });
configureApi(app);
app.enableShutdownHooks();
const port = app.get<ConfigService<Env, true>>(ConfigService).get('PORT', {
  infer: true,
});
await app.listen(port);
new Logger('Api').log('API started', { port });
