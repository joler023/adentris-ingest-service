import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module.js';
import { configureApi } from './configure-api.js';

const app = await NestFactory.create(ApiModule);
configureApi(app);
app.enableShutdownHooks();
await app.listen(process.env.PORT ?? 3000);
