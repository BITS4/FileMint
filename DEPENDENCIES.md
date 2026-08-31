# Dependency policy

FileMint uses one npm manifest and one committed `package-lock.json`. Install with
`npm ci`; do not use an unlocked install in CI or production images.

Dependabot checks npm and GitHub Actions weekly. Before merging an update, run:

```bash
npm run verify
npm run test:coverage
npm run audit
```

The audit gate prevents the production high/critical advisory count from
increasing. The current high-severity baseline comes from Metro's transitive
`image-size` dependency in Expo SDK 56. It must stay level or decrease until an
Expo-compatible upstream release removes it. Direct PDF.js and Hono security
updates are pinned through the root lockfile.

Run `npm outdated` during scheduled maintenance. Major Expo upgrades require the
matching versioned Expo migration guide, device testing, and a dedicated pull
request.

## Reviewed upgrade backlog (2026-08-31)

The lockfile is current within declared compatible ranges. The remaining direct
major updates are deliberately deferred:

- Expo 57 and its React Native/Expo module matrix require the SDK 57 migration
  guide plus iOS and Android device testing.
- Async Storage 3, React Native Gesture Handler 3, React Native WebView 14, and
  React Native Worklets 0.12 must be evaluated as part of that native upgrade.
- ESLint 10 and TypeScript 7 need a separate tooling compatibility change.
- `docx-preview` 0.4 needs fixture-based Word rendering comparison before use.

The current production audit reports 14 moderate, 4 high, and 0 critical
findings. The high findings are inherited from Metro's `image-size` parser; the
moderate findings are inherited from the Expo build toolchain and
`pptx-preview`. `npm run audit` rejects any increase in high or critical risk,
while Dependabot continues to propose compatible upstream fixes.
