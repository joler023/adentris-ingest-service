import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module.js';
import { setupApiDocs } from './ingest/api-docs.js';

const app = await NestFactory.create(ApiModule);
app.useGlobalPipes(new StandardSchemaValidationPipe());
app.enableShutdownHooks();
setupApiDocs(app);
await app.listen(process.env.PORT ?? 3000);
