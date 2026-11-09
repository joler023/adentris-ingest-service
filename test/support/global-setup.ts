import mongoose from 'mongoose';

const VHOST = 'ingest-e2e';
const RABBIT_API = 'http://localhost:15672/api';
const MONGODB_URI = 'mongodb://localhost:27017/ingest-e2e';
const headers = {
  authorization: `Basic ${Buffer.from('guest:guest').toString('base64')}`,
  'content-type': 'application/json',
};

async function rabbit(
  method: string,
  path: string,
  body?: unknown,
): Promise<void> {
  const response = await fetch(`${RABBIT_API}${path}`, {
    method,
    headers,
    body: body && JSON.stringify(body),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `RabbitMQ management API ${method} ${path}: ${response.status}`,
    );
  }
}

async function dropDatabase(): Promise<void> {
  const connection = await mongoose.createConnection(MONGODB_URI).asPromise();
  await connection.dropDatabase();
  await connection.close();
}

/** Fresh vhost + database for every run, so no message or document of a previous run leaks in. */
export async function setup(): Promise<() => Promise<void>> {
  await rabbit('DELETE', `/vhosts/${VHOST}`);
  await rabbit('PUT', `/vhosts/${VHOST}`);
  await rabbit('PUT', `/permissions/${VHOST}/guest`, {
    configure: '.*',
    write: '.*',
    read: '.*',
  });
  await dropDatabase();

  return async () => {
    await rabbit('DELETE', `/vhosts/${VHOST}`);
    await dropDatabase();
  };
}
