# Changelog

All notable changes follow Semantic Versioning.

## [Unreleased]

### Added

- Automated formatting, lint, app/server typechecking, tests, coverage, web
  export, Python compilation, and dependency auditing in CI.
- Structured Pino request logging, optional Sentry reporting, security headers,
  restricted CORS, upload limits, and Prometheus metrics.
- Unit tests for document helpers and server configuration/middleware.
- PDF page, annotation, generation, image, authentication, and ID tests (52
  tests across 14 spec files).
- A health-checked Docker Compose development stack for the API and PostgreSQL.

### Changed

- Replaced the vulnerable SheetJS browser renderer with safe text-based XLSX
  rendering through `read-excel-file`.
- Updated Hono, its Node adapter, and PDF.js to patched releases.
- Aligned native packages with Expo SDK 56's current compatibility matrix and
  refreshed compatible server/tooling dependencies.
