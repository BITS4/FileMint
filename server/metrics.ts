export interface MetricsSnapshot {
  startedAt: number;
  requests: number;
  errors: number;
  durationMs: number;
}

export class RequestMetrics {
  private readonly startedAt: number;
  private requests = 0;
  private errors = 0;
  private durationMs = 0;

  constructor(startedAt = Date.now()) {
    this.startedAt = startedAt;
  }

  observe(status: number, durationMs: number): void {
    this.requests += 1;
    this.durationMs += Math.max(0, durationMs);
    if (status >= 500) this.errors += 1;
  }

  snapshot(): MetricsSnapshot {
    return {
      startedAt: this.startedAt,
      requests: this.requests,
      errors: this.errors,
      durationMs: this.durationMs,
    };
  }

  toPrometheus(now = Date.now()): string {
    const snapshot = this.snapshot();
    const uptimeSeconds = Math.max(0, now - snapshot.startedAt) / 1000;
    return [
      '# HELP filemint_uptime_seconds Process uptime in seconds.',
      '# TYPE filemint_uptime_seconds gauge',
      `filemint_uptime_seconds ${uptimeSeconds.toFixed(3)}`,
      '# HELP filemint_http_requests_total Completed HTTP requests.',
      '# TYPE filemint_http_requests_total counter',
      `filemint_http_requests_total ${snapshot.requests}`,
      '# HELP filemint_http_errors_total Completed HTTP requests with a 5xx status.',
      '# TYPE filemint_http_errors_total counter',
      `filemint_http_errors_total ${snapshot.errors}`,
      '# HELP filemint_http_request_duration_ms_total Total request duration in milliseconds.',
      '# TYPE filemint_http_request_duration_ms_total counter',
      `filemint_http_request_duration_ms_total ${snapshot.durationMs.toFixed(3)}`,
      '',
    ].join('\n');
  }
}

export const requestMetrics = new RequestMetrics();
