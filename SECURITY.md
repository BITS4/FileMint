# Security policy

Report suspected vulnerabilities privately to the repository owner rather than
opening a public issue. Include affected routes or file types, reproduction
steps, and impact without attaching confidential documents.

Never commit populated environment files, access tokens, payment credentials,
database URLs, or document contents from real users. Uploaded conversion files
must remain inside per-request temporary directories and be deleted after the
response is produced.

Supported releases receive fixes on `main`. Dependency risk is checked in CI;
high or critical advisories may not increase above the documented baseline.
CodeQL also analyzes the TypeScript and Python source on every push and pull
request, with an additional scheduled scan each week.
