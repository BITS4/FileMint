import { serve } from '@hono/node-server';
import { COLLABORA_URL, PORT, WOPI_HOST } from './config';
import { app, CAPABILITIES } from './index';
import { logger } from './observability';

export const filemintServer = serve({
  fetch: app.fetch,
  port: PORT,
  hostname: '0.0.0.0',
});

logger.info(
  {
    port: PORT,
    capabilities: CAPABILITIES,
    collaboraUrl: COLLABORA_URL,
    wopiHost: WOPI_HOST,
  },
  'FileMint conversion server started',
);

if (process.env.FILEMINT_SMOKE) {
  setTimeout(() => filemintServer.close(() => process.exit(0)), 1_500);
}
