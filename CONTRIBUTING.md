# Contributing

Use Node.js 20.19 or newer with Python 3.11, then install the locked graphs with
`npm ci` and `python -m pip install -r server/requirements.lock.txt`.

Keep each feature or fix in a focused branch and commit its tests with the
behavior they protect. Avoid mixing formatting-only changes with behavior.

Before opening a pull request, run:

```bash
npm run verify
npm run test:coverage
npm run test:python
npm run audit
npm run server:smoke
```

Describe the user-visible outcome, supported platforms, configuration changes,
and any document fixtures used for verification. Never add synthetic authors or
rewrite history to make the repository appear older or more collaborative.
