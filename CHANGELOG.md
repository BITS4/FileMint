# Changelog

All notable changes follow Semantic Versioning.

## [Unreleased]

## [1.3.0] - 2026-09-01

### Added

- Added an installable web app shell with an offline service worker, verified
  manifest and icons, and a same-origin PDF.js worker copied from the lockfile.
- Added authenticated, persisted feedback delivery and completed the PDF form
  overlay workflow for text, checkbox, date, initials, and signature fields.
- Added an isolated production server dependency graph, health-checked hardened
  container job, and API, deployment, and security configuration documentation.
- Expanded the suite to 83 TypeScript spec files with 508 tests and 233 Python
  conversion tests, including component interactions, async runner races,
  conversion edge cases, feedback delivery, and Collabora session cleanup.

### Changed

- Raised TypeScript coverage gates to 95% statements, 86% branches, 98%
  functions, and 97% lines; raised complete Python branch coverage to 92%.
- Pinned GitHub Actions by immutable commit, made CI gate names explicit,
  and added web artifact, Python graph, production-server audit, and container
  health gates.
- Bounded conversion subprocess output and temporary WOPI sessions, standardized
  the server port on 8787, and hardened database TLS and proxy handling defaults.

### Security

- Protected one-time authentication codes with keyed HMAC digests, production
  secret validation, redacted structured logging, and bounded rate-limit state.
- Validated redirect, Collabora launch/message, Stripe webhook, and public auth
  inputs; added replay-resistant payment activation and expiring edit tokens.
- Reduced the container to the isolated API dependency graph, a non-root user,
  read-only filesystem, dropped capabilities, and pinned base-image digest.

### Removed

- Removed generated conversion/debug fixtures, unused starter artwork, stale
  scaffold tooling, and unused direct dependencies from the published tree.

## [1.2.1] - 2026-09-01

### Fixed

- Isolated authentication URL tests from deployment environment values so the
  documented CI configuration and clean local environments exercise the same
  precedence rules reliably.

## [1.2.0] - 2026-09-01

### Added

- Expanded regression coverage to 71 TypeScript spec files and 412 tests, with
  enforced 94/85/97/96 statement, branch, function, and line gates across every
  server module and the client business, storage, conversion, editor, runtime,
  catalog, and state layers.
- Added 197 Python conversion and export tests, an 85% Python branch-coverage
  gate, and root `test:python` / `test:all` workflows backed by pinned Python
  3.11 CI.
- Added weekly Dependabot updates for the pinned Python conversion stack.
- Added CodeQL security-extended analysis for TypeScript and Python, and moved
  CI to the current Node 24-based GitHub Action majors.
- Added repository-owned privacy and terms documents in place of placeholder
  application links.

### Changed

- Split the PDF editor, controller, PDF-to-DOCX converter, PDF export pipeline,
  authentication service, runtime routes, PDF core, and remaining registries
  into focused production modules below 500 physical lines.
- Raised CI coverage thresholds, enforced React hook dependency safety and a
  repository-wide 500-line code ceiling, and aligned Docker with the Node 20
  CI runtime.
- Completed environment documentation and hardened Windows fresh-clone line
  endings for reproducible formatting checks.

### Fixed

- Preserved PDF editor interaction state across the component split and fixed
  stale hook dependencies in editor, viewer, batch conversion, and office
  preview flows.
- Closed an HTML export image file handle and retained legacy converter/CLI
  import compatibility through explicit facades.

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

[Unreleased]: https://github.com/BITS4/FileMint/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/BITS4/FileMint/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/BITS4/FileMint/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/BITS4/FileMint/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/BITS4/FileMint/releases/tag/v1.1.0
