import type { Hono } from 'hono';
import { registerAccountRoutes } from './auth.account-routes';
import { PREMIUM_PLANS } from './auth.models';
import { registerPremiumRoutes } from './auth.premium-routes';

export { PREMIUM_PLANS };

export function registerAuth(app: Hono): void {
  registerAccountRoutes(app);
  registerPremiumRoutes(app);
}
