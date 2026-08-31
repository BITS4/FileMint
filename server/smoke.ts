import { app } from './index';
import { logger } from './observability';

async function runSmokeTest(): Promise<void> {
  const health = await app.request('/health');
  const metrics = await app.request('/metrics');

  if (!health.ok || !metrics.ok) {
    throw new Error(`Server smoke test failed: health=${health.status}, metrics=${metrics.status}`);
  }

  const payload = (await health.json()) as {
    version?: string;
    capabilities?: Record<string, boolean>;
  };
  logger.info(
    { version: payload.version, capabilities: payload.capabilities },
    'FileMint server smoke test passed',
  );
}

runSmokeTest()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.error({ error }, 'FileMint server smoke test failed');
    process.exit(1);
  });
