/** Health route and background Collabora availability refresh. */
import type { Hono } from 'hono';

import { COLLABORA_URL, VERSION } from './config';
import { detectCollabora, getLastCollaboraProbe } from './edit';
import { CAPABILITIES } from './runtime';

export function registerHealthRoute(app: Hono): void {
  // Collabora runs in Docker and comes/goes independently — poll it in the
  // background so /health reflects current availability without slowing down.
  let collaboraOnline = false;
  let collaboraRefreshInFlight = false;
  const refreshCollabora = () => {
    if (collaboraRefreshInFlight) return;
    collaboraRefreshInFlight = true;
    detectCollabora(COLLABORA_URL)
      .then((v) => {
        collaboraOnline = v;
      })
      .catch(() => undefined)
      .finally(() => {
        collaboraRefreshInFlight = false;
      });
  };
  refreshCollabora();
  const collaboraTimer = setInterval(refreshCollabora, 30000);
  if (typeof collaboraTimer.unref === 'function') collaboraTimer.unref();

  app.get('/health', (c) =>
    c.json({
      version: VERSION,
      capabilities: { ...CAPABILITIES, collabora: collaboraOnline, auth: true, premium: true },
      services: {
        collabora: getLastCollaboraProbe() ?? {
          online: collaboraOnline,
          url: COLLABORA_URL,
          checkedAt: null,
        },
      },
    }),
  );
}
