import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { registerHealthRoute } from './health';
import { registerRedactionRoute } from './redaction';
import { registerSecurityRoutes } from './security';

describe('extracted conversion routes', () => {
  it('reports health and a complete capability map', async () => {
    const app = new Hono();
    registerHealthRoute(app);

    const response = await app.request('/health');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.capabilities).toMatchObject({ auth: true, premium: true });
    expect(typeof body.capabilities.pdfEdit).toBe('boolean');
  });

  it.each(['/edit/redact', '/secure/lock', '/secure/unlock', '/secure/permissions'])(
    'rejects a missing multipart upload on %s',
    async (path) => {
      const app = new Hono();
      registerRedactionRoute(app);
      registerSecurityRoutes(app);

      const response = await app.request(path, { method: 'POST' });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toContain('No file uploaded');
    },
  );
});
