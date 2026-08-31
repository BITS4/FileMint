# Changelog

All notable changes follow Semantic Versioning.

## [Unreleased]

## [1.1.0] - 2026-09-01

### Added

- Automated formatting, lint, app/server typechecking, tests, coverage, web
  export, Python compilation, and dependency auditing in CI.
- Structured Pino request logging, optional Sentry reporting, security headers,
  restricted CORS, upload limits, and Prometheus metrics.
- Unit tests for document helpers, conversion configuration, editor geometry,
  request schemas, tool metadata, and server configuration/middleware.
- PDF page, annotation, generation, image, authentication, and ID tests (82
  tests across 19 TypeScript spec files), plus 14 Python conversion tests.
- A health-checked Docker Compose development stack for the API and PostgreSQL.
- Pinned Python conversion dependencies and Zod validation at authentication
  request boundaries.

### Changed

- Replaced the vulnerable SheetJS browser renderer with safe text-based XLSX
  rendering through `read-excel-file`.
- Updated Hono, its Node adapter, and PDF.js to patched releases.
- Aligned native packages with Expo SDK 56's current compatibility matrix and
  refreshed compatible server/tooling dependencies.
- Split the conversion studio, operation registry, tool catalog, settings UI,
  PDF export models, and editor geometry into focused modules under 500 lines.
