import { describe, expect, it } from 'vitest';
import { RequestMetrics } from './metrics';

describe('RequestMetrics', () => {
  it('records successful and failed requests', () => {
    const metrics = new RequestMetrics(1_000);
    metrics.observe(200, 12.5);
    metrics.observe(503, 7.5);

    expect(metrics.snapshot()).toEqual({
      startedAt: 1_000,
      requests: 2,
      errors: 1,
      durationMs: 20,
    });
  });

  it('emits Prometheus-compatible counters', () => {
    const metrics = new RequestMetrics(1_000);
    metrics.observe(204, -10);

    const report = metrics.toPrometheus(3_500);
    expect(report).toContain('filemint_uptime_seconds 2.500');
    expect(report).toContain('filemint_http_requests_total 1');
    expect(report).toContain('filemint_http_errors_total 0');
    expect(report).toContain('filemint_http_request_duration_ms_total 0.000');
  });
});
