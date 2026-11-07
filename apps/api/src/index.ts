import { buildApp } from './server.js';

const { app, config, close } = await buildApp();

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  console.log(`PhotoArchive AI API listening on http://${config.HOST}:${config.PORT}`);
} catch (error) {
  console.error('Failed to start API', error);
  await close();
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void close().finally(() => process.exit(0));
  });
}
